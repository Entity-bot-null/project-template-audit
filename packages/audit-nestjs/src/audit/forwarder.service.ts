import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CLOCK,
  AUDIT_CONFIG,
  AUDIT_LOCK,
  AUDIT_STORE,
  CONNECTOR,
  CONTRACT_VERSION,
  FORWARD_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  LEASE_MS,
  OUTAGE_PAUSE_MAX_MS,
  PAUSE_DEFAULT_MS,
  PAUSE_REFUSED_MS,
  PROMPT_KEEP_MS,
  RECEIPT_TTL_MS,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  SEQUENCE_PER_ROUND,
} from './audit.constants.js';
import { recordEvents, recordHubRequest, type HubRequestKind } from './audit.metrics.js';
import { observeQueue } from './audit.metrics.js';
import {
  type AuditLock,
  type AuditStore,
  AuditTransportError,
  type HubResponse,
  type QueuedEvent,
  type QueueStats,
} from './audit.ports.js';
import { AuditService } from './audit.service.js';
import {
  type AuditEvent,
  canonicalJsonBytes,
  EventBatchResultSchema,
  LIMITS,
} from './contract/index.js';
import { envelopeData, HubClient } from './hub-client.js';

/** A proxy in front of Audit Hub that could not reach it: out of reach, like a timeout. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 504]);

/** Rows of one request: at most 100 events and the contract's batch size. */
export function batchesOf(rows: readonly QueuedEvent[]): QueuedEvent[][] {
  const batches: QueuedEvent[][] = [];
  let current: QueuedEvent[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = canonicalJsonBytes(row.draft) + 32;
    if (
      current.length > 0 &&
      (current.length >= LIMITS.batchEvents || bytes + size > LIMITS.batchBytes)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** When an event that failed `attempts` times is tried again: doubling, capped, with jitter. */
export function retryDelay(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(RETRY_FIRST_MS * 2 ** Math.max(0, attempts), RETRY_MAX_MS);
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Sends the queue to Audit Hub (docs/design/audit-hub/contract.md#ingestion-api):
 * every two seconds, one instance at a time (the project's LockService, and
 * the database lock of the numbering), it numbers the committed rows in
 * order, sends them in signed batches, and deletes what Audit Hub answered
 * for. A 429 or a 503 pauses it for their Retry-After; a failure retries
 * the events later, doubling the wait, and pauses the whole queue while
 * Audit Hub fails or is out of reach (up to a minute between tries); nothing
 * is ever dropped unanswered.
 * Every minute each instance sends a heartbeat with the queue's state, and
 * old webhook receipts and prompts are swept.
 */
@Injectable()
export class ForwarderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AuditForwarder');
  private readonly instanceId = randomUUID();
  private readonly timers: NodeJS.Timeout[] = [];
  private running = false;
  private pausedUntil = 0;
  /** Requests in a row that failed or found no Audit Hub: the outage's pause. */
  private failures = 0;
  private catalogPublished = false;
  private backedUp = false;
  private lastStats: QueueStats = { size: 0, oldestAgeSeconds: 0, retrying: 0 };

  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(AUDIT_LOCK) private readonly lock: AuditLock,
    @Inject(AUDIT_CLOCK) private readonly clock: () => number,
    private readonly hub: HubClient,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config === null) return;
    observeQueue(() => ({
      waiting: this.lastStats.size,
      oldestAgeSeconds: this.lastStats.oldestAgeSeconds,
    }));
    this.timers.push(
      setInterval(() => void this.tick(), FORWARD_INTERVAL_MS).unref(),
      setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS).unref(),
      // A first heartbeat at once: Audit Hub learns of a restart, a new
      // version or a new connector without waiting a minute.
      setTimeout(() => void this.beat(), 0).unref(),
    );
    this.logger.log(`Forwarding the audit log to ${this.config.hubUrl} as ${this.config.app}`);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /** The queue as last counted. */
  get stats(): QueueStats {
    return this.lastStats;
  }

  /** One round, unless one is running here or on another instance. */
  async tick(): Promise<void> {
    if (this.config === null || this.running) return;
    this.running = true;
    try {
      await this.lock.withLock('audit:forwarder', LEASE_MS, () => this.forward());
    } catch (error) {
      this.logger.error(`Forwarding round failed: ${messageOf(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Numbers, sends and settles what is due; then counts the queue. */
  async forward(): Promise<void> {
    const now = this.clock();
    if (now >= this.pausedUntil && (this.catalogPublished || (await this.publishCatalog()))) {
      const { epoch } = await this.store.sequence(SEQUENCE_PER_ROUND);
      const rows = await this.store.claimDue(LIMITS.batchEvents, new Date(now), LEASE_MS);
      const batches = batchesOf(rows);
      for (const [index, batch] of batches.entries()) {
        if (!(await this.send(epoch, batch))) {
          // Paused or failing: the rest of the round waits too, without an attempt counted.
          const rest = batches.slice(index + 1).flat();
          if (rest.length > 0) {
            await this.store.retryLater(ids(rest), new Date(this.pausedUntil), 'paused', false);
          }
          break;
        }
      }
    }
    await this.count();
  }

  /** Publishes the catalog the events are written against; false while Audit Hub refuses it. */
  async publishCatalog(): Promise<boolean> {
    let response: HubResponse;
    try {
      response = await this.hub.publishCatalog(this.audit.catalog);
    } catch (error) {
      this.unreachable('catalog', error);
      return false;
    }
    if (response.status === 200) {
      this.answered('catalog');
      this.catalogPublished = true;
      return true;
    }
    this.refused('catalog', response);
    return false;
  }

  /** Sends one batch and settles each event; false when the round must stop. */
  private async send(epoch: string, batch: QueuedEvent[]): Promise<boolean> {
    const events: AuditEvent[] = batch.map((row) => ({
      ...row.draft,
      // Stamped now: an event queued before a deploy goes with the current catalog.
      catalogVersion: this.audit.catalogVersion,
      sourceSeq: row.sourceSeq,
    }));
    let response: HubResponse;
    try {
      response = await this.hub.sendEvents(epoch, events);
    } catch (error) {
      this.unreachable('events', error);
      await this.waitForOutage(batch, 'unreachable');
      return false;
    }
    if (response.status !== 200) {
      // Paused as a whole (a 429 or 503, refused credentials or contract):
      // Audit Hub's state, not the events' fault, so no attempt is counted.
      if (this.refused('events', response)) {
        await this.store.retryLater(
          ids(batch),
          new Date(this.pausedUntil),
          `http_${String(response.status)}`,
          false,
        );
      } else if (GATEWAY_STATUSES.has(response.status)) {
        await this.waitForOutage(batch, `http_${String(response.status)}`);
      } else {
        // Audit Hub failed on this batch: it backs off on its own (up to
        // RETRY_MAX_MS), so one batch it cannot take never holds up the rest.
        await this.retryEach(batch, `http_${String(response.status)}`);
      }
      return false;
    }
    this.answered('events');
    await this.settle(batch, response);
    return true;
  }

  /** Each event by its result: answered ones leave the queue, the others wait. */
  private async settle(batch: QueuedEvent[], response: HubResponse): Promise<void> {
    const parsed = EventBatchResultSchema.safeParse(envelopeData(response));
    if (!parsed.success) {
      this.logger.error('Audit Hub answered a batch with something that is not its result');
      await this.retryEach(batch, 'bad_answer');
      return;
    }
    const byIndex = new Map(parsed.data.results.map((result) => [result.index, result]));
    const done: string[] = [];
    const retry: QueuedEvent[] = [];
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    for (const [index, row] of batch.entries()) {
      const result = byIndex.get(index);
      if (result === undefined || (result.status === 'rejected' && result.retryable === true)) {
        if (result?.reason === 'catalog_version_unknown') this.catalogPublished = false;
        retry.push(row);
        continue;
      }
      done.push(row.id);
      if (result.status === 'accepted') accepted += 1;
      else if (result.status === 'duplicate') duplicates += 1;
      else {
        rejected += 1;
        this.logger.warn(
          `Audit Hub refused ${row.draft.action} #${String(row.sourceSeq)}: ${result.reason ?? 'no reason'}`,
        );
      }
    }
    if (done.length > 0) await this.store.remove(done);
    if (retry.length > 0) await this.retryEach(retry, 'rejected_retryable');
    recordEvents('accepted', accepted);
    recordEvents('duplicate', duplicates);
    recordEvents('rejected', rejected);
  }

  /**
   * Audit Hub out of reach: not the events' fault, so no attempt is counted
   * and they go with the queue's pause. When it is back, the whole queue
   * drains at once, however long it was gone.
   */
  private async waitForOutage(rows: readonly QueuedEvent[], error: string): Promise<void> {
    recordEvents('retry', rows.length);
    await this.store.retryLater(ids(rows), new Date(this.pausedUntil), error, false);
  }

  private async retryEach(rows: readonly QueuedEvent[], error: string): Promise<void> {
    recordEvents('retry', rows.length);
    // Grouped by wait: one statement per attempt count, not one per row.
    const byAttempts = new Map<number, string[]>();
    for (const row of rows)
      byAttempts.set(row.attempts, [...(byAttempts.get(row.attempts) ?? []), row.id]);
    for (const [attempts, group] of byAttempts) {
      await this.store.retryLater(
        group,
        new Date(this.clock() + retryDelay(attempts)),
        error,
        true,
      );
    }
  }

  private answered(kind: HubRequestKind): void {
    recordHubRequest(kind, 'ok');
    this.failures = 0;
  }

  /**
   * A whole request refused. True when the queue is paused for Audit Hub's
   * reason: a 429 or 503 for its Retry-After, refused credentials or
   * contract for PAUSE_REFUSED_MS. Any other status is a failure.
   */
  private refused(kind: HubRequestKind, response: HubResponse): boolean {
    const now = this.clock();
    if (response.status === 429 || response.status === 503) {
      recordHubRequest(kind, response.status === 429 ? 'rate_limited' : 'unavailable');
      const pause =
        response.retryAfterSec === undefined ? PAUSE_DEFAULT_MS : response.retryAfterSec * 1000;
      this.pausedUntil = now + pause;
      return pause > 0;
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      recordHubRequest(kind, 'refused');
      this.pausedUntil = now + PAUSE_REFUSED_MS;
      this.logger.error(
        `Audit Hub refused the ${kind} with ${String(response.status)}: ${messageOfBody(response.body)} (check the AUDIT_HUB_* variables)`,
      );
      return true;
    }
    recordHubRequest(kind, 'failed');
    this.logger.warn(`Audit Hub answered the ${kind} with ${String(response.status)}`);
    this.outage();
    return false;
  }

  private unreachable(kind: HubRequestKind, error: unknown): void {
    recordHubRequest(kind, 'unreachable');
    if (!(error instanceof AuditTransportError)) throw error;
    this.logger.warn(`Audit Hub unreachable (${error.kind}) for the ${kind}: the events wait`);
    this.outage();
  }

  /** Audit Hub failing or out of reach: the whole queue waits, longer each time. */
  private outage(): void {
    const pause = Math.min(retryDelay(this.failures), OUTAGE_PAUSE_MAX_MS);
    this.failures += 1;
    this.pausedUntil = Math.max(this.pausedUntil, this.clock() + pause);
  }

  /** Counts the queue for the gauges and the backlog warning. */
  private async count(): Promise<void> {
    if (this.config === null) return;
    const stats = await this.store.stats(new Date(this.clock()));
    this.lastStats = stats;
    if (stats.size > this.config.queueAlert && !this.backedUp) {
      this.backedUp = true;
      this.logger.warn(
        `Audit queue backed up: ${String(stats.size)} events waiting, the oldest ${String(stats.oldestAgeSeconds)}s old`,
      );
    } else if (stats.size <= this.config.queueAlert * 0.9 && this.backedUp) {
      this.backedUp = false;
      this.logger.log(`Audit queue back to ${String(stats.size)} events`);
    }
  }

  /** The heartbeat: this instance is alive, with the queue's state; then the sweeps. */
  async beat(): Promise<void> {
    if (this.config === null) return;
    const now = this.clock();
    try {
      const state = await this.store.state();
      const response = await this.hub.heartbeat({
        contractVersion: CONTRACT_VERSION,
        connector: CONNECTOR,
        instanceId: this.instanceId,
        appVersion: this.config.appVersion,
        catalogVersion: this.audit.catalogVersion,
        sequenceEpoch: state.epoch,
        lastAssignedSeq: state.lastSeq,
        queue: { ...this.lastStats, discardedAtSignOut: this.audit.discardedAtSignOut },
        responseActions: [...this.config.responseActions],
      });
      if (response.status === 200) this.answered('heartbeat');
      else this.refused('heartbeat', response);
    } catch (error) {
      if (error instanceof AuditTransportError) this.unreachable('heartbeat', error);
      else this.logger.error(`Heartbeat failed: ${messageOf(error)}`);
    }
    // The project's own housekeeping: Audit Hub out of reach or not.
    try {
      await this.store.forgetReceipts(new Date(now - RECEIPT_TTL_MS));
      await this.store.forgetPrompts(new Date(now - PROMPT_KEEP_MS));
    } catch (error) {
      this.logger.error(`Audit sweeps failed: ${messageOf(error)}`);
    }
  }
}

const ids = (rows: readonly QueuedEvent[]) => rows.map((row) => row.id);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The message of an error envelope, never more of it. */
function messageOfBody(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message.slice(0, 200);
  }
  return 'no message';
}
