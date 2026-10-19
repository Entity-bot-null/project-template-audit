import { ConsoleLogger, Logger, type LoggerService } from '@nestjs/common';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONNECTOR, SAMPLE_MAX_PER_WINDOW, SAMPLE_WINDOW_MS } from './audit.constants.js';
import { AuditEventInvalidError, AuditService } from './audit.service.js';
import { MemoryStore, TEST_CONFIG, TEST_TX } from './audit.testing.js';
import { catalogDocument, catalogVersion } from './catalog/catalog.js';
import {
  type AuditEventDraft,
  CatalogDocumentSchema,
  emailHmac,
  secretKey,
} from './contract/index.js';
import { runInScope } from './request-scope.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const clock = () => NOW;

/** Nest's logger, recorded: the service logs what it cannot queue. */
class RecordingLogger implements LoggerService {
  readonly errors: unknown[] = [];
  log(): void {
    // Not asserted.
  }
  warn(): void {
    // Not asserted.
  }
  error(message: unknown): void {
    this.errors.push(message);
  }
}

/** A database that fails every write on its own. */
class FailingStore extends MemoryStore {
  constructor(private readonly failure: unknown) {
    super();
  }
  override async enqueueAlone(): Promise<Set<string>> {
    await Promise.resolve();
    throw this.failure;
  }
}

function fakeRequest(ip: string, user?: { id: string; role: string }): Request {
  return {
    ip,
    method: 'POST',
    baseUrl: '/api',
    route: { path: '/auth/sign-in' },
    user,
    get: () => undefined,
  } as unknown as Request;
}

let logger: RecordingLogger;

beforeEach(() => {
  logger = new RecordingLogger();
  Logger.overrideLogger(logger);
});

afterEach(() => {
  Logger.overrideLogger(new ConsoleLogger());
});

describe('AuditService, connected', () => {
  let store: MemoryStore;
  let audit: AuditService;

  beforeEach(() => {
    store = new MemoryStore();
    audit = new AuditService(TEST_CONFIG, store, clock);
  });

  it('is enabled, with the catalog of the app', () => {
    expect(audit.enabled).toBe(true);
    expect(audit.catalog).toEqual(
      catalogDocument(TEST_CONFIG.app, CONNECTOR.version, TEST_CONFIG.responseActions),
    );
    expect(audit.catalog.responseActions).toEqual(['revoke_sessions']);
    expect(CatalogDocumentSchema.safeParse(audit.catalog).success).toBe(true);
    expect(audit.catalogVersion).toBe(catalogVersion(audit.catalog));
  });

  it('queues an event in the caller transaction, stamped with the catalog version', async () => {
    await audit.record(TEST_TX, { action: 'auth.session.signed_out' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.draft).toMatchObject({
      action: 'auth.session.signed_out',
      catalogVersion: audit.catalogVersion,
      occurredAt: '2026-10-15T12:00:00.000Z',
    });
  });

  it('queues nothing when the transaction rolls back', async () => {
    await audit.record(TEST_TX, { action: 'auth.session.signed_out' });
    await expect(
      store.transaction(async (tx) => {
        await audit.record(tx, { action: 'auth.password.changed' });
        expect(store.rows).toHaveLength(2);
        throw new Error('the write failed');
      }),
    ).rejects.toThrow('the write failed');
    expect(store.rows.map((row) => row.draft.action)).toEqual(['auth.session.signed_out']);
  });

  it('queues when the transaction commits', async () => {
    const answer = await store.transaction(async (tx) => {
      await audit.record(tx, { action: 'auth.password.changed' });
      return 'done';
    });
    expect(answer).toBe('done');
    expect(store.rows).toHaveLength(1);
  });

  it('refuses an invalid event', async () => {
    await expect(audit.record(TEST_TX, { action: 'auth.session.sign_in_failed' })).rejects.toThrow(
      AuditEventInvalidError,
    );
    expect(store.rows).toHaveLength(0);
  });

  it('queues an event on its own', async () => {
    await expect(
      audit.recordAlone({ action: 'auth.session.sign_in_failed', outcome: 'failure' }),
    ).resolves.toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(logger.errors).toEqual([]);
  });

  it('answers false and logs when the event cannot be queued on its own', async () => {
    const failing = new AuditService(TEST_CONFIG, new FailingStore(new Error('db down')), clock);
    await expect(
      failing.recordAlone({ action: 'http.request.rate_limited', outcome: 'denied' }),
    ).resolves.toBe(false);
    const unknownFailure: unknown = 'connection reset';
    const odd = new AuditService(TEST_CONFIG, new FailingStore(unknownFailure), clock);
    await expect(
      odd.recordAlone({ action: 'http.request.rate_limited', outcome: 'denied' }),
    ).resolves.toBe(false);
    expect(logger.errors).toEqual([
      'Could not queue http.request.rate_limited: db down',
      'Could not queue http.request.rate_limited: connection reset',
    ]);
  });

  it('still throws for an invalid event queued on its own', async () => {
    await expect(audit.recordAlone({ action: 'client.session.expired' })).rejects.toThrow(
      AuditEventInvalidError,
    );
    const failing = new AuditService(TEST_CONFIG, new FailingStore(new Error('db down')), clock);
    await expect(failing.recordAlone({ action: 'client.session.expired' })).rejects.toThrow(
      AuditEventInvalidError,
    );
    expect(store.rows).toHaveLength(0);
    expect(logger.errors).toEqual([]);
  });

  it('describes a change with the fields the action declares', async () => {
    const pseudonym = {
      old: audit.emailPseudonym('ana@example.com'),
      new: audit.emailPseudonym('ana@example.org'),
    };
    const before = { id: 'user-1', emailHmac: pseudonym.old, email: 'ana@example.com' };
    const after = { id: 'user-1', emailHmac: pseudonym.new, email: 'ana@example.org' };
    const change = audit.change('account.email.changed', before, after);
    expect(change).toEqual({
      before: { emailHmac: pseudonym.old },
      after: { emailHmac: pseudonym.new },
      changedFields: ['emailHmac'],
    });
    await audit.record(TEST_TX, { action: 'account.email.changed', change });
    expect(store.rows[0]?.draft.change).toEqual(change);
    expect(() => audit.change('auth.session.signed_in', before, after)).toThrow(TypeError);
  });

  it('builds from the current scope, or from the request it is given', () => {
    const inScope = runInScope({ ip: '203.0.113.7', user: { id: 'user-1', role: 'member' } }, () =>
      audit.build({ action: 'auth.session.signed_out' }),
    );
    expect(inScope.network).toEqual({ ip: '203.0.113.7' });
    expect(inScope.actor).toEqual({ type: 'user', id: 'user-1', role: 'member' });

    const fromRequest = runInScope({ ip: '203.0.113.7' }, () =>
      audit.build(
        { action: 'auth.session.signed_out' },
        fakeRequest('::ffff:198.51.100.4', { id: 'user-2', role: 'admin' }),
      ),
    );
    expect(fromRequest.network).toEqual({ ip: '198.51.100.4' });
    expect(fromRequest.actor).toEqual({ type: 'user', id: 'user-2', role: 'admin' });
    expect(fromRequest.request).toEqual({ method: 'POST', route: '/api/auth/sign-in' });

    const outside = audit.build({ action: 'auth.session.signed_out' });
    expect(outside.actor).toEqual({ type: 'anonymous' });
    expect(outside).not.toHaveProperty('network');
  });

  it('counts what devices dropped at sign-out, ignoring what is not a count', () => {
    expect(audit.discardedAtSignOut).toBe(0);
    for (const count of [3, 0, -2, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, 4]) {
      audit.countDiscarded(count);
    }
    expect(audit.discardedAtSignOut).toBe(7);
  });

  it('turns an email into its pseudonym with the app key', () => {
    const key = secretKey(TEST_CONFIG.pseudonymKey);
    expect(audit.emailPseudonym('ana@example.com')).toBe(emailHmac(key, 'ana@example.com'));
    expect(audit.emailPseudonym(' Ana@Example.com ')).toBe(audit.emailPseudonym('ana@example.com'));
    expect(audit.emailPseudonym('ana@example.com')).not.toBe(
      audit.emailPseudonym('bo@example.com'),
    );
  });

  it('pseudonymizes the actor email with the app key', () => {
    const event = audit.build({
      action: 'auth.password_reset.requested',
      actor: { type: 'anonymous', email: 'ana@example.com' },
    });
    expect(event.actor.emailHmac).toBe(
      emailHmac(secretKey(TEST_CONFIG.pseudonymKey), 'ana@example.com'),
    );
  });

  it('queues an event given the request outside a handler', async () => {
    await audit.recordAlone(
      { action: 'http.request.cross_origin_refused', outcome: 'denied' },
      fakeRequest('203.0.113.9'),
    );
    await audit.record(TEST_TX, { action: 'auth.session.signed_out' }, fakeRequest('203.0.113.10'));
    expect(store.rows.map((row) => row.draft.network)).toEqual([
      { ip: '203.0.113.9' },
      { ip: '203.0.113.10' },
    ]);
  });
});

describe('AuditService.recordSampled', () => {
  const refused = { action: 'http.request.cross_origin_refused', outcome: 'denied' } as const;
  let now: number;
  let store: MemoryStore;
  let audit: AuditService;

  beforeEach(() => {
    now = NOW - (NOW % SAMPLE_WINDOW_MS);
    store = new MemoryStore();
    audit = new AuditService(TEST_CONFIG, store, () => now);
  });

  it('queues the first event per action, address and route each window', async () => {
    await expect(audit.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(true);
    await expect(audit.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(false);
    await expect(audit.recordSampled(refused, fakeRequest('203.0.113.10'))).resolves.toBe(true);
    await expect(
      audit.recordSampled(
        { action: 'http.request.rate_limited', outcome: 'denied' },
        fakeRequest('203.0.113.9'),
      ),
    ).resolves.toBe(true);
    now += SAMPLE_WINDOW_MS - 1;
    await expect(audit.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(false);
    now += 1;
    await expect(audit.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(true);
    expect(store.rows.map((row) => [row.draft.action, row.draft.network?.ip])).toEqual([
      ['http.request.cross_origin_refused', '203.0.113.9'],
      ['http.request.cross_origin_refused', '203.0.113.10'],
      ['http.request.rate_limited', '203.0.113.9'],
      ['http.request.cross_origin_refused', '203.0.113.9'],
    ]);
  });

  it('queues at most SAMPLE_MAX_PER_WINDOW events a window, whatever the addresses', async () => {
    for (let i = 0; i <= SAMPLE_MAX_PER_WINDOW; i++) {
      await audit.recordSampled(refused, fakeRequest(`10.0.${String(i >> 8)}.${String(i & 255)}`));
    }
    expect(store.rows).toHaveLength(SAMPLE_MAX_PER_WINDOW);
    now += SAMPLE_WINDOW_MS;
    await expect(audit.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(true);
  });

  it('answers false and logs when the event cannot be queued', async () => {
    const failing = new AuditService(TEST_CONFIG, new FailingStore(new Error('down')), clock);
    await expect(failing.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(false);
    expect(logger.errors).toEqual(['Could not queue http.request.cross_origin_refused: down']);
  });

  it('validates every event, sampled out or not, and queues nothing while off', async () => {
    const off = new AuditService(null, store, clock);
    await expect(off.recordSampled(refused, fakeRequest('203.0.113.9'))).resolves.toBe(false);
    await expect(
      off.recordSampled({ action: 'client.session.expired' }, fakeRequest('203.0.113.9')),
    ).rejects.toThrow(AuditEventInvalidError);
    await audit.recordSampled(refused, fakeRequest('203.0.113.9'));
    await expect(
      audit.recordSampled({ ...refused, details: { fetchSite: 'sideways' } }),
    ).rejects.toThrow(AuditEventInvalidError);
    expect(store.rows).toHaveLength(1);
  });
});

describe('AuditService, not connected', () => {
  let store: MemoryStore;
  let audit: AuditService;

  beforeEach(() => {
    store = new MemoryStore();
    audit = new AuditService(null, store, clock);
  });

  it('is disabled, with a catalog of its own', () => {
    expect(audit.enabled).toBe(false);
    expect(audit.catalog.app.name).toBe('unconfigured');
    expect(audit.catalog).not.toHaveProperty('responseActions');
    expect(CatalogDocumentSchema.safeParse(audit.catalog).success).toBe(true);
    expect(audit.catalogVersion).toBe(catalogVersion(audit.catalog));
    expect(audit.catalogVersion).not.toBe(
      new AuditService(TEST_CONFIG, store, clock).catalogVersion,
    );
  });

  it('queues nothing', async () => {
    await audit.record(TEST_TX, { action: 'auth.session.signed_out' });
    await expect(audit.recordAlone({ action: 'auth.session.signed_out' })).resolves.toBe(false);
    expect(store.rows).toHaveLength(0);
  });

  it('still validates every event, so a wrong call fails the tests', async () => {
    await expect(audit.record(TEST_TX, { action: 'auth.session.sign_in_failed' })).rejects.toThrow(
      AuditEventInvalidError,
    );
    await expect(audit.recordAlone({ action: 'client.session.expired' })).rejects.toThrow(
      AuditEventInvalidError,
    );
    expect(() =>
      audit.build({
        action: 'auth.session.signed_in',
        details: { method: 'carrier_pigeon' },
      }),
    ).toThrow(AuditEventInvalidError);
  });

  it('still pseudonymizes emails, with a key that is never sent anywhere', () => {
    expect(audit.emailPseudonym('ana@example.com')).toBe(
      emailHmac(Buffer.alloc(32), 'ana@example.com'),
    );
    const event: AuditEventDraft = audit.build({
      action: 'auth.password_reset.requested',
      actor: { type: 'anonymous', email: 'ana@example.com' },
    });
    expect(event.actor.emailHmac).toBe(emailHmac(Buffer.alloc(32), 'ana@example.com'));
  });
});
