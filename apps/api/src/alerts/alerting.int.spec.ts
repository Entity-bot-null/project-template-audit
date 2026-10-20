import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { asUser, seedUser } from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import { registerApp, type TestConnectedApp } from '../../test/ingest.js';
import { SourceHealthRulesService } from '../rules/source-health-rules.service.js';
import { AlertEscalationService } from './alert-escalation.service.js';
import { AlertsService, type RaiseAlert } from './alerts.service.js';
import type { AlertDetailResponse, AlertSummaryResponse } from './dto/alert.schemas.js';

const MINUTE = 60_000;

// The alerting end to end against the real database: deduplication under
// concurrency, escalation, the sources' health rules, access by application
// and role, and the live stream over real HTTP.
describe('alerting (integration)', () => {
  let t: TestApp;
  let shop: TestConnectedApp;
  let bank: TestConnectedApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    shop = await registerApp(t.app, 'shop');
    bank = await registerApp(t.app, 'bank');
  });

  const alerts = () => t.app.get(AlertsService);
  const detection = (appId: string, overrides: Partial<RaiseAlert> = {}): RaiseAlert => ({
    appId,
    rule: 'credential_stuffing',
    severity: 'critical',
    groupKey: `credential_stuffing:${appId}:abc`,
    title: 'Sign-ins of 12 accounts failing from one address in 15 minutes',
    summary: { failures: 40, accounts: 12, source: 'abc' },
    eventPks: [],
    at: new Date(),
    ...overrides,
  });
  const raise = (input: RaiseAlert) => t.prisma.$transaction((tx) => alerts().raise(tx, input));

  describe('deduplication', () => {
    it('keeps one alert for a group raised by 8 transactions at once, every occurrence counted', async () => {
      await Promise.all(Array.from({ length: 8 }, () => raise(detection(shop.id))));
      const rows = await t.prisma.alert.findMany({
        where: { groupKey: `credential_stuffing:${shop.id}:abc` },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.occurrences).toBe(8);
      await expect(
        t.prisma.alertActivity.count({ where: { alertId: rows[0]?.id, kind: 'created' } }),
      ).resolves.toBe(1);
    });

    it("folds a rule's 21st new group within the hour into one alert", async () => {
      for (let index = 0; index < 21; index++) {
        await raise(
          detection(shop.id, { groupKey: `credential_stuffing:${shop.id}:${String(index)}` }),
        );
      }
      const rows = await t.prisma.alert.findMany({
        where: { appId: shop.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(21);
      expect(rows.at(-1)?.groupKey).toBe(`credential_stuffing:${shop.id}:flood`);
      await raise(detection(shop.id, { groupKey: `credential_stuffing:${shop.id}:21` }));
      await expect(t.prisma.alert.count({ where: { appId: shop.id } })).resolves.toBe(21);
      const flood = await t.prisma.alert.findFirstOrThrow({
        where: { groupKey: `credential_stuffing:${shop.id}:flood` },
      });
      expect(flood.occurrences).toBe(2);
    });
  });

  describe('escalation', () => {
    beforeEach(async () => {
      await t.prisma.escalationPolicy.create({
        data: {
          severity: 'critical',
          enabled: true,
          firstAfterMinutes: 15,
          repeatEveryMinutes: 30,
          maxEscalations: 2,
          channels: ['email', 'chat'],
        },
      });
    });
    const escalate = (minutesFromNow: number) =>
      t.app.get(AlertEscalationService).runOnce(new Date(Date.now() + minutesFromNow * MINUTE));

    it('escalates an unacknowledged alert after its delay, again at its interval, at most its times', async () => {
      const raised = await raise(detection(shop.id));
      await expect(escalate(10)).resolves.toBe(0);
      await expect(escalate(16)).resolves.toBe(1);
      await expect(escalate(20)).resolves.toBe(0);
      await expect(escalate(47)).resolves.toBe(1);
      await expect(escalate(200)).resolves.toBe(0); // its 2 times are done
      const history = await t.prisma.alertActivity.findMany({
        where: { alertId: raised?.id, kind: 'escalated' },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((entry) => entry.note?.split(':')[0])).toEqual([
        '1 of 2, unacknowledged',
        '2 of 2, unacknowledged',
      ]);
    });

    it('never escalates an acknowledged or silenced alert, and starts over once reopened', async () => {
      const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
      await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: shop.id } });
      const raised = await raise(detection(shop.id));
      const as = asUser(t.app, auditor.id, 'auditor');
      await request(t.server)
        .post(`/api/alerts/${raised!.id}/acknowledge`)
        .set(as)
        .send({ version: 0 })
        .expect(200);
      await expect(escalate(60)).resolves.toBe(0);

      // Silenced: nothing either.
      const other = await raise(
        detection(shop.id, { groupKey: `credential_stuffing:${shop.id}:other` }),
      );
      await t.prisma.alertMute.create({
        data: {
          appId: shop.id,
          rule: 'credential_stuffing',
          reason: 'A drill of the security team.',
          until: new Date(Date.now() + 120 * MINUTE),
          createdById: auditor.id,
        },
      });
      await expect(escalate(60)).resolves.toBe(0);

      // Reopened: counted from the reopening.
      const closed = envelopeOf<AlertDetailResponse>(
        await request(t.server)
          .patch(`/api/alerts/${raised!.id}`)
          .set(as)
          .send({ status: 'resolved', reason: 'The address was blocked at the edge.', version: 1 })
          .expect(200),
      ).data;
      const reopened = envelopeOf<AlertDetailResponse>(
        await request(t.server)
          .patch(`/api/alerts/${raised!.id}`)
          .set(as)
          .send({ status: 'open', version: closed.version })
          .expect(200),
      ).data;
      expect(reopened).toMatchObject({ status: 'open', acknowledgedAt: null, escalations: 0 });
      expect(other).not.toBeNull();
    });
  });

  describe('health rules', () => {
    const heartbeat = (
      appId: string,
      ageMs: number,
      queue: { size?: number; oldest?: number } = {},
    ) =>
      t.prisma.connectorInstance.create({
        data: {
          appId,
          instanceId: randomUUID(),
          connectorName: 'audit-nestjs',
          connectorVersion: '0.3.1',
          contractVersion: 1,
          appVersion: '1.0.0',
          catalogVersion: '1',
          queueSize: queue.size ?? 0,
          queueOldestAgeSec: queue.oldest ?? 0,
          queueRetrying: 0,
          discardedAtSignOut: 0,
          lastHeartbeatAt: new Date(Date.now() - ageMs),
        },
      });
    const run = () => t.app.get(SourceHealthRulesService).runOnce(new Date());
    const open = (rule: string) =>
      t.prisma.alert.findMany({ where: { rule, status: { in: ['open', 'in_review'] } } });

    it('alerts on a disconnected source, never on an idle one, and resolves it when it is back', async () => {
      await heartbeat(shop.id, 60 * MINUTE); // timeout 300 s: disconnected
      await heartbeat(bank.id, 30_000); // heartbeats, no events: idle
      await run();
      const [silent] = await open('source_silent');
      expect(silent).toMatchObject({
        appId: shop.id,
        severity: 'high',
        groupKey: `source_silent:${shop.id}`,
      });
      expect(await open('source_silent')).toHaveLength(1);
      await run(); // still down: the same alert, no new occurrence
      expect(
        (await t.prisma.alert.findUniqueOrThrow({ where: { id: silent!.id } })).occurrences,
      ).toBe(1);

      await t.prisma.connectorInstance.updateMany({
        where: { appId: shop.id },
        data: { lastHeartbeatAt: new Date() },
      });
      await run();
      const resolved = await t.prisma.alert.findUniqueOrThrow({ where: { id: silent!.id } });
      expect(resolved).toMatchObject({ status: 'resolved', resolvedById: null });
      const last = await t.prisma.alertActivity.findFirstOrThrow({
        where: { alertId: silent!.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(last.note).toBe('Resolved by itself: a heartbeat arrived.');
    });

    it('alerts on a backed-up queue, refused events and missing ones, each once', async () => {
      await heartbeat(shop.id, 30_000, { size: 40, oldest: 2_000 });
      await heartbeat(bank.id, 30_000);
      await t.prisma.ingestException.createMany({
        data: Array.from({ length: 20 }, () => ({
          appId: bank.id,
          kind: 'rejected' as const,
          reason: 'schema_invalid',
          errorPaths: ['actor.id'],
          payloadBytes: 300,
          connectorVersion: '0.3.1',
        })),
      });
      await t.prisma.sequenceGap.create({
        data: {
          appId: bank.id,
          epoch: randomUUID(),
          fromSeq: 10n,
          toSeq: 14n,
          detectedAt: new Date(Date.now() - 30 * MINUTE),
        },
      });
      await run();
      await run();
      expect((await open('source_backlog')).map((alert) => alert.appId)).toEqual([shop.id]);
      const [refused] = await open('ingest_rejections');
      expect(refused).toMatchObject({ appId: bank.id });
      expect(refused?.summary).toMatchObject({ rejected: 20, reasons: ['schema_invalid: 20'] });
      const [gap] = await open('coverage_gap');
      expect(gap?.summary).toMatchObject({ gaps: 1, missingEvents: 5 });
    });

    it('raises one critical alert per application a failed verification names, once', async () => {
      await t.prisma.integrityVerification.create({
        data: {
          trigger: 'job',
          scope: {},
          outcome: 'failed',
          eventsChecked: 100n,
          sealsChecked: 3,
          failures: 2,
          failureSample: [
            { kind: 'hash_mismatch', appId: shop.id, category: 'security', sealNo: 1 },
            { kind: 'hash_mismatch', appId: shop.id, category: 'security', sealNo: 1 },
          ],
          startedAt: new Date(),
        },
      });
      await run();
      await run();
      const failures = await t.prisma.alert.findMany({ where: { rule: 'integrity_failure' } });
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ appId: shop.id, severity: 'critical' });
    });
  });

  describe('access', () => {
    it("shows an auditor their applications' alerts only, and lets a viewer read, never act", async () => {
      const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
      const viewer = await seedUser(t.prisma, { email: 'viewer@example.com', role: 'viewer' });
      for (const user of [auditor, viewer]) {
        await t.prisma.userAppAssignment.create({ data: { userId: user.id, appId: shop.id } });
      }
      const mine = await raise(detection(shop.id));
      const theirs = await raise(detection(bank.id));
      const asAuditor = asUser(t.app, auditor.id, 'auditor');
      const asViewer = asUser(t.app, viewer.id, 'viewer');

      const listed = envelopeOf<{ items: { id: string }[] }>(
        await request(t.server).get('/api/alerts').set(asAuditor).expect(200),
      ).data;
      expect(listed.items.map((alert) => alert.id)).toEqual([mine!.id]);
      const summary = envelopeOf<AlertSummaryResponse>(
        await request(t.server).get('/api/alerts/summary').set(asAuditor).expect(200),
      ).data;
      expect(summary.open.critical).toBe(1);
      await request(t.server)
        .post(`/api/alerts/${theirs!.id}/acknowledge`)
        .set(asAuditor)
        .send({ version: 0 })
        .expect(404);
      await request(t.server)
        .post('/api/alert-mutes')
        .set(asAuditor)
        .send({ appId: bank.id, rule: null, minutes: 30, reason: 'Not mine to silence.' })
        .expect(404);
      const sources = envelopeOf<{ items: { appId: string }[] }>(
        await request(t.server).get('/api/sources').set(asAuditor).expect(200),
      ).data;
      expect(sources.items.map((source) => source.appId)).toEqual([shop.id]);

      // A viewer reads, never acts.
      await request(t.server).get(`/api/alerts/${mine!.id}`).set(asViewer).expect(200);
      await request(t.server)
        .post(`/api/alerts/${mine!.id}/acknowledge`)
        .set(asViewer)
        .send({ version: 0 })
        .expect(403);
      await request(t.server)
        .patch(`/api/alerts/${mine!.id}`)
        .set(asViewer)
        .send({ status: 'resolved', reason: 'Trying as a viewer.', version: 0 })
        .expect(403);
      await request(t.server)
        .post('/api/alert-mutes')
        .set(asViewer)
        .send({ appId: shop.id, rule: null, minutes: 30, reason: 'Trying as a viewer.' })
        .expect(403);
    });

    it('closes an alert only with a reason, acknowledges once, and keeps it all in the history', async () => {
      const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
      await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: shop.id } });
      const raised = await raise(detection(shop.id));
      const as = asUser(t.app, auditor.id, 'auditor');
      await request(t.server)
        .patch(`/api/alerts/${raised!.id}`)
        .set(as)
        .send({ status: 'resolved', version: 0 })
        .expect(400);
      const acknowledged = envelopeOf<AlertDetailResponse>(
        await request(t.server)
          .post(`/api/alerts/${raised!.id}/acknowledge`)
          .set(as)
          .send({ version: 0 })
          .expect(200),
      ).data;
      expect(acknowledged).toMatchObject({
        status: 'in_review',
        assigneeId: auditor.id,
        acknowledgedById: auditor.id,
        acknowledgedByLabel: auditor.name,
      });
      await request(t.server)
        .post(`/api/alerts/${raised!.id}/acknowledge`)
        .set(as)
        .send({ version: 1 })
        .expect(409);
      const closed = envelopeOf<AlertDetailResponse>(
        await request(t.server)
          .patch(`/api/alerts/${raised!.id}`)
          .set(as)
          .send({
            status: 'false_positive',
            reason: 'A penetration test agreed with the team.',
            version: 1,
          })
          .expect(200),
      ).data;
      expect(closed.activities.map((activity) => [activity.kind, activity.note])).toEqual([
        ['created', null],
        ['acknowledged', null],
        ['assigned', auditor.id],
        ['status_changed', 'A penetration test agreed with the team.'],
      ]);
    });

    it('lets administrators alone tune the rules and the escalation, after a step-up, in its log', async () => {
      const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
      const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
      await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: shop.id } });
      await t.prisma.escalationPolicy.create({
        data: {
          severity: 'high',
          enabled: true,
          firstAfterMinutes: 60,
          repeatEveryMinutes: 120,
          maxEscalations: 2,
          channels: ['email'],
        },
      });
      const body = { enabled: true, severity: null, params: { failures: 30 } };
      await request(t.server)
        .get('/api/detection-rules')
        .set(asUser(t.app, auditor.id, 'auditor'))
        .expect(200);
      await request(t.server)
        .put('/api/detection-rules/brute_force_ip')
        .set(asUser(t.app, auditor.id, 'auditor'))
        .send(body)
        .expect(403);
      await request(t.server)
        .put('/api/detection-rules/brute_force_ip')
        .set(asUser(t.app, admin.id, 'admin'))
        .send(body)
        .expect(403);
      const recent = asUser(t.app, admin.id, 'admin', 0, { recent: true });
      await request(t.server)
        .put('/api/detection-rules/brute_force_ip')
        .set(recent)
        .send({ ...body, params: { failures: 2 } })
        .expect(400);
      const changed = envelopeOf<{ settings: { params: Record<string, number> } }>(
        await request(t.server)
          .put('/api/detection-rules/brute_force_ip')
          .set(recent)
          .send(body)
          .expect(200),
      ).data;
      expect(changed.settings.params).toEqual({ failures: 30 });
      await request(t.server)
        .put('/api/escalation-policies/high')
        .set(recent)
        .send({
          enabled: false,
          firstAfterMinutes: 30,
          repeatEveryMinutes: 60,
          maxEscalations: 1,
          channels: ['chat'],
        })
        .expect(200);
      const logged = await t.prisma.auditEvent.findMany({
        where: { action: { in: ['hub.detection_rule.changed', 'hub.escalation_policy.changed'] } },
        select: { action: true },
      });
      expect(logged.map((event) => event.action).sort()).toEqual([
        'hub.detection_rule.changed',
        'hub.escalation_policy.changed',
      ]);
    });

    it("keeps each person's notification preferences their own", async () => {
      const one = await seedUser(t.prisma, { email: 'one@example.com', role: 'admin' });
      const two = await seedUser(t.prisma, { email: 'two@example.com', role: 'admin' });
      const prefs = envelopeOf<Record<string, unknown>>(
        await request(t.server)
          .get('/api/account/notification-preferences')
          .set(asUser(t.app, one.id, 'admin'))
          .expect(200),
      ).data;
      await request(t.server)
        .put('/api/account/notification-preferences')
        .set(asUser(t.app, one.id, 'admin'))
        .send({ ...prefs, sound: { enabled: false, volume: 10, severities: [] } })
        .expect(200);
      const theirs = envelopeOf<{ sound: { enabled: boolean } }>(
        await request(t.server)
          .get('/api/account/notification-preferences')
          .set(asUser(t.app, two.id, 'admin'))
          .expect(200),
      ).data;
      expect(theirs.sound.enabled).toBe(true);
    });
  });

  describe('the live stream', () => {
    let base: string;

    beforeAll(async () => {
      await new Promise<void>((resolve) => t.server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${String((t.server.address() as AddressInfo).port)}`;
    });

    /** Opens a stream and collects its events until `until` holds (or 8 seconds pass). */
    async function listen(
      headers: Record<string, string>,
      until: (events: { event: string; id?: string; data: Record<string, unknown> }[]) => boolean,
      during?: () => Promise<unknown>,
    ) {
      const abort = new AbortController();
      const response = await fetch(`${base}/api/alerts/stream`, {
        headers: { ...headers, Accept: 'text/event-stream' },
        signal: abort.signal,
      });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const events: { event: string; id?: string; data: Record<string, unknown> }[] = [];
      let buffer = '';
      let started = false;
      const deadline = Date.now() + 8_000;
      // One read pending at a time: a read given up on would swallow a chunk.
      let pending: ReturnType<typeof reader.read> | null = null;
      try {
        while (Date.now() < deadline && !until(events)) {
          pending ??= reader.read();
          const chunk = await Promise.race([
            pending,
            new Promise<null>((resolve) =>
              setTimeout(() => {
                resolve(null);
              }, 500),
            ),
          ]);
          if (chunk !== null) {
            pending = null;
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const event = /^event: (.*)$/m.exec(frame)?.[1];
              if (event === undefined) continue;
              const id = /^id: (.*)$/m.exec(frame)?.[1];
              events.push({
                event,
                ...(id === undefined ? {} : { id }),
                data: JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? '{}') as Record<
                  string,
                  unknown
                >,
              });
            }
          }
          if (!started && events.some((event) => event.event === 'ready')) {
            started = true;
            await during?.();
          }
        }
      } finally {
        abort.abort();
      }
      return events;
    }

    it("carries a new alert to whoever may see it, live, and nobody else's", async () => {
      const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
      const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
      await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: shop.id } });
      const theirs = listen(asUser(t.app, auditor.id, 'auditor'), () => false);
      const events = await listen(
        asUser(t.app, admin.id, 'admin'),
        (seen) => seen.some((event) => event.event === 'alert'),
        () => raise(detection(bank.id)),
      );
      const alert = events.find((event) => event.event === 'alert');
      expect(alert?.data).toMatchObject({
        replay: false,
        alert: { appId: bank.id, severity: 'critical' },
      });
      expect(alert?.id).toMatch(/^\d{4}-\d\d-\d\dT.*\|[0-9a-f-]{36}$/);
      // Ids and counts only: no email, no address in what the stream carries.
      expect(JSON.stringify(events)).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
      expect((await theirs).filter((event) => event.event === 'alert')).toEqual([]);
    }, 20_000);

    it('replays what changed after the last event it got, without anything else', async () => {
      const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
      const before = new Date(Date.now() - 1_000).toISOString();
      await raise(detection(shop.id));
      const events = await listen(
        { ...asUser(t.app, admin.id, 'admin'), 'Last-Event-ID': `${before}|${randomUUID()}` },
        (seen) => seen.some((event) => event.event === 'ready'),
      );
      expect(events.map((event) => [event.event, event.data.replay])).toEqual([
        ['alert', true],
        ['ready', undefined],
      ]);
    }, 20_000);
  });
});
