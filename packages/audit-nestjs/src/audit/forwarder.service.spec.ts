import { ConsoleLogger, Logger, type LoggerService } from '@nestjs/common';
import {
  createNoopMeter,
  type Meter,
  metrics,
  type ObservableCallback,
  type ObservableGauge,
} from '@opentelemetry/api';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditConfig } from './audit-env.js';
import {
  CONNECTOR,
  CONTRACT_VERSION,
  FORWARD_INTERVAL_MS,
  LEASE_MS,
  OUTAGE_PAUSE_MAX_MS,
  PAUSE_DEFAULT_MS,
  PAUSE_REFUSED_MS,
  PROMPT_KEEP_MS,
  RECEIPT_TTL_MS,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
} from './audit.constants.js';
import {
  AuditTransportError,
  type HubRequest,
  type HubResponse,
  type QueuedEvent,
} from './audit.ports.js';
import { AuditService } from './audit.service.js';
import { FakeLock, FakeTransport, MemoryStore, ok, TEST_CONFIG, TEST_TX } from './audit.testing.js';
import {
  type AuditEvent,
  type AuditEventDraft,
  canonicalJsonBytes,
  CatalogPublishSchema,
  EventBatchSchema,
  type EventResult,
  HeartbeatSchema,
  LIMITS,
} from './contract/index.js';
import type { AuditInput } from './event-builder.js';
import { batchesOf, ForwarderService, retryDelay } from './forwarder.service.js';
import { HubClient } from './hub-client.js';

const CATALOG = '/api/ingest/catalog';
const EVENTS = '/api/ingest/events';
const HEARTBEAT = '/api/ingest/heartbeat';

const START = Date.UTC(2026, 9, 15, 12, 0, 0);
const HOURS_2 = 2 * 60 * 60_000;
let now = START;
const clock = () => now;

const SIGN_IN = {
  action: 'auth.session.signed_in',
  actor: { type: 'user', id: 'user-1' },
  details: { method: 'password' },
} satisfies AuditInput;
const SIGN_OUT = {
  action: 'auth.session.signed_out',
  actor: { type: 'user', id: 'user-1' },
} satisfies AuditInput;

/** Nest's logger, recorded. */
class LogCapture implements LoggerService {
  readonly lines: { level: 'log' | 'warn' | 'error'; message: string }[] = [];
  log(message: string): void {
    this.lines.push({ level: 'log', message });
  }
  warn(message: string): void {
    this.lines.push({ level: 'warn', message });
  }
  error(message: string): void {
    this.lines.push({ level: 'error', message });
  }
  of(level: 'log' | 'warn' | 'error'): string[] {
    return this.lines.filter((line) => line.level === level).map((line) => line.message);
  }
  matching(text: string): string[] {
    return this.lines.map((line) => line.message).filter((message) => message.includes(text));
  }
}

/** The memory store, with the sweeps it was asked for. */
class SweptStore extends MemoryStore {
  readonly sweeps: string[] = [];
  override forgetReceipts(before: Date): Promise<number> {
    this.sweeps.push(`receipts before ${before.toISOString()}`);
    return super.forgetReceipts(before);
  }
  override forgetPrompts(before: Date): Promise<number> {
    this.sweeps.push(`prompts before ${before.toISOString()}`);
    return super.forgetPrompts(before);
  }
}

type Answer = (request: HubRequest) => HubResponse | Promise<HubResponse>;

/** Audit Hub's answer to a batch: every event accepted. */
function acceptAll(request: HubRequest): HubResponse {
  const { events } = EventBatchSchema.parse(request.body);
  return ok({
    results: events.map((event, index) => ({
      index,
      eventId: event.eventId,
      sourceSeq: event.sourceSeq,
      status: 'accepted',
    })),
    accepted: events.length,
    duplicates: 0,
    rejected: 0,
  });
}

/** A batch result with the given results. */
function answered(results: EventResult[]): HubResponse {
  return ok({ results, accepted: 0, duplicates: 0, rejected: 0 });
}

const catalogOk: Answer = () => ok({ version: '0123456789abcdef', status: 'created', actions: 32 });
const heartbeatOk: Answer = () =>
  ok({
    serverTime: new Date(now).toISOString(),
    contractVersions: [CONTRACT_VERSION],
    lastContiguousSeq: 0,
    connectorNotice: null,
  });

/** Something thrown that is not an Error. */
const notAnError = { toString: () => 'plain failure' } as unknown as Error;

/** A forwarder over memory ports, and Audit Hub answering per path. */
class Harness {
  readonly lock = new FakeLock();
  readonly answers: Record<string, Answer> = {
    [CATALOG]: catalogOk,
    [EVENTS]: acceptAll,
    [HEARTBEAT]: heartbeatOk,
  };
  readonly transport = new FakeTransport((request) => {
    const answer = this.answers[request.path];
    if (answer === undefined) throw new Error(`Unexpected request to ${request.path}`);
    return answer(request);
  });
  readonly audit: AuditService;
  readonly forwarder: ForwarderService;

  constructor(
    readonly config: AuditConfig | null = TEST_CONFIG,
    readonly store: MemoryStore = new MemoryStore(),
  ) {
    store.now = clock;
    this.audit = new AuditService(config, store, clock);
    this.forwarder = new ForwarderService(
      config,
      store,
      this.lock,
      clock,
      new HubClient(config, this.transport, clock),
      this.audit,
    );
  }

  paths(): string[] {
    return this.transport.requests.map((request) => request.path);
  }

  /** The events of every batch sent, in order. */
  sent(): AuditEvent[][] {
    return this.transport.requests
      .filter((request) => request.path === EVENTS)
      .map((request) => EventBatchSchema.parse(request.body).events);
  }

  seqs(): number[][] {
    return this.sent().map((batch) => batch.map((event) => event.sourceSeq));
  }

  async queue(count: number, input: AuditInput = SIGN_IN): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      expect(await this.audit.recordAlone(input)).toBe(true);
    }
  }

  /** The queued row numbered `seq`. */
  row(seq: number) {
    const row = this.store.rows.find((candidate) => candidate.sourceSeq === seq);
    if (row === undefined) throw new Error(`No row #${String(seq)}`);
    return row;
  }
}

function rowOf(seq: number, draft: AuditEventDraft): QueuedEvent {
  return { id: `row-${String(seq)}`, sourceSeq: seq, attempts: 0, draft };
}

function draftOf(extra: Partial<AuditEventDraft> = {}): AuditEventDraft {
  return { ...new Harness().audit.build(SIGN_IN), ...extra };
}

let logs: LogCapture;

beforeEach(() => {
  now = START;
  logs = new LogCapture();
  Logger.overrideLogger(logs);
});

afterEach(() => {
  Logger.overrideLogger(new ConsoleLogger());
});

describe('batchesOf', () => {
  it('answers no batch for no rows', () => {
    expect(batchesOf([])).toEqual([]);
  });

  it('puts at most 100 events in a batch, in order', () => {
    const draft = draftOf();
    const rows = Array.from({ length: 250 }, (_, index) => rowOf(index + 1, draft));

    const batches = batchesOf(rows);

    expect(batches.map((batch) => batch.length)).toEqual([LIMITS.batchEvents, 100, 50]);
    expect(batches.flat().map((row) => row.sourceSeq)).toEqual(rows.map((row) => row.sourceSeq));
  });

  it("keeps each batch under the contract's byte limit", () => {
    const draft = draftOf({ network: { userAgent: 'x'.repeat(20_000) } });
    const size = canonicalJsonBytes(draft) + 32;
    const perBatch = Math.floor(LIMITS.batchBytes / size);
    const rows = Array.from({ length: 10 }, (_, index) => rowOf(index + 1, draft));

    const batches = batchesOf(rows);

    expect(perBatch).toBe(4);
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 2]);
    for (const batch of batches) {
      expect(batch.length * size).toBeLessThanOrEqual(LIMITS.batchBytes);
    }
  });

  it('sends an event bigger than a batch on its own', () => {
    const small = draftOf();
    const huge = draftOf({ network: { userAgent: 'x'.repeat(LIMITS.batchBytes) } });

    expect(
      batchesOf([rowOf(1, small), rowOf(2, huge), rowOf(3, small)]).map((batch) =>
        batch.map((row) => row.sourceSeq),
      ),
    ).toEqual([[1], [2], [3]]);
    expect(
      batchesOf([rowOf(1, huge), rowOf(2, small), rowOf(3, small)]).map((batch) =>
        batch.map((row) => row.sourceSeq),
      ),
    ).toEqual([[1], [2, 3]]);
  });
});

describe('retryDelay', () => {
  const middle = () => 0.5;

  it('doubles from the first wait with each attempt', () => {
    expect([0, 1, 2, 3].map((attempts) => retryDelay(attempts, middle))).toEqual([
      RETRY_FIRST_MS,
      RETRY_FIRST_MS * 2,
      RETRY_FIRST_MS * 4,
      RETRY_FIRST_MS * 8,
    ]);
    expect(retryDelay(-1, middle)).toBe(RETRY_FIRST_MS);
  });

  it('never waits more than the longest wait', () => {
    expect(retryDelay(11, middle)).toBe(RETRY_MAX_MS);
    expect(retryDelay(60, middle)).toBe(RETRY_MAX_MS);
  });

  it('adds a jitter of 20% either way', () => {
    expect(retryDelay(2, () => 0)).toBe(6_400);
    expect(retryDelay(2, () => 1)).toBe(9_600);
    expect(retryDelay(60, () => 1)).toBe(4_320_000);
    for (let index = 0; index < 50; index += 1) {
      const delay = retryDelay(3);
      expect(delay).toBeGreaterThanOrEqual(RETRY_FIRST_MS * 8 * 0.8);
      expect(delay).toBeLessThanOrEqual(RETRY_FIRST_MS * 8 * 1.2);
    }
  });
});

describe('ForwarderService', () => {
  describe('while the connector is off', () => {
    it('starts nothing, sends nothing and counts nothing', async () => {
      const harness = new Harness(null);

      harness.forwarder.onApplicationBootstrap();
      await harness.forwarder.tick();
      await harness.forwarder.beat();
      harness.forwarder.onModuleDestroy();

      expect(harness.transport.requests).toEqual([]);
      expect(harness.forwarder.stats).toEqual({ size: 0, oldestAgeSeconds: 0, retrying: 0 });
      expect(logs.lines).toEqual([]);
    });
  });

  describe('its timers', () => {
    it('beats and forwards on its own once the application started, and stops when it is destroyed', async () => {
      const running = new Harness();
      const stopped = new Harness();
      await running.queue(2);
      await stopped.queue(2);

      running.forwarder.onApplicationBootstrap();
      stopped.forwarder.onApplicationBootstrap();
      stopped.forwarder.onModuleDestroy();
      try {
        await new Promise((resolve) => setTimeout(resolve, FORWARD_INTERVAL_MS + 400));

        // The first heartbeat at once, the first round after its interval.
        expect(running.paths()).toEqual([HEARTBEAT, CATALOG, EVENTS]);
        expect(running.store.rows).toEqual([]);
        expect(stopped.transport.requests).toEqual([]);
        expect(stopped.store.rows).toHaveLength(2);
        expect(logs.of('log')).toContain(
          `Forwarding the audit log to ${TEST_CONFIG.hubUrl} as ${TEST_CONFIG.app}`,
        );
      } finally {
        running.forwarder.onModuleDestroy();
      }
    });

    it('reports the last count of the queue to its gauges', async () => {
      const callbacks = new Map<string, ObservableCallback>();
      const noop = createNoopMeter();
      const meter: Meter = Object.assign(Object.create(noop) as Meter, {
        createObservableGauge: (name: string): ObservableGauge =>
          Object.assign(Object.create(noop.createObservableGauge(name)) as ObservableGauge, {
            addCallback: (callback: ObservableCallback) => {
              callbacks.set(name, callback);
            },
          }),
      });
      expect(metrics.setGlobalMeterProvider({ getMeter: () => meter })).toBe(true);
      const harness = new Harness({ ...TEST_CONFIG, queueAlert: 1000 });
      try {
        harness.forwarder.onApplicationBootstrap();
        harness.forwarder.onModuleDestroy();
        harness.answers[CATALOG] = () => ({ status: 500, body: null });
        await harness.queue(3);
        await harness.forwarder.tick();
        now += 7_000;
        await harness.forwarder.tick();

        const observe = async (name: string) => {
          const values: number[] = [];
          await callbacks.get(name)?.({
            observe: (value: number) => {
              values.push(value);
            },
          });
          return values;
        };
        expect(await observe('app.audit.outbox.waiting')).toEqual([3]);
        expect(await observe('app.audit.outbox.oldest_age')).toEqual([7]);
      } finally {
        metrics.disable();
      }
    });
  });

  describe('tick', () => {
    it('runs one round at a time', async () => {
      const harness = new Harness();
      await harness.queue(1);

      await Promise.all([harness.forwarder.tick(), harness.forwarder.tick()]);
      expect(harness.paths()).toEqual([CATALOG, EVENTS]);

      await harness.queue(1);
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([CATALOG, EVENTS, EVENTS]);
    });

    it('leaves the round to the instance that holds the lock', async () => {
      const harness = new Harness();
      await harness.queue(2);
      harness.lock.busy = true;

      await harness.forwarder.tick();

      expect(harness.transport.requests).toEqual([]);
      expect(harness.forwarder.stats.size).toBe(0);

      harness.lock.busy = false;
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([[1, 2]]);
    });

    it('logs a failing round instead of throwing, and runs the next one', async () => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[CATALOG] = () => {
        throw new Error('socket hang up');
      };

      await harness.forwarder.tick();
      harness.answers[CATALOG] = () => {
        throw notAnError;
      };
      await harness.forwarder.tick();

      expect(logs.of('error')).toEqual([
        'Forwarding round failed: socket hang up',
        'Forwarding round failed: plain failure',
      ]);
      harness.answers[CATALOG] = catalogOk;
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([[1]]);
    });
  });

  describe('the catalog', () => {
    it('is published before the first events, and only once', async () => {
      const harness = new Harness();
      await harness.queue(2);

      await harness.forwarder.tick();
      await harness.queue(1);
      await harness.forwarder.tick();

      expect(harness.paths()).toEqual([CATALOG, EVENTS, EVENTS]);
      const [publish] = harness.transport.requests;
      expect(publish?.method).toBe('PUT');
      expect(CatalogPublishSchema.parse(publish?.body)).toEqual({
        contractVersion: CONTRACT_VERSION,
        catalog: harness.audit.catalog,
      });
    });

    it.each([400, 401, 403])('refused with %i pauses the forwarding, loudly', async (status) => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[CATALOG] = () => ({ status, body: { message: 'Invalid signature' } });

      await harness.forwarder.tick();

      expect(harness.paths()).toEqual([CATALOG]);
      expect(harness.forwarder.stats.size).toBe(1);
      expect(logs.of('error')).toEqual([
        `Audit Hub refused the catalog with ${String(status)}: Invalid signature (check the AUDIT_HUB_* variables)`,
      ]);

      harness.answers[CATALOG] = catalogOk;
      now += PAUSE_REFUSED_MS - 1;
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([CATALOG]);

      now += 1;
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([CATALOG, CATALOG, EVENTS]);
    });

    it.each([
      ['no body', null, 'no message'],
      ['a message that is not text', { message: 42 }, 'no message'],
      ['a long message', { message: 'x'.repeat(300) }, 'x'.repeat(200)],
    ])('logs only the message of a refusal (%s)', async (_case, body, logged) => {
      const harness = new Harness();
      harness.answers[CATALOG] = () => ({ status: 401, body });

      await harness.forwarder.tick();

      expect(logs.of('error')).toEqual([
        `Audit Hub refused the catalog with 401: ${logged} (check the AUDIT_HUB_* variables)`,
      ]);
    });

    it.each([
      [429, 7, 7_000],
      [429, undefined, PAUSE_DEFAULT_MS],
      [503, 12, 12_000],
      [503, undefined, PAUSE_DEFAULT_MS],
    ])(
      'answered %i with Retry-After %s pauses the forwarding that long',
      async (status, retryAfterSec, pause) => {
        const harness = new Harness();
        await harness.queue(1);
        harness.answers[CATALOG] = () => ({
          status,
          ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
          body: null,
        });

        await harness.forwarder.tick();
        harness.answers[CATALOG] = catalogOk;
        now += pause - 1;
        await harness.forwarder.tick();
        expect(harness.paths()).toEqual([CATALOG]);

        now += 1;
        await harness.forwarder.tick();
        expect(harness.paths()).toEqual([CATALOG, CATALOG, EVENTS]);
        expect(logs.of('error')).toEqual([]);
      },
    );

    it('answered with another status is tried again once the pause of the outage ends', async () => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[CATALOG] = () => ({ status: 500, body: null });

      await harness.forwarder.tick();
      harness.answers[CATALOG] = catalogOk;
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([CATALOG]);
      now += RETRY_FIRST_MS * 1.2;
      await harness.forwarder.tick();

      expect(harness.paths()).toEqual([CATALOG, CATALOG, EVENTS]);
      expect(logs.of('warn')).toEqual(['Audit Hub answered the catalog with 500']);
    });

    it('unreachable leaves the events waiting for the next round', async () => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[CATALOG] = () => {
        throw new AuditTransportError('timeout');
      };

      await harness.forwarder.tick();

      expect(harness.paths()).toEqual([CATALOG]);
      expect(harness.store.counter).toBeNull();
      expect(logs.of('warn')).toEqual([
        'Audit Hub unreachable (timeout) for the catalog: the events wait',
      ]);

      harness.answers[CATALOG] = catalogOk;
      now += RETRY_FIRST_MS * 1.2;
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([[1]]);
    });

    it('lets any other failure of the transport reach the round', async () => {
      const harness = new Harness();
      harness.answers[CATALOG] = () => {
        throw new Error('certificate expired');
      };

      await expect(harness.forwarder.forward()).rejects.toThrow('certificate expired');
      await harness.forwarder.tick();

      expect(logs.of('error')).toEqual(['Forwarding round failed: certificate expired']);
    });
  });

  describe('sending', () => {
    it('numbers the events gaplessly and stamps them with the current catalog', async () => {
      const harness = new Harness();
      // Queued before a deploy changed the catalog.
      const before = new AuditService(
        { ...TEST_CONFIG, responseActions: [] },
        harness.store,
        clock,
      );
      expect(before.catalogVersion).not.toBe(harness.audit.catalogVersion);
      await before.recordAlone(SIGN_IN);
      await harness.audit.record(TEST_TX, SIGN_OUT);
      await harness.queue(1);
      const drafts = harness.store.rows.map((row) => structuredClone(row.draft));

      await harness.forwarder.tick();

      const [batch] = harness.sent();
      expect(batch).toEqual(
        drafts.map((draft, index) => ({
          ...draft,
          catalogVersion: harness.audit.catalogVersion,
          sourceSeq: index + 1,
        })),
      );
      const request = harness.transport.requests[1];
      expect(request?.method).toBe('POST');
      expect(EventBatchSchema.parse(request?.body)).toMatchObject({
        contractVersion: CONTRACT_VERSION,
        connector: CONNECTOR,
        sequenceEpoch: harness.store.counter?.epoch,
      });
      expect(harness.store.rows).toEqual([]);

      await harness.queue(2);
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([
        [1, 2, 3],
        [4, 5],
      ]);
    });

    it('sends 100 events a round', async () => {
      const harness = new Harness({ ...TEST_CONFIG, queueAlert: 1000 });
      await harness.queue(150);

      await harness.forwarder.tick();
      expect(harness.store.counter?.lastSeq).toBe(150);
      await harness.forwarder.tick();

      expect(harness.seqs()).toEqual([
        Array.from({ length: 100 }, (_, index) => index + 1),
        Array.from({ length: 50 }, (_, index) => index + 101),
      ]);
      expect(harness.store.rows).toEqual([]);
    });
  });

  describe('settling the results', () => {
    it('removes what Audit Hub answered for and keeps what it asks to send again', async () => {
      const harness = new Harness();
      await harness.queue(7);
      harness.answers[EVENTS] = () =>
        answered([
          { index: 0, status: 'accepted' },
          { index: 1, status: 'duplicate' },
          { index: 2, status: 'rejected', reason: 'details_invalid', retryable: false },
          { index: 3, status: 'rejected' },
          { index: 4, status: 'rejected', reason: 'catalog_version_unknown', retryable: true },
          { index: 5, status: 'rejected', reason: 'too_large', retryable: true },
          // index 6: no result
        ]);

      await harness.forwarder.tick();

      expect(harness.store.rows.map((row) => row.sourceSeq)).toEqual([5, 6, 7]);
      for (const seq of [5, 6, 7]) {
        const row = harness.row(seq);
        expect(row.attempts).toBe(1);
        expect(row.lastError).toBe('rejected_retryable');
        expect(row.lockedUntil).toBeNull();
        expect(row.nextAttemptAt).toBeGreaterThanOrEqual(now + RETRY_FIRST_MS * 0.8);
        expect(row.nextAttemptAt).toBeLessThanOrEqual(now + RETRY_FIRST_MS * 1.2);
      }
      expect(logs.of('warn')).toEqual([
        'Audit Hub refused auth.session.signed_in #3: details_invalid',
        'Audit Hub refused auth.session.signed_in #4: no reason',
      ]);

      // catalog_version_unknown: the catalog is published again first.
      harness.answers[EVENTS] = acceptAll;
      now += HOURS_2;
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([CATALOG, EVENTS, CATALOG, EVENTS]);
      expect(harness.seqs()).toEqual([
        [1, 2, 3, 4, 5, 6, 7],
        [5, 6, 7],
      ]);
      expect(harness.store.rows).toEqual([]);
    });

    it('sends again the events left without a result, the catalog still published', async () => {
      const harness = new Harness();
      await harness.queue(3);
      harness.answers[EVENTS] = () => answered([{ index: 0, status: 'accepted' }]);

      await harness.forwarder.tick();
      expect(harness.store.rows.map((row) => row.sourceSeq)).toEqual([2, 3]);

      harness.answers[EVENTS] = acceptAll;
      now += HOURS_2;
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([CATALOG, EVENTS, EVENTS]);
      expect(harness.seqs()).toEqual([
        [1, 2, 3],
        [2, 3],
      ]);
    });

    it('waits longer for an event the more attempts it failed', async () => {
      const harness = new Harness();
      await harness.queue(2);
      harness.answers[EVENTS] = () => answered([{ index: 1, status: 'accepted' }]);
      await harness.forwarder.tick();
      await harness.queue(1);
      harness.answers[EVENTS] = () => answered([]);

      now += HOURS_2;
      await harness.forwarder.tick();

      expect(harness.seqs()).toEqual([
        [1, 2],
        [1, 3],
      ]);
      const first = harness.row(1);
      const third = harness.row(3);
      expect(first.attempts).toBe(2);
      expect(first.nextAttemptAt).toBeGreaterThanOrEqual(now + RETRY_FIRST_MS * 2 * 0.8);
      expect(first.nextAttemptAt).toBeLessThanOrEqual(now + RETRY_FIRST_MS * 2 * 1.2);
      expect(third.attempts).toBe(1);
      expect(third.nextAttemptAt).toBeGreaterThanOrEqual(now + RETRY_FIRST_MS * 0.8);
      expect(third.nextAttemptAt).toBeLessThanOrEqual(now + RETRY_FIRST_MS * 1.2);
    });

    it.each([
      ['a result that is not one', ok({ results: 'none' })],
      ['no envelope', { status: 200, body: null }],
    ])('sends everything again after %s', async (_case, response) => {
      const harness = new Harness();
      await harness.queue(2);
      harness.answers[EVENTS] = () => response;

      await harness.forwarder.tick();

      expect(harness.store.rows.map((row) => [row.sourceSeq, row.attempts, row.lastError])).toEqual(
        [
          [1, 1, 'bad_answer'],
          [2, 1, 'bad_answer'],
        ],
      );
      expect(logs.of('error')).toEqual([
        'Audit Hub answered a batch with something that is not its result',
      ]);
    });
  });

  describe('a batch refused as a whole', () => {
    it.each([
      [429, 20, 20_000],
      [503, 20, 20_000],
      [429, undefined, PAUSE_DEFAULT_MS],
    ])(
      'with %i and Retry-After %s pauses every event without counting an attempt',
      async (status, retryAfterSec, pause) => {
        const harness = new Harness();
        await harness.queue(3);
        harness.answers[EVENTS] = () => ({
          status,
          ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
          body: null,
        });

        await harness.forwarder.tick();

        expect(
          harness.store.rows.map((row) => [row.attempts, row.nextAttemptAt, row.lastError]),
        ).toEqual(Array.from({ length: 3 }, () => [0, now + pause, `http_${String(status)}`]));

        // Nothing is sent while paused, not even the catalog.
        harness.answers[EVENTS] = acceptAll;
        now += pause - 1;
        await harness.forwarder.tick();
        expect(harness.paths()).toEqual([CATALOG, EVENTS]);

        now += 1;
        await harness.forwarder.tick();
        expect(harness.seqs()).toEqual([
          [1, 2, 3],
          [1, 2, 3],
        ]);
        expect(harness.store.rows).toEqual([]);
      },
    );

    it('pauses the rest of the round with it', async () => {
      const harness = new Harness();
      const req = {
        ip: '203.0.113.7',
        method: 'POST',
        baseUrl: '',
        get: (name: string) => (name === 'user-agent' ? 'u'.repeat(LIMITS.userAgent) : undefined),
      } as unknown as Request;
      const big = {
        ...SIGN_IN,
        resource: { type: 'session', id: 'i'.repeat(128), label: 'l'.repeat(LIMITS.label) },
      } satisfies AuditInput;
      for (let index = 0; index < LIMITS.batchEvents; index += 1) {
        await harness.audit.record(TEST_TX, big, req);
      }
      harness.answers[EVENTS] = () => ({ status: 429, retryAfterSec: 20, body: null });

      await harness.forwarder.tick();

      const [first, ...others] = harness.seqs();
      const sent = first?.length ?? 0;
      expect(others).toEqual([]);
      expect(sent).toBeGreaterThan(0);
      expect(sent).toBeLessThan(LIMITS.batchEvents);
      expect(harness.store.rows).toHaveLength(LIMITS.batchEvents);
      for (const row of harness.store.rows) {
        expect(row.attempts).toBe(0);
        expect(row.nextAttemptAt).toBe(now + 20_000);
        expect(row.lastError).toBe((row.sourceSeq ?? 0) <= sent ? 'http_429' : 'paused');
      }
    });

    it.each([400, 401, 403])(
      'with %i pauses the forwarding for the refused wait, loudly',
      async (status) => {
        const harness = new Harness();
        await harness.queue(2);
        harness.answers[EVENTS] = () => ({ status, body: { message: 'Unknown key' } });

        await harness.forwarder.tick();

        expect(
          harness.store.rows.map((row) => [row.attempts, row.nextAttemptAt, row.lastError]),
        ).toEqual([
          [0, now + PAUSE_REFUSED_MS, `http_${String(status)}`],
          [0, now + PAUSE_REFUSED_MS, `http_${String(status)}`],
        ]);
        expect(logs.of('error')).toEqual([
          `Audit Hub refused the events with ${String(status)}: Unknown key (check the AUDIT_HUB_* variables)`,
        ]);

        harness.answers[EVENTS] = acceptAll;
        now += PAUSE_REFUSED_MS - 1;
        await harness.forwarder.tick();
        expect(harness.seqs()).toHaveLength(1);
        now += 1;
        await harness.forwarder.tick();
        expect(harness.seqs()).toEqual([
          [1, 2],
          [1, 2],
        ]);
      },
    );

    it.each([
      ['500', { status: 500, body: null }],
      ['429 with Retry-After 0', { status: 429, retryAfterSec: 0, body: null }],
    ])('with %s is sent again later, an attempt counted', async (_case, response) => {
      const harness = new Harness();
      await harness.queue(2);
      harness.answers[EVENTS] = () => response;

      await harness.forwarder.tick();

      for (const row of harness.store.rows) {
        expect(row.attempts).toBe(1);
        expect(row.lastError).toBe(`http_${String(response.status)}`);
        expect(row.nextAttemptAt).toBeGreaterThanOrEqual(now + RETRY_FIRST_MS * 0.8);
        expect(row.nextAttemptAt).toBeLessThanOrEqual(now + RETRY_FIRST_MS * 1.2);
      }

      harness.answers[EVENTS] = acceptAll;
      now += RETRY_FIRST_MS * 1.2;
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([
        [1, 2],
        [1, 2],
      ]);
    });

    it('logs another status as a warning', async () => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[EVENTS] = () => ({ status: 502, body: null });

      await harness.forwarder.tick();

      expect(logs.of('warn')).toEqual(['Audit Hub answered the events with 502']);
    });

    it('unreachable waits for the queue to try again, no attempt counted', async () => {
      const harness = new Harness();
      await harness.queue(2);
      harness.answers[EVENTS] = () => {
        throw new AuditTransportError('network');
      };

      await harness.forwarder.tick();

      expect(harness.store.rows.map((row) => [row.attempts, row.lastError])).toEqual([
        [0, 'unreachable'],
        [0, 'unreachable'],
      ]);
      const [first, second] = harness.store.rows;
      expect(first?.nextAttemptAt).toBe(second?.nextAttemptAt);
      expect(first?.nextAttemptAt).toBeGreaterThanOrEqual(now + RETRY_FIRST_MS * 0.8);
      expect(first?.nextAttemptAt).toBeLessThanOrEqual(now + RETRY_FIRST_MS * 1.2);
      expect(logs.of('warn')).toEqual([
        'Audit Hub unreachable (network) for the events: the events wait',
      ]);
    });

    it.each([502, 504])(
      'with %s (a proxy that found no Audit Hub) waits the same way',
      async (status) => {
        const harness = new Harness();
        await harness.queue(2);
        harness.answers[EVENTS] = () => ({ status, body: null });

        await harness.forwarder.tick();

        expect(harness.store.rows.map((row) => [row.attempts, row.lastError])).toEqual([
          [0, `http_${String(status)}`],
          [0, `http_${String(status)}`],
        ]);
        harness.answers[EVENTS] = acceptAll;
        now += RETRY_FIRST_MS * 1.2;
        await harness.forwarder.tick();
        expect(harness.store.rows).toEqual([]);
      },
    );

    it('failing otherwise keeps the events leased until the lease ends', async () => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[EVENTS] = () => {
        throw new Error('out of memory');
      };

      await harness.forwarder.tick();
      expect(logs.of('error')).toEqual(['Forwarding round failed: out of memory']);
      expect(harness.store.rows).toHaveLength(1);

      harness.answers[EVENTS] = acceptAll;
      now += LEASE_MS;
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([[1]]);
      now += 1;
      await harness.forwarder.tick();
      expect(harness.seqs()).toEqual([[1], [1]]);
      expect(harness.store.rows).toEqual([]);
    });
  });

  it('pauses the whole queue while Audit Hub is down, doubling up to a minute between tries', async () => {
    const harness = new Harness();
    await harness.queue(150);
    harness.answers[EVENTS] = () => {
      throw new AuditTransportError('network');
    };
    const tries: number[] = [];
    const tick = async () => {
      const before = harness.transport.requests.length;
      await harness.forwarder.tick();
      if (harness.transport.requests.length > before) tries.push(now);
    };

    // Ten minutes, a round every second: without the pause, 600 requests.
    for (let second = 0; second < 600; second += 1) {
      await tick();
      now += 1_000;
    }

    const waits = tries.slice(1).map((at, index) => at - (tries[index] ?? at));
    expect(tries.length).toBeGreaterThan(8);
    expect(tries.length).toBeLessThan(20);
    expect(waits.at(0)).toBeLessThanOrEqual(RETRY_FIRST_MS * 1.2 + 1_000);
    for (const wait of waits.slice(-4)) {
      expect(wait).toBeGreaterThanOrEqual(OUTAGE_PAUSE_MAX_MS);
      expect(wait).toBeLessThanOrEqual(OUTAGE_PAUSE_MAX_MS + 1_000);
    }

    // Back: the whole queue drains in two rounds (a hundred events each), however
    // long it was gone, and the next failure waits from the start again.
    harness.answers[EVENTS] = acceptAll;
    now += OUTAGE_PAUSE_MAX_MS;
    expect(harness.store.rows.every((row) => row.attempts === 0)).toBe(true);
    for (let round = 0; round < 2; round += 1) {
      await tick();
      now += FORWARD_INTERVAL_MS;
    }
    expect(harness.store.rows).toEqual([]);
    await harness.queue(1);
    harness.answers[EVENTS] = () => {
      throw new AuditTransportError('network');
    };
    tries.length = 0;
    for (let second = 0; second < 4; second += 1) {
      await tick();
      now += 1_000;
    }
    expect(tries).toHaveLength(2);
  });

  it('delivers every event once and in order when Audit Hub goes down and comes back', async () => {
    const harness = new Harness();
    const stored: AuditEvent[] = [];
    let hub: 'down' | 'answer lost' | 'busy' | 'up' = 'down';
    harness.answers[EVENTS] = (request) => {
      if (hub === 'down') throw new AuditTransportError('network');
      if (hub === 'busy') return { status: 503, retryAfterSec: 30, body: null };
      const { events } = EventBatchSchema.parse(request.body);
      const results = events.map((event, index) => {
        const known = stored.some((candidate) => candidate.eventId === event.eventId);
        if (!known) stored.push(event);
        return { index, status: known ? ('duplicate' as const) : ('accepted' as const) };
      });
      // Stored, but the answer never arrives.
      if (hub === 'answer lost') throw new AuditTransportError('timeout');
      return answered(results);
    };

    await harness.queue(3);
    await harness.forwarder.tick();
    now += HOURS_2;
    await harness.queue(2);
    hub = 'answer lost';
    await harness.forwarder.tick();
    now += HOURS_2;
    hub = 'busy';
    await harness.forwarder.tick();
    hub = 'up';
    now += 10_000;
    await harness.forwarder.tick();
    now += 20_000;
    await harness.forwarder.tick();
    await harness.queue(1);
    await harness.forwarder.tick();

    expect(harness.seqs()).toEqual([
      [1, 2, 3],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [6],
    ]);
    const [, lost, , resent] = harness.sent();
    expect(resent?.map((event) => event.eventId)).toEqual(lost?.map((event) => event.eventId));
    expect(stored.map((event) => event.sourceSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(stored.map((event) => event.eventId)).size).toBe(6);
    expect(harness.store.rows).toEqual([]);
    expect(harness.forwarder.stats).toEqual({ size: 0, oldestAgeSeconds: 0, retrying: 0 });
  });

  describe('counting the queue', () => {
    it('warns once when it backs up, and says when it is back below 90%', async () => {
      const harness = new Harness({ ...TEST_CONFIG, queueAlert: 10 });
      harness.answers[CATALOG] = () => ({ status: 500, body: null });
      const queueLogs = () => logs.matching('Audit queue');
      const shrink = (count: number) =>
        harness.store.remove(harness.store.rows.slice(0, count).map((row) => row.id));

      await harness.queue(11);
      await harness.forwarder.tick();
      now += 5_000;
      await harness.forwarder.tick();
      expect(queueLogs()).toEqual(['Audit queue backed up: 11 events waiting, the oldest 0s old']);
      expect(harness.forwarder.stats).toEqual({ size: 11, oldestAgeSeconds: 5, retrying: 0 });

      await shrink(1);
      await harness.forwarder.tick();
      expect(queueLogs()).toHaveLength(1);

      await shrink(1);
      await harness.forwarder.tick();
      await harness.forwarder.tick();
      expect(queueLogs()).toEqual([
        'Audit queue backed up: 11 events waiting, the oldest 0s old',
        'Audit queue back to 9 events',
      ]);

      await harness.queue(2);
      await harness.forwarder.tick();
      expect(queueLogs()).toHaveLength(3);
      expect(queueLogs()[2]).toBe('Audit queue backed up: 11 events waiting, the oldest 5s old');
    });
  });

  describe('the heartbeat', () => {
    it("reports this instance and the queue's state, then sweeps", async () => {
      const store = new SweptStore();
      const harness = new Harness(TEST_CONFIG, store);
      // Failed on by Audit Hub, so retrying (an outage's wait is not).
      harness.answers[EVENTS] = () => ({ status: 500, body: null });
      await harness.queue(3);
      await harness.forwarder.tick();
      now += 4_000;

      await harness.forwarder.beat();
      // A device reported events it dropped at sign-out: counted since this instance started.
      harness.audit.countDiscarded(4);
      await harness.forwarder.beat();

      const beats = harness.transport.requests.filter((request) => request.path === HEARTBEAT);
      expect(beats.map((request) => request.method)).toEqual(['POST', 'POST']);
      const [first, second] = beats.map((request) => HeartbeatSchema.parse(request.body));
      expect(first).toEqual({
        contractVersion: CONTRACT_VERSION,
        connector: CONNECTOR,
        instanceId: expect.any(String) as string,
        appVersion: TEST_CONFIG.appVersion,
        catalogVersion: harness.audit.catalogVersion,
        sequenceEpoch: store.counter?.epoch,
        lastAssignedSeq: 3,
        queue: { size: 3, oldestAgeSeconds: 0, retrying: 3, discardedAtSignOut: 0 },
        responseActions: [...TEST_CONFIG.responseActions],
      });
      expect(second?.instanceId).toBe(first?.instanceId);
      expect(second?.queue.discardedAtSignOut).toBe(4);
      expect(store.sweeps).toEqual([
        `receipts before ${new Date(now - RECEIPT_TTL_MS).toISOString()}`,
        `prompts before ${new Date(now - PROMPT_KEEP_MS).toISOString()}`,
        `receipts before ${new Date(now - RECEIPT_TTL_MS).toISOString()}`,
        `prompts before ${new Date(now - PROMPT_KEEP_MS).toISOString()}`,
      ]);

      const other = new Harness();
      await other.forwarder.beat();
      const [otherBeat] = other.transport.requests.map((request) =>
        HeartbeatSchema.parse(request.body),
      );
      expect(otherBeat?.instanceId).not.toBe(first?.instanceId);
      expect(otherBeat?.lastAssignedSeq).toBe(0);
    });

    it('refused is logged and the sweeps still run', async () => {
      const store = new SweptStore();
      const harness = new Harness(TEST_CONFIG, store);
      harness.answers[HEARTBEAT] = () => ({ status: 401, body: { message: 'Unknown key' } });
      await harness.forwarder.beat();
      harness.answers[HEARTBEAT] = () => ({ status: 500, body: null });
      await harness.forwarder.beat();

      expect(logs.of('error')).toEqual([
        'Audit Hub refused the heartbeat with 401: Unknown key (check the AUDIT_HUB_* variables)',
      ]);
      expect(logs.of('warn')).toEqual(['Audit Hub answered the heartbeat with 500']);
      expect(store.sweeps).toHaveLength(4);
    });

    it('answered 503 pauses the forwarding too', async () => {
      const harness = new Harness();
      await harness.queue(1);
      harness.answers[HEARTBEAT] = () => ({ status: 503, retryAfterSec: 10, body: null });

      await harness.forwarder.beat();
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([HEARTBEAT]);

      now += 10_000;
      await harness.forwarder.tick();
      expect(harness.paths()).toEqual([HEARTBEAT, CATALOG, EVENTS]);
    });

    it('unreachable is logged, not thrown, and the sweeps still run', async () => {
      const store = new SweptStore();
      const harness = new Harness(TEST_CONFIG, store);
      harness.answers[HEARTBEAT] = () => {
        throw new AuditTransportError('timeout');
      };

      await harness.forwarder.beat();

      expect(logs.of('warn')).toEqual([
        'Audit Hub unreachable (timeout) for the heartbeat: the events wait',
      ]);
      expect(store.sweeps).toHaveLength(2);
    });

    it('logs sweeps that fail, without throwing', async () => {
      const store = new SweptStore();
      store.forgetPrompts = () => Promise.reject(new Error('pool exhausted'));
      const harness = new Harness(TEST_CONFIG, store);

      await harness.forwarder.beat();

      expect(logs.of('error')).toEqual(['Audit sweeps failed: pool exhausted']);
      expect(store.sweeps).toHaveLength(1);
    });

    it.each([
      ['an error', new Error('pool exhausted'), 'pool exhausted'],
      ['something else', notAnError, 'plain failure'],
    ])('failing with %s is logged, not thrown', async (_case, failure, logged) => {
      const harness = new Harness();
      harness.answers[HEARTBEAT] = () => {
        throw failure;
      };

      await harness.forwarder.beat();

      expect(logs.of('error')).toEqual([`Heartbeat failed: ${logged}`]);
    });
  });
});
