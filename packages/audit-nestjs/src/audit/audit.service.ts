import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CLOCK,
  AUDIT_CONFIG,
  AUDIT_STORE,
  CONNECTOR,
  SAMPLE_MAX_PER_WINDOW,
  SAMPLE_WINDOW_MS,
} from './audit.constants.js';
import type { AuditStore } from './audit.ports.js';
import { catalogDocument, catalogVersion } from './catalog/catalog.js';
import { changeOf, type RecordState } from './change.js';
import {
  type AuditEventDraft,
  type CatalogDocument,
  type Change,
  emailHmac,
  secretKey,
} from './contract/index.js';
import { AuditEventInvalidError, type AuditInput, buildEvent } from './event-builder.js';
import type { AuditTx } from './host.js';
import { currentScope, scopeOf } from './request-scope.js';

/** Validates emails into pseudonyms while the connector is off: never sent anywhere. */
const UNSET_KEY = Buffer.alloc(32).toString('base64url');

/**
 * Records audit events (docs/audit/connection-guide.md): into the project's
 * own queue, in the transaction of the change they describe, from where the
 * forwarder sends them to Audit Hub. Every event is checked against the
 * contract and the catalog even while the connector is off, so a wrong call
 * fails the project's tests, not production.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  /** The catalog this project's events are written against. */
  readonly catalog: CatalogDocument;
  readonly catalogVersion: string;
  /** recordSampled's window, and the events it let through in it. */
  private sampleWindow = -1;
  private readonly sampled = new Set<string>();
  private discarded = 0;

  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(AUDIT_CLOCK) private readonly clock: () => number,
  ) {
    this.catalog = catalogDocument(
      config?.app ?? 'unconfigured',
      CONNECTOR.version,
      config?.responseActions ?? [],
    );
    this.catalogVersion = catalogVersion(this.catalog);
  }

  /** Connected to Audit Hub: its variables are set. */
  get enabled(): boolean {
    return this.config !== null;
  }

  /**
   * Events the project's devices dropped at sign-out since this instance
   * started (never sent as the next user): the heartbeat reports them.
   */
  get discardedAtSignOut(): number {
    return this.discarded;
  }

  /** What a device reported dropping, with its batch of client events. */
  countDiscarded(count: number): void {
    if (Number.isSafeInteger(count) && count > 0) this.discarded += count;
  }

  /**
   * Queues an event in the caller's transaction: it reaches Audit Hub if the
   * transaction commits, and never if it rolls back. `req` is needed only
   * outside a request's handler (a guard): there the request is taken from
   * the request context.
   */
  async record(tx: AuditTx, input: AuditInput, req?: Request): Promise<void> {
    const draft = this.build(input, req);
    if (this.config !== null) await this.store.enqueue(tx, [draft]);
  }

  /**
   * Queues an event in a transaction of its own, for what happens outside
   * one (a refused sign-in, a refused request). Never throws for the
   * database: the caller's own answer (a 401, a 403) must not turn into a
   * 500; the failure is logged. An invalid event still throws.
   */
  async recordAlone(input: AuditInput, req?: Request): Promise<boolean> {
    const draft = this.build(input, req);
    if (this.config === null) return false;
    return this.enqueueAlone(draft);
  }

  /**
   * recordAlone for what anyone can cause at will, as often as they like (a
   * refused cross-origin request, a rate limit): only the first per action,
   * address and route each SAMPLE_WINDOW_MS, and at most
   * SAMPLE_MAX_PER_WINDOW of them per instance. The rest would only repeat
   * it, and a flood of them must not flood the queue. Validated every time.
   */
  async recordSampled(input: AuditInput, req?: Request): Promise<boolean> {
    const draft = this.build(input, req);
    if (this.config === null || !this.sample(draft)) return false;
    return this.enqueueAlone(draft);
  }

  /**
   * The change of a record, for `input.change`: the action's declared fields
   * of the state read in the transaction before the write, and after it;
   * sensitive values as "[REDACTED]".
   */
  change(action: AuditInput['action'], before: RecordState, after: RecordState): Change {
    return changeOf(action, before, after);
  }

  /**
   * An email as Audit Hub knows it: its pseudonym (HMAC-SHA-256 with the
   * application's key), never the address. For a change's before and after
   * (account.email.changed).
   */
  emailPseudonym(email: string): string {
    return emailHmac(secretKey(this.config?.pseudonymKey ?? UNSET_KEY), email);
  }

  private async enqueueAlone(draft: AuditEventDraft): Promise<boolean> {
    try {
      await this.store.enqueueAlone([draft]);
      return true;
    } catch (error) {
      this.logger.error(
        `Could not queue ${draft.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private sample(draft: AuditEventDraft): boolean {
    const window = Math.floor(this.clock() / SAMPLE_WINDOW_MS);
    if (window !== this.sampleWindow) {
      this.sampleWindow = window;
      this.sampled.clear();
    }
    const key = `${draft.action} ${draft.network?.ip ?? ''} ${draft.request?.route ?? ''}`;
    if (this.sampled.has(key) || this.sampled.size >= SAMPLE_MAX_PER_WINDOW) return false;
    this.sampled.add(key);
    return true;
  }

  /** The queued form of an event; throws AuditEventInvalidError for a wrong call. */
  build(input: AuditInput, req?: Request): AuditEventDraft {
    const scope = req === undefined ? currentScope() : scopeOf(req);
    return buildEvent(input, scope, {
      catalogVersion: this.catalogVersion,
      pseudonymKey: this.config?.pseudonymKey ?? UNSET_KEY,
      now: this.clock(),
    });
  }
}

export { AuditEventInvalidError };
