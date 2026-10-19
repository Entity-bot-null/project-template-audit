import type { AuditEvent } from 'audit-contract';
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

// What the admin pages read beyond the explorer (docs/adr/0014): the
// applications a person may see, the list of exports, and the promise that
// every chart and list costs the same number of queries whatever the number
// of events (one aggregation per chart, never a query per point or per row).
describe('the admin pages API (integration)', () => {
  let t: TestApp;
  let shop: TestConnectedApp;
  let admin: { id: string };
  let auditor: { id: string };
  let viewer: { id: string };
  let member: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    shop = await registerApp(t.app, 'shop');
    // A second application, which only an administrator sees.
    await registerApp(t.app, 'blog');
    admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
    auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
    viewer = await seedUser(t.prisma, { email: 'viewer@example.com', role: 'viewer' });
    member = await seedUser(t.prisma, { email: 'member@example.com', role: 'member' });
    await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: shop.id } });
  });

  it('lists the applications each person may see, for the pickers', async () => {
    // Audit Hub's own application exists once something was recorded in it.
    await request(t.server)
      .get('/api/events')
      .set(asUser(t.app, admin.id, 'admin'))
      .expect(200);
    const apps = async (headers: Record<string, string>) =>
      envelopeOf<{ items: { appId: string; slug: string; system: boolean }[] }>(
        await request(t.server).get('/api/account/apps').set(headers).expect(200),
      ).data.items;

    const all = await apps(asUser(t.app, admin.id, 'admin'));
    expect(all.map((app) => app.slug)).toEqual(['blog', 'shop', 'audit-hub']);
    expect(all.at(-1)).toMatchObject({ appId: SYSTEM_APP_ID, system: true });
    expect(await apps(asUser(t.app, auditor.id, 'auditor'))).toEqual([
      expect.objectContaining({ appId: shop.id, slug: 'shop', system: false }),
    ]);
    expect(await apps(asUser(t.app, viewer.id, 'viewer'))).toEqual([]);
    expect(await apps(asUser(t.app, member.id, 'member'))).toEqual([]);
    await request(t.server).get('/api/account/apps').expect(401);
  });

  it("lists each person's exports, and an administrator's view holds everyone's", async () => {
    for (const requestedById of [auditor.id, auditor.id, admin.id]) {
      await t.prisma.exportJob.create({
        data: {
          requestedById,
          filters: { appId: shop.id },
          format: 'csv',
          rowCap: 100_000,
          status: 'running',
        },
      });
    }
    const list = async (headers: Record<string, string>, query = '') =>
      envelopeOf<{ items: { requestedById: string }[]; total: number }>(
        await request(t.server).get(`/api/exports${query}`).set(headers).expect(200),
      ).data;
    const mine = await list(asUser(t.app, auditor.id, 'auditor'), '?limit=1');
    expect(mine.total).toBe(2);
    expect(mine.items).toEqual([expect.objectContaining({ requestedById: auditor.id })]);
    expect((await list(asUser(t.app, admin.id, 'admin'))).total).toBe(3);
    await request(t.server)
      .get('/api/exports')
      .set(asUser(t.app, viewer.id, 'viewer'))
      .expect(403);
  });

  it('answers every chart and list with as many queries for 10,000 events as for 10', async () => {
    await sendEvents(shop, 10);
    const routes = [
      '/api/overview',
      `/api/connected-apps/${shop.id}/security?days=30`,
      `/api/events?appId=${shop.id}&limit=50`,
      `/api/connected-apps/${shop.id}/subjects/user-1`,
    ];
    const few = await queriesPer(routes);
    await cloneEvents(shop, 9_990);
    expect(await t.prisma.auditEvent.count({ where: { appId: shop.id } })).toBe(10_000);
    const many = await queriesPer(routes);
    expect(many).toEqual(few);
    // Every one is a handful of statements, not one per event.
    for (const count of Object.values(few)) expect(count).toBeLessThan(40);
  }, 120_000);

  async function sendEvents(app: TestConnectedApp, count: number): Promise<void> {
    const version = await publishCatalog(t.server, app, testCatalog());
    const failure: Partial<AuditEvent> = {
      action: 'auth.session.signed_in',
      outcome: 'failure',
      actor: { type: 'user', id: 'user-1', role: 'member' },
    };
    const events = Array.from({ length: count }, (_, index) =>
      testEvent(version, index + 1, failure),
    );
    await signed(t.server, app, 'POST', '/api/ingest/events', batch(events)).expect(200);
  }

  /** Copies of the application's first event, new ids and sequence numbers, straight in SQL. */
  async function cloneEvents(app: TestConnectedApp, count: number): Promise<void> {
    const columns = await t.prisma.$queryRaw<{ name: string }[]>`
      SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_events' AND is_generated = 'NEVER'
      ORDER BY ordinal_position`;
    const names = columns.map(({ name }) => name);
    const value = (name: string) => {
      if (name === 'id' || name === 'event_id') return 'gen_random_uuid()';
      if (name === 'source_seq') return 'e."source_seq" + g';
      return `e."${name}"`;
    };
    const list = names.map((name) => `"${name}"`).join(', ');
    const values = names.map(value).join(', ');
    // Audit events are written in a transaction with a deadline, as the API does.
    await t.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL transaction_timeout = '15s'`;
      // eslint-disable-next-line no-restricted-properties -- column names come from information_schema and are quoted; the only values (the app and the count) are bound
      await tx.$executeRawUnsafe(
        `INSERT INTO "audit_events" (${list})
         SELECT ${values} FROM "audit_events" e, generate_series(1000, 999 + $2::int) g
         WHERE e."id" = (SELECT "id" FROM "audit_events" WHERE "app_id" = $1::uuid ORDER BY "source_seq" LIMIT 1)`,
        app.id,
        count,
      );
    });
  }

  /**
   * The statements each route sends, the fewest of three tries: the app's
   * background jobs (rules, sealing, webhooks) query the same database, and
   * can only add to a count, never take from it.
   */
  async function queriesPer(routes: string[]): Promise<Record<string, number>> {
    let count = 0;
    t.prisma.$on('query', () => {
      count += 1;
    });
    const counts: Record<string, number> = {};
    for (const route of routes) {
      let fewest = Number.POSITIVE_INFINITY;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        count = 0;
        await request(t.server)
          .get(route)
          .set(asUser(t.app, admin.id, 'admin'))
          .expect(200);
        fewest = Math.min(fewest, count);
      }
      counts[route.replace(shop.id, ':appId')] = fewest;
    }
    return counts;
  }
});
