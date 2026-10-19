import { Logger } from '@nestjs/common';
import type { AuditEvent, CatalogDocument } from 'audit-contract';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { asUser, seedUser } from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import {
  batch,
  publishCatalog,
  registerApp,
  signed,
  type TestConnectedApp,
  testCatalog,
  testEvent,
} from '../../test/ingest.js';
import { ageEvents } from '../../test/time-travel.js';
import { startWebhookReceiver, type WebhookReceiver } from '../../test/webhook-receiver.js';
import type { AlertDetailResponse } from '../alerts/dto/alert.schemas.js';
import type { ResponseActionResponse } from '../response-actions/dto/response-action.schemas.js';
import { WebhookWorker } from '../webhooks/webhook-worker.service.js';
import { PeriodicRulesService } from './periodic-rules.service.js';
import { RealtimeRulesService } from './realtime-rules.service.js';

/** The test catalog, with the tags the rules read and a response action. */
function rulesCatalog(): CatalogDocument {
  const base = testCatalog();
  return {
    ...base,
    responseActions: ['revoke_sessions'],
    actions: {
      ...base.actions,
      'auth.session.reused': {
        category: 'security',
        severity: 'high',
        description: 'A replaced session token was presented again.',
        source: 'server',
        tags: ['auth.session_reuse'],
      },
      'auth.session.sign_in_failed': {
        category: 'security',
        severity: 'low',
        description: 'A sign-in failed.',
        source: 'server',
        tags: ['auth.sign_in_failed'],
      },
      'account.user.deleted': {
        category: 'audit',
        severity: 'medium',
        description: 'An account was deleted.',
        source: 'server',
        tags: ['privacy.erasure_requested'],
        resourceType: 'user',
      },
      'audit.response_action.executed': {
        category: 'security',
        severity: 'medium',
        description: 'A response action asked by Audit Hub was carried out.',
        source: 'server',
        tags: ['response.executed'],
        details: {
          fields: {
            actionId: { type: 'uuid', required: true },
            action: {
              type: 'enum',
              values: ['revoke_sessions', 'require_password_change', 'disable_account'],
            },
            result: {
              type: 'enum',
              values: ['succeeded', 'failed', 'refused', 'unsupported'],
              required: true,
            },
          },
        },
      },
    },
  };
}

// The rules, alerts, webhooks and response actions against the real
// database and a real HTTP endpoint for the application (docs/adr/0013).
describe('rules, alerts, webhooks and response actions (integration)', () => {
  let t: TestApp;
  let receiver: WebhookReceiver;
  let connected: TestConnectedApp;
  let version: string;
  let seq: number;

  beforeAll(async () => {
    t = await createTestApp();
    receiver = await startWebhookReceiver();
  });

  afterAll(async () => {
    await t.app.close();
    await receiver.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    connected = await registerApp(t.app, 'my-project', { webhookUrl: receiver.url });
    version = await publishCatalog(t.server, connected, rulesCatalog());
    receiver.received.length = 0;
    receiver.answer(200);
    seq = 0;
  });

  /** Ingests events as the application's connector would; answers Audit Hub's ids. */
  async function send(...overrides: Partial<AuditEvent>[]): Promise<string[]> {
    const events = overrides.map((override) => testEvent(version, (seq += 1), override));
    await signed(t.server, connected, 'POST', '/api/ingest/events', batch(events)).expect(200);
    const rows = await t.prisma.auditEvent.findMany({
      where: { eventId: { in: events.map((event) => event.eventId) } },
      orderBy: { sourceSeq: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** The real-time rules read events 20 s old: the events are moved back a minute first. */
  async function evaluate(ids: string[]): Promise<void> {
    await ageEvents(t.prisma, ids, 60_000);
    await t.app.get(RealtimeRulesService).runOnce();
  }

  const deliver = () => t.app.get(WebhookWorker).runOnce();
  const signIn = (deviceId: string, actorId = 'user-1'): Partial<AuditEvent> => ({
    client: { type: 'android', deviceId, deviceModel: 'Pixel 9' },
    actor: { type: 'user', id: actorId, role: 'member', label: 'Ada Lovelace' },
  });

  describe('suspicious sign-ins', () => {
    it('asks the application "was it you?" for a sign-in from a new device, signed', async () => {
      await evaluate(await send(signIn('device-aaaa-1111')));
      expect(await t.prisma.alert.count()).toBe(0);

      await evaluate(await send(signIn('device-bbbb-2222')));
      const alert = await t.prisma.alert.findFirstOrThrow();
      expect(alert).toMatchObject({
        rule: 'suspicious_sign_in',
        severity: 'medium',
        status: 'open',
        subject: 'user-1',
        occurrences: 1,
        summary: expect.objectContaining({ signals: ['new_device'] }) as unknown,
      });
      expect(JSON.stringify(alert)).not.toContain('203.0.113.7');

      await deliver();
      const types = receiver.received.map((delivery) => delivery.body.type).sort();
      expect(types).toEqual(['alert.created', 'security.sign_in_suspicious']);
      for (const delivery of receiver.received) {
        expect(receiver.verify(delivery, connected.webhookSecret, connected.slug)).toBe(true);
        expect(delivery.headers['audit-webhook-id']).toBe(delivery.body.id);
      }
      const prompt = receiver.received.find(
        (delivery) => delivery.body.type === 'security.sign_in_suspicious',
      );
      expect(prompt?.body.data).toMatchObject({
        subject: 'user-1',
        signals: ['new_device'],
        context: { clientType: 'android', deviceModel: 'Pixel 9' },
      });
      expect(
        await t.prisma.webhookDelivery.findMany({ select: { status: true, attempts: true } }),
      ).toEqual([
        { status: 'delivered', attempts: 1 },
        { status: 'delivered', attempts: 1 },
      ]);

      // The same device again: nothing new. Another new one: one more occurrence.
      await evaluate(await send(signIn('device-bbbb-2222')));
      expect(await t.prisma.alert.findFirstOrThrow()).toMatchObject({ occurrences: 1 });
      await evaluate(await send(signIn('device-cccc-3333')));
      expect(await t.prisma.alert.findFirstOrThrow()).toMatchObject({ occurrences: 2 });
      expect(await t.prisma.alert.count()).toBe(1);
    });

    it('alerts at once on a reused session token', async () => {
      await evaluate(
        await send({
          action: 'auth.session.reused',
          outcome: 'denied',
          actor: { type: 'user', id: 'user-2', role: 'member' },
        }),
      );
      expect(await t.prisma.alert.findFirstOrThrow()).toMatchObject({
        rule: 'session_reuse',
        severity: 'high',
        subject: 'user-2',
      });
    });
  });

  describe('periodic rules', () => {
    it('alerts on brute force against one account once, until new failures arrive', async () => {
      const failure = {
        action: 'auth.session.sign_in_failed',
        outcome: 'failure' as const,
        actor: { type: 'user' as const, id: 'user-9' },
      };
      const ids = await send(...Array.from({ length: 10 }, () => failure));
      await ageEvents(t.prisma, ids, 60_000);
      const periodic = t.app.get(PeriodicRulesService);
      await expect(periodic.run()).resolves.toEqual({ brute_force_account: 1 });
      expect(await t.prisma.alert.findFirstOrThrow()).toMatchObject({
        rule: 'brute_force_account',
        severity: 'high',
        subject: 'user-9',
      });
      const alertEvents = await t.prisma.alertEvent.count();
      expect(alertEvents).toBe(10);
      // Nothing new since: no second occurrence for the same evidence.
      await expect(periodic.run()).resolves.toEqual({});
      expect(await t.prisma.alert.findFirstOrThrow()).toMatchObject({ occurrences: 1 });

      await periodic.scheduled();
      const run = await t.prisma.jobRun.findFirstOrThrow({ where: { job: 'rules_periodic' } });
      expect(run.outcome).toBe('succeeded');
    });
  });

  describe('erasure', () => {
    it("erases a deleted account's personal data when its deletion arrives as an event", async () => {
      const signIns = await send(signIn('device-aaaa-1111', 'user-5'));
      expect(await t.prisma.eventPersonal.count()).toBe(1);
      const deletion = await send({
        action: 'account.user.deleted',
        category: 'audit',
        actor: { type: 'user', id: 'user-5', role: 'member' },
        resource: { type: 'user', id: 'user-5' },
      });
      await evaluate([...signIns, ...deletion]);
      expect(await t.prisma.eventPersonal.count()).toBe(0);
      expect(await t.prisma.auditEvent.count()).toBe(2);
      expect(await t.prisma.erasureRun.findFirstOrThrow()).toMatchObject({
        subject: 'user-5',
        requestedVia: 'event',
      });
    });
  });

  describe('response actions', () => {
    let first: { id: string };
    let second: { id: string };

    beforeEach(async () => {
      first = await seedUser(t.prisma, { email: 'first@example.com', role: 'admin' });
      second = await seedUser(t.prisma, { email: 'second@example.com', role: 'admin' });
      await t.prisma.connectedApp.update({
        where: { id: connected.id },
        data: { acceptedResponseActions: ['revoke_sessions'] },
      });
    });

    const ask = (as: { id: string }, body: Record<string, unknown>) =>
      request(t.server)
        .post('/api/response-actions')
        .set(asUser(t.app, as.id, 'admin', 0, { recent: true }))
        .send({
          appId: connected.id,
          subject: 'user-1',
          reason: 'Account taken over by someone',
          ...body,
        });

    it('goes to the application once a second administrator approves, and settles with its event', async () => {
      await ask(first, { action: 'disable_account' }).expect(409);
      const created = envelopeOf<ResponseActionResponse>(
        await ask(first, { action: 'revoke_sessions' }).expect(201),
      ).data;
      expect(created.status).toBe('pending_approval');
      const approve = (as: { id: string }) =>
        request(t.server)
          .post(`/api/response-actions/${created.id}/approve`)
          .set(asUser(t.app, as.id, 'admin', 0, { recent: true }));
      await approve(first).expect(403);
      const approved = envelopeOf<ResponseActionResponse>(await approve(second).expect(200)).data;
      expect(approved).toMatchObject({ status: 'dispatched', approvedById: second.id });
      await approve(second).expect(409);

      await deliver();
      const requested = receiver.received.find(
        (delivery) => delivery.body.type === 'response_action.requested',
      );
      expect(requested?.body.data).toMatchObject({
        actionId: created.id,
        action: 'revoke_sessions',
        subject: 'user-1',
      });
      expect(
        receiver.verify(
          requested ?? receiver.received[0]!,
          connected.webhookSecret,
          connected.slug,
        ),
      ).toBe(true);

      const outcome = await send({
        action: 'audit.response_action.executed',
        actor: { type: 'system' },
        details: { actionId: created.id, action: 'revoke_sessions', result: 'succeeded' },
      });
      await evaluate(outcome);
      const settled = await t.prisma.responseAction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(settled).toMatchObject({ status: 'succeeded', resultEventPk: outcome[0] });
    });

    it('settles at once when the application refuses, and cancels a pending one', async () => {
      await t.prisma.connectedApp.update({
        where: { id: connected.id },
        data: { requireActionApproval: false },
      });
      receiver.answer(200, { data: { status: 'refused' } });
      const created = envelopeOf<ResponseActionResponse>(
        await ask(first, { action: 'revoke_sessions' }).expect(201),
      ).data;
      expect(created.status).toBe('dispatched');
      await deliver();
      expect(
        await t.prisma.responseAction.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({ status: 'refused' });

      await t.prisma.connectedApp.update({
        where: { id: connected.id },
        data: { requireActionApproval: true },
      });
      const pending = envelopeOf<ResponseActionResponse>(
        await ask(first, { action: 'revoke_sessions' }).expect(201),
      ).data;
      await request(t.server)
        .post(`/api/response-actions/${pending.id}/cancel`)
        .set(asUser(t.app, second.id, 'admin'))
        .expect(200);
      await request(t.server)
        .post(`/api/response-actions/${pending.id}/cancel`)
        .set(asUser(t.app, second.id, 'admin'))
        .expect(409);
      const listed = await request(t.server)
        .get('/api/response-actions?status=cancelled')
        .set(asUser(t.app, first.id, 'admin'))
        .expect(200);
      expect(envelopeOf<{ total: number }>(listed).data.total).toBe(1);
    });
  });

  describe('webhook deliveries', () => {
    it('gives up at once on a 401 (a secret mismatch is not transient)', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      receiver.answer(401, { message: 'Bad signature' });
      const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
      await request(t.server)
        .post(`/api/connected-apps/${connected.id}/webhook-test`)
        .set(asUser(t.app, admin.id, 'admin'))
        .expect(202);
      await deliver();
      const listed = await request(t.server)
        .get(`/api/connected-apps/${connected.id}/webhook-deliveries`)
        .set(asUser(t.app, admin.id, 'admin'))
        .expect(200);
      expect(envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([
        expect.objectContaining({
          type: 'ping',
          status: 'failed',
          attempts: 1,
          lastStatus: 401,
          lastError: 'unauthorized',
        }),
      ]);
    });

    it('retries a 5xx later', async () => {
      receiver.answer(503, {});
      const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
      await request(t.server)
        .post(`/api/connected-apps/${connected.id}/webhook-test`)
        .set(asUser(t.app, admin.id, 'admin'))
        .expect(202);
      await deliver();
      const delivery = await t.prisma.webhookDelivery.findFirstOrThrow();
      expect(delivery).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 503 });
      expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    });
  });

  describe('alerts API', () => {
    it('shows alerts only to who may see the application, and lets auditors work on them', async () => {
      await evaluate(await send(signIn('device-aaaa-1111')));
      await evaluate(await send(signIn('device-bbbb-2222')));
      const alert = await t.prisma.alert.findFirstOrThrow();
      const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
      const other = await seedUser(t.prisma, { email: 'other@example.com', role: 'auditor' });
      const viewer = await seedUser(t.prisma, { email: 'viewer@example.com', role: 'viewer' });
      const member = await seedUser(t.prisma, { email: 'member@example.com' });
      for (const user of [auditor, viewer]) {
        await t.prisma.userAppAssignment.create({ data: { userId: user.id, appId: connected.id } });
      }
      const as = (user: { id: string }, role: 'auditor' | 'viewer' | 'member') =>
        asUser(t.app, user.id, role);

      await request(t.server).get('/api/alerts').set(as(member, 'member')).expect(403);
      const hidden = await request(t.server)
        .get('/api/alerts')
        .set(as(other, 'auditor'))
        .expect(200);
      expect(envelopeOf<{ total: number }>(hidden).data.total).toBe(0);
      await request(t.server).get(`/api/alerts/${alert.id}`).set(as(other, 'auditor')).expect(404);
      const seen = await request(t.server)
        .get('/api/alerts?status=open,in_review')
        .set(as(viewer, 'viewer'))
        .expect(200);
      expect(envelopeOf<{ total: number }>(seen).data.total).toBe(1);
      // Who it is about, why it fired and what its events show, in words.
      expect(envelopeOf<{ items: { subjectLabel: string | null }[] }>(seen).data.items).toEqual([
        expect.objectContaining({ subjectLabel: 'Ada Lovelace' }),
      ]);
      const detail = envelopeOf<AlertDetailResponse>(
        await request(t.server)
          .get(`/api/alerts/${alert.id}`)
          .set(as(viewer, 'viewer'))
          .expect(200),
      ).data;
      expect(detail).toMatchObject({
        subjectLabel: 'Ada Lovelace',
        explanation: {
          saw: [
            'Ada Lovelace (user-1) signed in successfully.',
            'New device: one this account had not used before (Pixel 9).',
          ],
        },
        evidence: {
          events: 1,
          outcomes: [{ value: 'success', count: 1 }],
          accounts: 1,
          devices: [{ value: 'Pixel 9', count: 1 }],
        },
        assigneeLabel: null,
      });
      expect(detail.events.map((event) => event.actor.label)).toEqual(['Ada Lovelace']);
      // Reads of people by name: in Audit Hub's own log, as the explorer's.
      const reads = await t.prisma.auditEvent.groupBy({
        by: ['action'],
        where: { action: { in: ['hub.alerts.searched', 'hub.alert.viewed'] } },
        _count: { _all: true },
        orderBy: { action: 'asc' },
      });
      expect(reads.map((read) => [read.action, read._count._all])).toEqual([
        ['hub.alert.viewed', 1],
        ['hub.alerts.searched', 2],
      ]);
      await request(t.server)
        .patch(`/api/alerts/${alert.id}`)
        .set(as(viewer, 'viewer'))
        .send({ status: 'in_review', version: 0 })
        .expect(403);

      const patch = (body: Record<string, unknown>) =>
        request(t.server).patch(`/api/alerts/${alert.id}`).set(as(auditor, 'auditor')).send(body);
      const reviewed = envelopeOf<AlertDetailResponse>(
        await patch({ status: 'in_review', assigneeId: auditor.id, version: 0 }).expect(200),
      ).data;
      expect(reviewed).toMatchObject({ status: 'in_review', assigneeId: auditor.id, version: 1 });
      await patch({ status: 'resolved', version: 0 }).expect(409);
      await patch({ assigneeId: other.id, version: 1 }).expect(409);
      await request(t.server)
        .post(`/api/alerts/${alert.id}/notes`)
        .set(as(auditor, 'auditor'))
        .send({ note: 'The user confirmed the new phone.' })
        .expect(201);
      const resolved = envelopeOf<AlertDetailResponse>(
        await patch({ status: 'false_positive', version: 1 }).expect(200),
      ).data;
      expect(resolved.status).toBe('false_positive');
      expect(resolved.resolvedById).toBe(auditor.id);
      expect(resolved.resolvedByLabel).toBe(auditor.name);
      expect(resolved.activities.find((activity) => activity.kind === 'assigned')).toMatchObject({
        userLabel: auditor.name,
        assigneeLabel: auditor.name,
      });
      expect(resolved.activities.map((activity) => activity.kind)).toEqual([
        'created',
        'notified',
        'status_changed',
        'assigned',
        'note',
        'status_changed',
      ]);
      expect(resolved.events).toHaveLength(1);

      // Closed: the next detection opens a new alert.
      await evaluate(await send(signIn('device-dddd-4444')));
      expect(await t.prisma.alert.count()).toBe(2);
    });
  });
});
