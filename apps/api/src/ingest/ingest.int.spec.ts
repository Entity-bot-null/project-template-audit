import { createHash } from 'node:crypto';
import { newNonce } from 'audit-contract/node';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { envelopeOf } from '../../test/http.js';
import {
  batch,
  EPOCH,
  publishCatalog,
  registerApp,
  signed,
  type TestConnectedApp,
  testCatalog,
  testEvent,
} from '../../test/ingest.js';
import { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import { contentHashOf, type EventRow } from './event-rows.js';
import { SequenceMonitorService } from './sequence-monitor.service.js';

interface Results {
  results: {
    index: number;
    status: string;
    reason?: string;
    retryable?: boolean;
    truncatedFields?: string[];
  }[];
  accepted: number;
  duplicates: number;
  rejected: number;
}

// The ingestion API against a real database (docs/design/audit-hub/contract.md
// and the acceptance criteria of the brief): signatures, idempotency,
// per-event results, catalogs, sequences and heartbeats.
describe('ingestion (integration)', () => {
  let t: TestApp;
  let connected: TestConnectedApp;
  let version: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    connected = await registerApp(t.app);
    version = await publishCatalog(t.server, connected);
  });

  const send = (events: unknown[], options = {}) =>
    signed(t.server, connected, 'POST', '/api/ingest/events', batch(events), options);

  describe('signatures', () => {
    it('accepts a valid batch once, however often it arrives', async () => {
      const events = [testEvent(version, 1), testEvent(version, 2)];
      const first = await send(events).expect(200);
      expect(envelopeOf<Results>(first).data).toMatchObject({
        accepted: 2,
        duplicates: 0,
        rejected: 0,
      });
      const again = await send(events).expect(200);
      expect(envelopeOf<Results>(again).data).toMatchObject({
        accepted: 0,
        duplicates: 2,
        rejected: 0,
      });
      expect(await t.prisma.auditEvent.count()).toBe(2);
    });

    it('refuses a bad signature, a changed body, an unknown key and a malformed request', async () => {
      const body = batch([testEvent(version, 1)]);
      const wrongKey = Buffer.alloc(32, 1).toString('base64url');
      for (const res of [
        await signed(t.server, connected, 'POST', '/api/ingest/events', body, {
          keySecret: wrongKey,
        }),
        await signed(t.server, connected, 'POST', '/api/ingest/events', body, {
          sentBody: batch([testEvent(version, 2)]),
        }),
        await signed(t.server, connected, 'POST', '/api/ingest/events', body, {
          keyId: '0199e0b1-0000-7000-8000-0000000000ff',
        }),
      ]) {
        expect(res.status).toBe(401);
        expect(res.headers['audit-error']).toBe('unauthorized');
      }
      // No signature at all.
      await request(t.server).post('/api/ingest/events').send(body).expect(401);
      expect(await t.prisma.auditEvent.count()).toBe(0);
    });

    it('refuses an expired timestamp, saying so, and a replayed nonce', async () => {
      const stale = await send([testEvent(version, 1)], { now: Date.now() - 10 * 60_000 }).expect(
        401,
      );
      expect(stale.headers['audit-error']).toBe('timestamp_skew');
      const nonce = newNonce();
      await send([testEvent(version, 1)], { nonce }).expect(200);
      const replay = await send([testEvent(version, 2)], { nonce }).expect(401);
      expect(replay.headers['audit-error']).toBe('unauthorized');
      expect(await t.prisma.auditEvent.count()).toBe(1);
    });

    it('keeps the replaced key valid for its grace period and refuses a revoked one', async () => {
      const service = t.app.get(ConnectedAppsService);
      const rotated = await service.createKey('0199e0b1-0000-7000-8000-00000000000a', connected.id);
      await send([testEvent(version, 1)]).expect(200);
      await send([testEvent(version, 2)], {
        keyId: rotated.keyId,
        keySecret: rotated.keySecret,
      }).expect(200);
      await service.revokeKey(connected.id, connected.keyId);
      await send([testEvent(version, 3)]).expect(401);
    });

    it('answers 403 for a suspended application and 429 past its quota', async () => {
      await t.prisma.connectedApp.update({
        where: { id: connected.id },
        data: { status: 'suspended' },
      });
      const suspended = await send([testEvent(version, 1)]).expect(403);
      expect(suspended.headers['audit-error']).toBe('app_suspended');
      // The quota counts per application: another one, allowed one request a minute.
      const other = await registerApp(t.app, 'quota-app');
      await t.prisma.connectedApp.update({
        where: { id: other.id },
        data: { rateLimitPerMinute: 1 },
      });
      await publishCatalog(t.server, other);
      const limited = await signed(t.server, other, 'PUT', '/api/ingest/catalog', {
        contractVersion: 1,
        catalog: testCatalog(),
      }).expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('stores what the server sets: recorded_at, the application, a verifiable hash', async () => {
      const event = testEvent(version, 1, { occurredAt: '2020-01-01T00:00:00.000Z' });
      const before = Date.now();
      await send([{ ...event, occurredAt: new Date(before - 60_000).toISOString() }]).expect(200);
      const row = await t.prisma.auditEvent.findFirstOrThrow({ include: { personal: true } });
      expect(row.appId).toBe(connected.id);
      expect(row.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.ipScope).toBe('reserved');
      // Personal data lives in the satellite row, the event keeps its digest.
      expect(row.personal).toMatchObject({
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        actorLabel: 'j***@e***.com',
      });
      expect(row.personalDigest?.length).toBe(32);
      const recomputed = contentHashOf(row as unknown as EventRow);
      expect(Buffer.from(recomputed).equals(Buffer.from(row.contentHash))).toBe(true);
    });

    it('judges every event on its own: one bad event never fails the batch', async () => {
      const res = await send([
        testEvent(version, 1),
        testEvent(version, 2, { action: 'not.in.catalog' }),
        { schemaVersion: 1, eventId: 'not-a-uuid' },
        testEvent('0123456789abcdef', 4),
        testEvent(version, 5, {
          action: 'client.session.expired',
          clientDeclared: ['occurredAt', 'client'],
        }),
        testEvent(version, 6, { clientDeclared: ['occurredAt', 'client'] }),
        testEvent(version, 7, { category: 'audit' }),
      ]).expect(200);
      const { results, accepted, rejected } = envelopeOf<Results>(res).data;
      expect({ accepted, rejected }).toEqual({ accepted: 2, rejected: 5 });
      expect(results.map((result) => result.reason ?? result.status)).toEqual([
        'accepted',
        'action_unknown',
        'schema_invalid',
        'catalog_version_unknown',
        'accepted',
        'source_not_allowed',
        'category_mismatch',
      ]);
      expect(results[3]?.retryable).toBe(true);
      // Every refused event but the retryable one consumed its number.
      const exceptions = await t.prisma.ingestException.findMany({ orderBy: { sourceSeq: 'asc' } });
      expect(
        exceptions.map((row) => (row.sourceSeq === null ? null : Number(row.sourceSeq))),
      ).toEqual([2, 6, 7, null]);
    });

    it('keeps XSS payloads as text, moves personal values aside and redacts sensitive ones', async () => {
      const payload = '<script>alert(1)</script>';
      await send([
        testEvent(version, 1, {
          category: 'audit',
          action: 'account.profile.updated',
          actor: { type: 'user', id: 'user-1', label: payload },
          change: {
            before: { name: 'Ana', password: 'hunter2' },
            after: { name: payload, password: '[REDACTED]' },
          },
          details: undefined,
        }),
      ]).expect(200);
      const row = await t.prisma.auditEvent.findFirstOrThrow({ include: { personal: true } });
      expect(row.changeBefore).toEqual({ name: { $personal: true }, password: '[REDACTED]' });
      expect(row.changeAfter).toEqual({ name: { $personal: true }, password: '[REDACTED]' });
      expect(row.flags).toEqual(['sensitive_unmasked']);
      expect(row.personal?.actorLabel).toBe(payload);
      expect(row.personal?.personalChange).toEqual({
        before: { name: 'Ana' },
        after: { name: payload },
      });
    });

    it('refuses a sequence number another event already took', async () => {
      await send([testEvent(version, 1)]).expect(200);
      const res = await send([testEvent(version, 1)]).expect(200);
      expect(envelopeOf<Results>(res).data.results[0]).toMatchObject({
        status: 'rejected',
        reason: 'sequence_conflict',
      });
    });

    it('accounts for a duplicate sent again with a new number', async () => {
      const event = testEvent(version, 1);
      await send([event]).expect(200);
      const res = await send([{ ...event, sourceSeq: 2 }]).expect(200);
      expect(envelopeOf<Results>(res).data.results[0]?.status).toBe('duplicate');
      const exception = await t.prisma.ingestException.findFirstOrThrow();
      expect(exception).toMatchObject({ kind: 'duplicate', sourceSeq: 2n });
    });
  });

  describe('catalogs', () => {
    it('publishes once and refuses a category with a shorter retention', async () => {
      const again = await signed(t.server, connected, 'PUT', '/api/ingest/catalog', {
        contractVersion: 1,
        catalog: testCatalog(),
      }).expect(200);
      expect(envelopeOf<{ status: string; version: string }>(again).data).toEqual({
        status: 'unchanged',
        version,
        actions: 3,
      });
      const downgraded = testCatalog();
      const signedIn = downgraded.actions['auth.session.signed_in'];
      if (signedIn === undefined) throw new Error('fixture');
      signedIn.category = 'system';
      const refused = await signed(t.server, connected, 'PUT', '/api/ingest/catalog', {
        contractVersion: 1,
        catalog: downgraded,
      }).expect(400);
      expect(envelopeOf(refused).message).toContain('never moves to a shorter retention');
    });

    it('tells an unsupported contract version apart', async () => {
      const res = await signed(t.server, connected, 'PUT', '/api/ingest/catalog', {
        contractVersion: 99,
        catalog: testCatalog(),
      }).expect(400);
      expect(res.headers['audit-error']).toBe('contract_version_unsupported');
    });
  });

  describe('sequences and heartbeats', () => {
    it('finds a missing number, and closes the gap when it arrives', async () => {
      const monitor = t.app.get(SequenceMonitorService);
      await send([testEvent(version, 1), testEvent(version, 2), testEvent(version, 5)]).expect(200);
      await monitor.detectGapsOf(connected.id, EPOCH);
      const state = await t.prisma.sequenceState.findUniqueOrThrow({
        where: { appId_epoch: { appId: connected.id, epoch: EPOCH } },
      });
      expect(state).toMatchObject({ contiguousThrough: 2n, maxSeen: 5n });
      expect(await t.prisma.sequenceGap.findMany({ where: { closedAt: null } })).toMatchObject([
        { fromSeq: 3n, toSeq: 4n },
      ]);
      // Past the grace period, the gauge counts the missing numbers.
      await monitor.refreshStats(new Date(Date.now() + 11 * 60_000));
      await send([testEvent(version, 3), testEvent(version, 4)]).expect(200);
      await monitor.detectGapsOf(connected.id, EPOCH);
      expect(await t.prisma.sequenceGap.count({ where: { closedAt: null } })).toBe(0);
      expect(
        await t.prisma.sequenceState.findUniqueOrThrow({
          where: { appId_epoch: { appId: connected.id, epoch: EPOCH } },
        }),
      ).toMatchObject({ contiguousThrough: 5n });
    });

    it('records heartbeats and answers what was received', async () => {
      await send([testEvent(version, 1)]).expect(200);
      await t.app.get(SequenceMonitorService).detectGapsOf(connected.id, EPOCH);
      const res = await signed(t.server, connected, 'POST', '/api/ingest/heartbeat', {
        contractVersion: 1,
        connector: { name: 'audit-nestjs', version: '0.1.0' },
        instanceId: '0199e0b1-0000-7000-8000-0000000000a1',
        appVersion: '1.0.0',
        catalogVersion: version,
        sequenceEpoch: EPOCH,
        lastAssignedSeq: 1,
        queue: { size: 3, oldestAgeSeconds: 9, retrying: 0, discardedAtSignOut: 0 },
        responseActions: [],
      }).expect(200);
      expect(envelopeOf(res).data).toMatchObject({
        contractVersions: [1],
        lastContiguousSeq: 1,
        connectorNotice: null,
      });
      expect(await t.prisma.connectorInstance.findFirstOrThrow()).toMatchObject({ queueSize: 3 });
      await t.app.get(SequenceMonitorService).sweep();
    });
  });

  it('keeps the signing secret out of storage in clear', async () => {
    const key = await t.prisma.appKey.findFirstOrThrow({ where: { id: connected.keyId } });
    const secret = Buffer.from(connected.keySecret, 'base64url');
    expect(Buffer.from(key.secret).includes(secret)).toBe(false);
    expect(createHash('sha256').update(secret).digest('hex')).not.toBe(
      Buffer.from(key.secret).toString('hex'),
    );
  });
});
