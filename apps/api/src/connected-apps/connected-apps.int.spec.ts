import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MISSING_ID } from '../../test/access.js';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { asUser, seedUser } from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import {
  batch,
  publishCatalog,
  signed,
  type TestConnectedApp,
  testEvent,
} from '../../test/ingest.js';
import { ageEvents } from '../../test/time-travel.js';
import { SealerService } from '../integrity/sealer.service.js';
import { SYSTEM_APP_ID } from './connected-apps.service.js';
import type {
  AppDeletionProgress,
  ConnectedAppResponse,
  CreatedConnectedAppResponse,
  CredentialsResponse,
} from './dto/connected-app.schemas.js';

// The administration of connected applications over HTTP (docs/adr/0006):
// administrators only; secrets in the answer that creates them, never after.
describe('connected applications (integration)', () => {
  let t: TestApp;
  let admin: { id: string };
  let member: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
    member = await seedUser(t.prisma, { email: 'member@example.com' });
  });

  // Changes need a recent step-up (docs/adr/0012): the suite's administrator has one.
  const asAdmin = () => asUser(t.app, admin.id, 'admin', 0, { recent: true });

  async function create(slug = 'my-project') {
    const res = await request(t.server)
      .post('/api/connected-apps')
      .set(asAdmin())
      .send({ slug, name: 'My project', environment: 'production' })
      .expect(201);
    return envelopeOf<CreatedConnectedAppResponse>(res).data;
  }

  const asConnected = (
    created: CreatedConnectedAppResponse,
    variables = created.credentials.variables,
  ): TestConnectedApp => ({
    id: created.app.id,
    slug: created.app.slug,
    keyId: variables.AUDIT_HUB_KEY_ID ?? '',
    keySecret: variables.AUDIT_HUB_KEY_SECRET ?? '',
    pseudonymKey: created.credentials.variables.AUDIT_HUB_PSEUDONYM_KEY ?? '',
    webhookSecret: created.credentials.variables.AUDIT_HUB_WEBHOOK_SECRET ?? '',
  });

  it('needs a recent step-up for every change, and records it', async () => {
    const stale = asUser(t.app, admin.id, 'admin');
    const refused = await request(t.server)
      .post('/api/connected-apps')
      .set(stale)
      .send({ slug: 'my-project', name: 'My project', environment: 'production' })
      .expect(403);
    expect(refused.headers['audit-error']).toBe('reauthentication_required');
    const created = await create();
    for (const [method, path] of [
      ['patch', `/api/connected-apps/${created.app.id}`],
      ['post', `/api/connected-apps/${created.app.id}/keys`],
      ['post', `/api/connected-apps/${created.app.id}/webhook-secret`],
    ] as const) {
      await request(t.server)[method](path).set(stale).send({ name: 'x' }).expect(403);
    }
    // Reading needs none.
    await request(t.server).get('/api/connected-apps').set(stale).expect(200);
    const recorded = await t.prisma.auditEvent.findMany({
      where: { action: 'hub.app.changed' },
      select: { actorId: true, resourceId: true, details: true },
    });
    expect(recorded).toEqual([
      { actorId: admin.id, resourceId: created.app.id, details: { change: 'created' } },
    ]);
  });

  it('lets only administrators in', async () => {
    await request(t.server).get('/api/connected-apps').expect(401);
    await request(t.server)
      .get('/api/connected-apps')
      .set(asUser(t.app, member.id, 'member'))
      .expect(403);
    await request(t.server)
      .post('/api/connected-apps')
      .set(asUser(t.app, member.id, 'member'))
      .send({ slug: 'my-project', name: 'My project', environment: 'production' })
      .expect(403);
  });

  it('answers the variables once; reading the application never shows a secret', async () => {
    const created = await create();
    expect(Object.keys(created.credentials.variables).sort()).toEqual([
      'AUDIT_HUB_APP',
      'AUDIT_HUB_KEY_ID',
      'AUDIT_HUB_KEY_SECRET',
      'AUDIT_HUB_PSEUDONYM_KEY',
      'AUDIT_HUB_URL',
      'AUDIT_HUB_WEBHOOK_SECRET',
    ]);
    const secret = created.credentials.variables.AUDIT_HUB_KEY_SECRET ?? '';
    const read = await request(t.server)
      .get(`/api/connected-apps/${created.app.id}`)
      .set(asAdmin())
      .expect(200);
    expect(envelopeOf<ConnectedAppResponse>(read).data).toMatchObject({
      slug: 'my-project',
      status: 'active',
      keys: [expect.objectContaining({ revokedAt: null, expiresAt: null })],
    });
    const listed = await request(t.server).get('/api/connected-apps').set(asAdmin()).expect(200);
    for (const body of [read.body, listed.body]) {
      expect(JSON.stringify(body)).not.toContain(secret);
    }
    // The system application (Audit Hub's own events) is not one to manage.
    expect(envelopeOf<ConnectedAppResponse[]>(listed).data.map((app) => app.slug)).toEqual([
      'my-project',
    ]);
    await request(t.server).get(`/api/connected-apps/${MISSING_ID}`).set(asAdmin()).expect(404);
  });

  it('refuses a taken slug and one unfit for metric labels', async () => {
    await create();
    await request(t.server)
      .post('/api/connected-apps')
      .set(asAdmin())
      .send({ slug: 'my-project', name: 'Again', environment: 'production' })
      .expect(409);
    await request(t.server)
      .post('/api/connected-apps')
      .set(asAdmin())
      .send({ slug: 'My Project', name: 'Bad', environment: 'production' })
      .expect(400);
  });

  it('suspends and changes an application', async () => {
    const created = await create();
    const connected = asConnected(created);
    const version = await publishCatalog(t.server, connected);
    const res = await request(t.server)
      .patch(`/api/connected-apps/${created.app.id}`)
      .set(asAdmin())
      .send({
        status: 'suspended',
        rateLimitPerMinute: 120,
        webhookUrl: 'https://app.example.com/api/audit/webhooks',
      })
      .expect(200);
    expect(envelopeOf<ConnectedAppResponse>(res).data).toMatchObject({
      status: 'suspended',
      rateLimitPerMinute: 120,
      webhookUrl: 'https://app.example.com/api/audit/webhooks',
    });
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    await signed(t.server, connected, 'POST', '/api/ingest/events', batch([])).expect(403);
    await request(t.server)
      .patch(`/api/connected-apps/${created.app.id}`)
      .set(asAdmin())
      .send({})
      .expect(400);
    await request(t.server)
      .patch(`/api/connected-apps/${created.app.id}`)
      .set(asAdmin())
      .send({ webhookUrl: 'ftp://app.example.com/' })
      .expect(400);
  });

  it('rotates the signing key with a grace period, and revokes a key at once', async () => {
    const created = await create();
    const first = asConnected(created);
    await publishCatalog(t.server, first);
    const rotate = () =>
      request(t.server).post(`/api/connected-apps/${created.app.id}/keys`).set(asAdmin());
    const rotated = envelopeOf<CredentialsResponse>(await rotate().expect(201)).data;
    const second = asConnected(created, rotated.variables);
    expect(second.keyId).not.toBe(first.keyId);
    // Both verify during the grace period.
    await publishCatalog(t.server, first);
    await publishCatalog(t.server, second);
    // A third key while the replaced one is valid: revoke it first.
    await rotate().expect(409);
    await request(t.server)
      .delete(`/api/connected-apps/${created.app.id}/keys/${first.keyId}`)
      .set(asAdmin())
      .expect(204);
    await signed(t.server, first, 'PUT', '/api/ingest/catalog', {}).expect(401);
    await publishCatalog(t.server, second);
    await request(t.server)
      .delete(`/api/connected-apps/${created.app.id}/keys/${MISSING_ID}`)
      .set(asAdmin())
      .expect(404);
  });

  it('rotates the webhook secret, shown once', async () => {
    const created = await create();
    const res = await request(t.server)
      .post(`/api/connected-apps/${created.app.id}/webhook-secret`)
      .set(asAdmin())
      .expect(201);
    const secret = envelopeOf<CredentialsResponse>(res).data.variables.AUDIT_HUB_WEBHOOK_SECRET;
    expect(secret).toBeDefined();
    expect(secret).not.toBe(created.credentials.variables.AUDIT_HUB_WEBHOOK_SECRET);
    await request(t.server)
      .post(`/api/connected-apps/${MISSING_ID}/webhook-secret`)
      .set(asAdmin())
      .expect(404);
  });

  describe("the end of an application's service", () => {
    /** An application with `count` events, sealed unless asked otherwise. */
    async function withEvents(count: number, sealed = true) {
      const created = await create();
      const connected = asConnected(created);
      const version = await publishCatalog(t.server, connected);
      const events = Array.from({ length: count }, (_, n) => testEvent(version, n + 1));
      await signed(t.server, connected, 'POST', '/api/ingest/events', batch(events)).expect(200);
      if (sealed) {
        const rows = await t.prisma.auditEvent.findMany({
          where: { appId: created.app.id },
          select: { id: true },
        });
        await ageEvents(
          t.prisma,
          rows.map((row) => row.id),
          10 * 60_000,
        );
        await t.app.get(SealerService).sealAll();
      }
      return { created, connected };
    }
    const deletion = (id: string, confirm: string, headers = asAdmin()) =>
      request(t.server).post(`/api/connected-apps/${id}/deletion`).set(headers).send({ confirm });
    const suspend = (id: string) =>
      request(t.server)
        .patch(`/api/connected-apps/${id}`)
        .set(asAdmin())
        .send({ status: 'suspended' })
        .expect(200);
    const deletedRecords = () =>
      t.prisma.auditEvent.findMany({
        where: { appId: SYSTEM_APP_ID, action: 'hub.app.deleted' },
        select: { resourceId: true, details: true },
      });

    it("deletes a suspended application's log once its slug is typed, then retires it for good", async () => {
      const { created, connected } = await withEvents(2);
      const id = created.app.id;
      await deletion(id, 'my-project', asUser(t.app, admin.id, 'admin')).expect(403);
      await deletion(id, 'my-project').expect(409);
      await suspend(id);
      await deletion(id, 'My-Project').expect(400);
      expect(await t.prisma.auditEvent.count({ where: { appId: id } })).toBe(2);

      const done = await deletion(id, 'my-project').expect(200);
      expect(envelopeOf<AppDeletionProgress>(done).data).toEqual({
        status: 'deleted',
        deleted: 2,
        held: 0,
        waiting: 0,
      });
      expect(await t.prisma.auditEvent.count({ where: { appId: id } })).toBe(0);
      expect(await t.prisma.appKey.count({ where: { appId: id } })).toBe(0);
      const read = await request(t.server)
        .get(`/api/connected-apps/${id}`)
        .set(asAdmin())
        .expect(200);
      expect(envelopeOf<ConnectedAppResponse>(read).data).toMatchObject({
        status: 'retired',
        webhookUrl: null,
      });
      // Its keys are gone: nothing it sends is taken.
      const refused = await signed(t.server, connected, 'POST', '/api/ingest/events', batch([]));
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
      await request(t.server)
        .patch(`/api/connected-apps/${id}`)
        .set(asAdmin())
        .send({ status: 'active' })
        .expect(409);
      expect(await deletedRecords()).toEqual([{ resourceId: id, details: { eventsDeleted: 2 } }]);

      // Asking again answers the end state, and records nothing more.
      const again = await deletion(id, 'whatever').expect(200);
      expect(envelopeOf<AppDeletionProgress>(again).data.status).toBe('deleted');
      expect(await deletedRecords()).toHaveLength(1);
    });

    it('says deleting, retiring nothing, while another deletion of its events holds the lock', async () => {
      const { created } = await withEvents(1);
      const id = created.app.id;
      await suspend(id);
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const holding = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // Another deletion of the application, mid-batch (another instance, an erasure).
      const other = t.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`audit-delete:${id}`}, 0))`;
          locked();
          await released;
        },
        { timeout: 30_000 },
      );
      await holding;
      try {
        const busy = await deletion(id, 'my-project').expect(200);
        expect(envelopeOf<AppDeletionProgress>(busy).data).toEqual({
          status: 'deleting',
          deleted: 0,
          held: 0,
          waiting: 0,
        });
        expect(await t.prisma.auditEvent.count({ where: { appId: id } })).toBe(1);
      } finally {
        release();
        await other;
      }
      const done = await deletion(id, 'my-project').expect(200);
      expect(envelopeOf<AppDeletionProgress>(done).data).toMatchObject({ status: 'deleted' });
    }, 30_000);

    it('waits for events not sealed yet, and for a legal hold, without retiring the application', async () => {
      const { created } = await withEvents(1, false);
      const id = created.app.id;
      await suspend(id);
      const waiting = await deletion(id, 'my-project').expect(200);
      expect(envelopeOf<AppDeletionProgress>(waiting).data).toEqual({
        status: 'waiting',
        deleted: 0,
        held: 0,
        waiting: 1,
      });
      const rows = await t.prisma.auditEvent.findMany({
        where: { appId: id },
        select: { id: true },
      });
      await ageEvents(
        t.prisma,
        rows.map((row) => row.id),
        10 * 60_000,
      );
      await t.app.get(SealerService).sealAll();
      await t.prisma.legalHold.create({
        data: {
          appId: id,
          caseRef: 'CASE-9',
          reason: 'Audit of the application before its deletion',
          fromAt: new Date(0),
          createdById: admin.id,
        },
      });
      const held = await deletion(id, 'my-project').expect(200);
      expect(envelopeOf<AppDeletionProgress>(held).data).toMatchObject({ status: 'held', held: 1 });
      const read = await request(t.server)
        .get(`/api/connected-apps/${id}`)
        .set(asAdmin())
        .expect(200);
      expect(envelopeOf<ConnectedAppResponse>(read).data.status).toBe('suspended');
      expect(await deletedRecords()).toEqual([]);
    });
  });
});
