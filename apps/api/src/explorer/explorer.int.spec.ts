import { createHash } from 'node:crypto';
import type { AuditEvent, CatalogDocument } from 'audit-contract';
import { emailHmac, secretKey } from 'audit-contract/node';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import type { EventDetail, EventPage, Overview, SecurityOverview } from './dto/explorer.schemas.js';

function explorerCatalog(): CatalogDocument {
  const base = testCatalog();
  return {
    ...base,
    actions: {
      ...base.actions,
      'auth.session.sign_in_failed': {
        category: 'security',
        severity: 'low',
        description: 'A sign-in failed.',
        source: 'server',
        tags: ['auth.sign_in_failed'],
      },
      // High severity: a risk score of 60 at least (ingest/risk.ts).
      'auth.session.hijack_suspected': {
        category: 'security',
        severity: 'high',
        description: 'A session looks hijacked.',
        source: 'server',
        tags: [],
      },
    },
  };
}

// The audit log as the admin pages and the applications read it, against the
// real database: access by application inside every query (another
// application's event answers 404), cursor pagination, the subject's and the
// resource's views, exports, erasure, and every read in Audit Hub's own log.
describe('explorer, exports and the connector API (integration)', () => {
  let t: TestApp;
  let mine: TestConnectedApp;
  let theirs: TestConnectedApp;
  let admin: { id: string };
  let auditor: { id: string };
  let viewer: { id: string };
  let stranger: { id: string };
  let seq: Map<string, number>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    mine = await registerApp(t.app, 'my-project');
    theirs = await registerApp(t.app, 'their-project');
    admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
    auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
    viewer = await seedUser(t.prisma, { email: 'viewer@example.com', role: 'viewer' });
    stranger = await seedUser(t.prisma, { email: 'stranger@example.com', role: 'auditor' });
    for (const user of [auditor, viewer]) {
      await t.prisma.userAppAssignment.create({ data: { userId: user.id, appId: mine.id } });
    }
    seq = new Map();
  });

  const as = {
    admin: (recent = false) => asUser(t.app, admin.id, 'admin', 0, { recent }),
    auditor: (recent = false) => asUser(t.app, auditor.id, 'auditor', 0, { recent }),
    viewer: () => asUser(t.app, viewer.id, 'viewer'),
    stranger: () => asUser(t.app, stranger.id, 'auditor'),
  };

  async function send(app: TestConnectedApp, ...overrides: Partial<AuditEvent>[]) {
    const version = await publishCatalog(t.server, app, explorerCatalog());
    const events = overrides.map((override) => {
      const next = (seq.get(app.id) ?? 0) + 1;
      seq.set(app.id, next);
      return testEvent(version, next, override);
    });
    await signed(t.server, app, 'POST', '/api/ingest/events', batch(events)).expect(200);
    const rows = await t.prisma.auditEvent.findMany({
      where: { eventId: { in: events.map((event) => event.eventId) } },
      orderBy: { sourceSeq: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  const hubActions = async (action: string) =>
    t.prisma.auditEvent.count({ where: { appId: SYSTEM_APP_ID, action } });

  describe('the explorer', () => {
    it("shows each person their applications' events only, newest first, a page at a time", async () => {
      await send(mine, {}, {}, { outcome: 'failure' });
      await send(theirs, {});
      const page = async (headers: Record<string, string>, query = '') =>
        envelopeOf<EventPage>(
          await request(t.server).get(`/api/events${query}`).set(headers).expect(200),
        ).data;
      expect((await page(as.admin())).items).toHaveLength(4);
      const seen = await page(as.auditor());
      expect(seen.items.map((item) => item.appSlug)).toEqual([
        'my-project',
        'my-project',
        'my-project',
      ]);
      // In words: the catalog's description, and the label the application sent.
      expect(seen.items[0]).toMatchObject({
        action: 'auth.session.signed_in',
        description: 'A user signed in.',
        actor: { id: 'user-1', label: 'j***@e***.com' },
      });
      expect((await page(as.stranger())).items).toEqual([]);
      expect((await page(as.stranger(), `?appId=${mine.id}`)).items).toEqual([]);
      await request(t.server)
        .get('/api/events')
        .set(asUser(t.app, admin.id, 'member'))
        .expect(403);

      const first = await page(as.auditor(), '?limit=2');
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await page(as.auditor(), `?limit=2&cursor=${first.nextCursor ?? ''}`);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(3);
      await request(t.server).get('/api/events?cursor=bogus').set(as.auditor()).expect(400);
      // Every search is in Audit Hub's own log, by filter names only.
      expect(await hubActions('hub.events.searched')).toBe(6);
      // Its events name Audit Hub's own accounts, and say what they did.
      const own = await page(as.admin(), `?appId=${SYSTEM_APP_ID}&action=hub.events.searched`);
      expect(own.items[0]).toMatchObject({
        description: 'Searched the audit log.',
        actor: { id: auditor.id, label: 'auditor' },
      });
    });

    it("gives Audit Hub's own events the browser, system and device of their request, read in full in the detail", async () => {
      const chrome =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36';
      await request(t.server).get('/api/events').set(as.auditor()).set('User-Agent', chrome);
      const searched = await t.prisma.auditEvent.findFirstOrThrow({
        where: { appId: SYSTEM_APP_ID, action: 'hub.events.searched' },
        select: { id: true, uaBrowser: true, uaOs: true, uaDeviceClass: true },
      });
      expect(searched).toMatchObject({
        uaBrowser: 'Chrome',
        uaOs: 'Windows',
        uaDeviceClass: 'desktop',
      });
      const detail = envelopeOf<EventDetail>(
        await request(t.server).get(`/api/events/${searched.id}`).set(as.admin()).expect(200),
      ).data;
      expect(detail.network).toMatchObject({ browser: 'Chrome', os: 'Windows' });
      expect(detail.personal?.agent).toEqual({
        browser: 'Chrome 141.0.7390.65',
        os: 'Windows 10 or 11',
        device: null,
      });
    });

    it('finds the events of a risk score or more', async () => {
      await send(mine, {}, { action: 'auth.session.hijack_suspected' });
      const found = envelopeOf<EventPage>(
        await request(t.server).get('/api/events?minRisk=60').set(as.auditor()).expect(200),
      ).data;
      expect(found.items.map((item) => [item.action, item.riskScore])).toEqual([
        ['auth.session.hijack_suspected', 60],
      ]);
      await request(t.server).get('/api/events?minRisk=101').set(as.auditor()).expect(400);
    });

    it('combines filters: outcome, actor, IP, country-less, email by its pseudonym', async () => {
      const email = 'ada@example.com';
      const pseudonym = emailHmac(secretKey(mine.pseudonymKey), email);
      await send(
        mine,
        { actor: { type: 'user', id: 'user-1', role: 'member', emailHmac: pseudonym } },
        { actor: { type: 'user', id: 'user-2', role: 'member' }, outcome: 'failure' },
        { network: { ip: '198.51.100.20' } },
      );
      const count = async (query: string) =>
        envelopeOf<EventPage>(
          await request(t.server).get(`/api/events?${query}`).set(as.auditor()).expect(200),
        ).data.items.length;
      expect(await count('outcome=failure')).toBe(1);
      expect(await count('actorId=user-2')).toBe(1);
      expect(await count('ip=198.51.100.20')).toBe(1);
      expect(await count(`appId=${mine.id}&email=${encodeURIComponent(email)}`)).toBe(1);
      await request(t.server)
        .get(`/api/events?email=${encodeURIComponent(email)}`)
        .set(as.auditor())
        .expect(400);
      const searched = await t.prisma.auditEvent.findFirstOrThrow({
        where: { appId: SYSTEM_APP_ID, action: 'hub.events.searched' },
        orderBy: { recordedAt: 'desc' },
      });
      expect(JSON.stringify(searched)).not.toContain(email);
    });

    it('opens an event with every section, its request and its integrity; another application answers 404', async () => {
      const [serverEvent = '', clientEvent = ''] = await send(
        mine,
        { request: { requestId: 'req-42', method: 'POST', route: '/api/things', status: 201 } },
        { request: { requestId: 'req-42' }, client: { type: 'android' } },
      );
      const [foreign = ''] = await send(theirs, {});
      const detail = envelopeOf<EventDetail>(
        await request(t.server).get(`/api/events/${serverEvent}`).set(as.viewer()).expect(200),
      ).data;
      expect(detail).toMatchObject({
        id: serverEvent,
        appSlug: 'my-project',
        catalog: { description: 'A user signed in.', tags: ['auth.sign_in'] },
        personal: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0', approximateLocation: null },
        integrity: { sealed: false, sealNo: null, seal: null },
      });
      // What the seal will cover: the event's content hash, as stored.
      const stored = await t.prisma.auditEvent.findUniqueOrThrow({
        where: { id: serverEvent },
        select: { contentHash: true },
      });
      expect(detail.integrity.contentHash).toBe(Buffer.from(stored.contentHash).toString('hex'));
      expect(detail.integrity.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(detail.related.map((event) => event.id)).toEqual([clientEvent]);
      const missing = await request(t.server)
        .get(`/api/events/${foreign}`)
        .set(as.auditor())
        .expect(404);
      const unknown = await request(t.server)
        .get('/api/events/0199e0b1-0000-7000-8000-00000000dead')
        .set(as.auditor())
        .expect(404);
      expect(missing.body).toEqual(unknown.body);
      expect(await hubActions('hub.event.viewed')).toBe(1);
    });
  });

  describe("a subject's activity, a resource's history, security and the overview", () => {
    it('gathers what one user did and what was done to them (360°)', async () => {
      await send(
        mine,
        { actor: { type: 'user', id: 'user-7', role: 'member' } },
        {
          action: 'account.profile.updated',
          category: 'audit',
          actor: { type: 'user', id: 'admin-1', role: 'admin' },
          resource: { type: 'user', id: 'user-7' },
        },
        { actor: { type: 'user', id: 'user-8', role: 'member' } },
      );
      const res = await request(t.server)
        .get(`/api/connected-apps/${mine.id}/subjects/user-7`)
        .set(as.auditor())
        .expect(200);
      const activity = envelopeOf<{
        summary: { firstSeenAt: string | null; openAlerts: number; otherApps: unknown[] };
        events: EventPage;
      }>(res).data;
      expect(activity.events.items).toHaveLength(2);
      expect(activity.summary.firstSeenAt).not.toBeNull();
      expect(activity.summary.otherApps).toEqual([]);
      await request(t.server)
        .get(`/api/connected-apps/${theirs.id}/subjects/user-7`)
        .set(as.auditor())
        .expect(404);
      await request(t.server)
        .get(`/api/connected-apps/${mine.id}/subjects/${encodeURIComponent('bad id!')}`)
        .set(as.auditor())
        .expect(400);
      const history = envelopeOf<EventPage>(
        await request(t.server)
          .get(`/api/connected-apps/${mine.id}/resources/user/user-7`)
          .set(as.auditor())
          .expect(200),
      ).data;
      expect(history.items).toHaveLength(1);
      expect(await hubActions('hub.subject.viewed')).toBe(1);
      expect(await hubActions('hub.resource.viewed')).toBe(1);
    });

    it('sums failed sign-ins by day, address and hour, and lists the open anomalies', async () => {
      const failure = {
        action: 'auth.session.sign_in_failed',
        outcome: 'failure' as const,
        actor: { type: 'user' as const, id: 'user-9' },
      };
      await send(mine, failure, failure, failure, {});
      const security = envelopeOf<SecurityOverview>(
        await request(t.server)
          .get(`/api/connected-apps/${mine.id}/security?days=7`)
          .set(as.auditor())
          .expect(200),
      ).data;
      expect(security.geolocation).toBe(false);
      expect(security.failedSignIns.reduce((sum, day) => sum + day.count, 0)).toBe(3);
      expect(security.topIps).toEqual([{ ip: '203.0.113.7', count: 3, accounts: 1 }]);
      expect(security.heatmap.reduce((sum, cell) => sum + cell.count, 0)).toBe(3);
      expect(security.anomalies).toEqual([]);
    });

    it('sums up every visible application', async () => {
      await send(mine, {}, { action: 'auth.session.hijack_suspected' });
      await send(theirs, {});
      const overview = envelopeOf<Overview>(
        await request(t.server).get('/api/overview').set(as.auditor()).expect(200),
      ).data;
      expect(overview.apps).toEqual([
        expect.objectContaining({
          slug: 'my-project',
          events24h: 2,
          highRisk24h: 1,
          rejected24h: 0,
          openGaps: 0,
        }),
      ]);
      // No verification yet; the window the figures count.
      expect(overview.integrity).toBeNull();
      expect(Date.now() - Date.parse(overview.since)).toBeGreaterThanOrEqual(86_400_000);
      expect(overview.apps[0]?.trend).toHaveLength(24);
      expect(overview.apps[0]?.trend.at(-1)).toBe(2);
      const all = envelopeOf<Overview>(
        await request(t.server).get('/api/overview').set(as.admin()).expect(200),
      ).data;
      expect(all.apps.map((app) => app.slug).sort()).toEqual(['my-project', 'their-project']);
    });
  });

  describe('exports', () => {
    it('streams CSV with the digest kept, after a step-up, for auditors and administrators only', async () => {
      await send(mine, {}, { outcome: 'failure' });
      await request(t.server).get('/api/exports/events?format=csv').set(as.auditor()).expect(403);
      await request(t.server).get('/api/exports/events?format=csv').set(as.viewer()).expect(403);
      const res = await request(t.server)
        .get('/api/exports/events?format=csv')
        .set(as.auditor(true))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        })
        .expect(200);
      const body = res.body as Buffer;
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = body.toString('utf8').trim().split('\r\n');
      expect(lines[0]).toMatch(/^recordedAt,occurredAt,app,category,action/);
      expect(lines).toHaveLength(3);
      expect(body.toString('utf8')).not.toContain('203.0.113.7');
      const id = String(res.headers['audit-export-id']);
      const job = envelopeOf<{ status: string; rowCount: number; digest: string }>(
        await request(t.server).get(`/api/exports/${id}`).set(as.auditor()).expect(200),
      ).data;
      expect(job).toMatchObject({ status: 'completed', rowCount: 2 });
      expect(job.digest).toBe(createHash('sha256').update(body).digest('base64'));
      await request(t.server).get(`/api/exports/${id}`).set(as.stranger()).expect(404);
      expect(await hubActions('hub.export.created')).toBe(1);
    });
  });

  describe('erasure from the admin pages', () => {
    it("erases a user's personal data after an administrator's step-up", async () => {
      await send(mine, { actor: { type: 'user', id: 'user-5', role: 'member' } });
      const erase = (headers: Record<string, string>) =>
        request(t.server)
          .post(`/api/connected-apps/${mine.id}/subjects/user-5/erasure`)
          .set(headers);
      await erase(as.auditor(true)).expect(403);
      await erase(as.admin()).expect(403);
      const result = await erase(as.admin(true)).expect(200);
      expect(envelopeOf(result).data).toEqual({ personalDeleted: 1, locationDeleted: 0, held: 0 });
      // Only the application's rows: Audit Hub's own event keeps the administrator's address.
      expect(await t.prisma.eventPersonal.count({ where: { appId: mine.id } })).toBe(0);
      expect(await t.prisma.erasureRun.findFirstOrThrow()).toMatchObject({ requestedVia: 'panel' });
      expect(await hubActions('hub.subject.erased')).toBe(1);
    });
  });

  describe('a subject blocked after an erasure (LFPDPPP art. 24)', () => {
    const email = 'ada@example.com';
    const erase = (app: TestConnectedApp, subject: string) =>
      request(t.server)
        .post(`/api/connected-apps/${app.id}/subjects/${subject}/erasure`)
        .set(as.admin(true))
        .expect(200);
    const search = async (headers: Record<string, string>, query: string) =>
      envelopeOf<EventPage>(
        await request(t.server).get(`/api/events?${query}`).set(headers).expect(200),
      ).data;
    const subjectView = async (app: TestConnectedApp, subject: string, query = '') =>
      envelopeOf<{
        blockedSince: string | null;
        summary: { otherApps: { slug: string }[] };
        events: EventPage;
      }>(
        await request(t.server)
          .get(`/api/connected-apps/${app.id}/subjects/${subject}${query}`)
          .set(as.admin())
          .expect(200),
      ).data;

    it('answers nothing of them in the per-person reads, keeps their pseudonymous events in the log, until a hold names them', async () => {
      const pseudonym = emailHmac(secretKey(mine.pseudonymKey), email);
      const [first = ''] = await send(
        mine,
        { actor: { type: 'user', id: 'user-5', role: 'member', emailHmac: pseudonym } },
        { actor: { type: 'user', id: 'user-5', role: 'member', emailHmac: pseudonym } },
        { actor: { type: 'user', id: 'user-6', role: 'member' } },
      );
      await erase(mine, 'user-5');

      const view = await subjectView(mine, 'user-5');
      expect(view.blockedSince).not.toBeNull();
      expect(view.events.items).toEqual([]);
      const byId = await search(as.auditor(), 'actorId=user-5');
      expect(byId).toEqual({ items: [], nextCursor: null, blocked: true });
      const byEmail = await search(
        as.auditor(),
        `appId=${mine.id}&email=${encodeURIComponent(email)}`,
      );
      expect(byEmail).toMatchObject({ items: [], blocked: true });
      // Anything else still finds them, pseudonymous: the log stays whole.
      expect((await search(as.auditor(), `appId=${mine.id}`)).items).toHaveLength(3);
      const detail = envelopeOf<EventDetail>(
        await request(t.server).get(`/api/events/${first}`).set(as.auditor()).expect(200),
      ).data;
      expect(detail.blockedSince).toBe(view.blockedSince);
      // Nor in an export by their id, nor through the query API.
      const exported = await request(t.server)
        .get('/api/exports/events?format=jsonl&actorId=user-5')
        .set(as.auditor(true))
        .expect(200);
      expect(exported.text.trim()).toBe('');
      const activity = await signed(
        t.server,
        mine,
        'GET',
        '/api/connector/subjects/user-5/activity?limit=10',
      ).expect(200);
      expect(envelopeOf<{ items: unknown[] }>(activity).data.items).toEqual([]);
      // Someone who does not see the application is told nothing of it.
      expect(await search(as.stranger(), 'actorId=user-5')).toEqual({
        items: [],
        nextCursor: null,
      });

      await t.prisma.legalHold.create({
        data: {
          appId: mine.id,
          caseRef: 'CASE-11',
          reason: 'Litigation about account user-5',
          actorId: 'user-5',
          createdById: admin.id,
        },
      });
      const held = await subjectView(mine, 'user-5');
      expect(held.blockedSince).toBeNull();
      expect(held.events.items).toHaveLength(2);
      expect((await search(as.auditor(), 'actorId=user-5')).items).toHaveLength(2);
    });

    it('shows what a user does after their erasure, as new data: an account that stays', async () => {
      await send(mine, { actor: { type: 'user', id: 'user-5', role: 'member' } });
      await erase(mine, 'user-5');
      await send(mine, { actor: { type: 'user', id: 'user-5', role: 'member' } });
      const view = await subjectView(mine, 'user-5');
      expect(view.blockedSince).not.toBeNull();
      expect(view.events.items).toHaveLength(1);
      const found = await search(as.auditor(), 'actorId=user-5');
      expect(found.items).toHaveLength(1);
      expect(found.blocked).toBe(true);
      const activity = await signed(
        t.server,
        mine,
        'GET',
        '/api/connector/subjects/user-5/activity?limit=10',
      ).expect(200);
      expect(envelopeOf<{ items: unknown[] }>(activity).data.items).toHaveLength(1);
    });

    it('leaves a person blocked in another application out of the view across applications', async () => {
      for (const app of [mine, theirs]) {
        await t.prisma.connectedApp.update({
          where: { id: app.id },
          data: { correlationEnabled: true },
        });
      }
      const shared = 'f'.repeat(64);
      await send(mine, {
        actor: { type: 'user', id: 'user-5', role: 'member', emailHmacShared: shared },
      });
      await send(theirs, {
        actor: { type: 'user', id: 'user-50', role: 'member', emailHmacShared: shared },
      });
      const before = await subjectView(mine, 'user-5', '?acrossApps=true');
      expect(before.summary.otherApps.map((app) => app.slug)).toEqual(['their-project']);
      expect(before.events.items).toHaveLength(2);

      await erase(theirs, 'user-50');
      const after = await subjectView(mine, 'user-5', '?acrossApps=true');
      expect(after.summary.otherApps).toEqual([]);
      expect(after.events.items.map((item) => item.appSlug)).toEqual(['my-project']);
    });
  });

  describe('the connector API', () => {
    it('answers an application about its own user only, signed', async () => {
      await send(
        mine,
        { actor: { type: 'user', id: 'user-3', role: 'member' }, client: { type: 'web' } },
        {
          action: 'account.profile.updated',
          category: 'audit',
          actor: { type: 'user', id: 'user-3', role: 'member' },
        },
      );
      await send(theirs, { actor: { type: 'user', id: 'user-3', role: 'member' } });
      const activity = await signed(
        t.server,
        mine,
        'GET',
        '/api/connector/subjects/user-3/activity?limit=10',
      ).expect(200);
      const items = envelopeOf<{ items: { action: string; location?: unknown }[] }>(activity).data
        .items;
      // Only the catalog's user-visible actions; never an IP.
      expect(items.map((item) => item.action)).toEqual(['auth.session.signed_in']);
      expect(JSON.stringify(activity.body)).not.toContain('203.0.113.7');

      const exported = await signed(
        t.server,
        mine,
        'GET',
        '/api/connector/subjects/user-3/export',
      ).expect(200);
      const page = envelopeOf<{ items: { network?: { ip?: string } }[] }>(exported).data;
      expect(page.items).toHaveLength(2);
      expect(page.items[0]?.network?.ip).toBe('203.0.113.7');

      const erased = await signed(
        t.server,
        theirs,
        'POST',
        '/api/connector/subjects/user-3/erasure',
        {},
      ).expect(200);
      expect(envelopeOf(erased).data).toMatchObject({ personalDeleted: 1 });
      // Their erasure left this application's rows alone.
      expect(await t.prisma.eventPersonal.count({ where: { appId: mine.id } })).toBe(2);
      await request(t.server).get('/api/connector/subjects/user-3/activity').expect(401);
      expect(await hubActions('hub.connector.read')).toBe(2);
    });
  });

  describe('people and their applications', () => {
    it('changes roles and assignments after a step-up, never leaving Audit Hub without an administrator', async () => {
      const access = (id: string) => `/api/users/${id}`;
      await request(t.server)
        .patch(`${access(stranger.id)}/role`)
        .set(as.admin())
        .send({ role: 'viewer' })
        .expect(403);
      const changed = await request(t.server)
        .patch(`${access(stranger.id)}/role`)
        .set(as.admin(true))
        .send({ role: 'viewer' })
        .expect(200);
      expect(envelopeOf(changed).data).toMatchObject({ role: 'viewer', apps: [] });
      // The old token stops at once (a new securityVersion).
      await request(t.server).get('/api/events').set(as.stranger()).expect(401);
      await request(t.server)
        .patch(`${access(admin.id)}/role`)
        .set(as.admin(true))
        .send({ role: 'auditor' })
        .expect(409);

      const assigned = await request(t.server)
        .put(`${access(auditor.id)}/apps`)
        .set(as.admin(true))
        .send({ appIds: [theirs.id] })
        .expect(200);
      expect(
        envelopeOf<{ apps: { slug: string }[] }>(assigned).data.apps.map((app) => app.slug),
      ).toEqual(['their-project']);
      await request(t.server)
        .put(`${access(auditor.id)}/apps`)
        .set(as.admin(true))
        .send({ appIds: ['0199e0b1-0000-7000-8000-00000000dead'] })
        .expect(404);
      const seen = await request(t.server)
        .get(`${access(auditor.id)}/access`)
        .set(as.admin())
        .expect(200);
      expect(envelopeOf(seen).data).toMatchObject({ role: 'auditor' });
      expect(await hubActions('hub.user.role_changed')).toBe(1);
      expect(await hubActions('hub.user.apps_assigned')).toBe(1);
    });
  });
});
