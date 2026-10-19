import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MISSING_ID } from '../../test/access.js';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { asUser, seedUser } from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import { registerApp, type TestConnectedApp } from '../../test/ingest.js';
import type { IntegrityStatus } from '../integrity/dto/integrity.schemas.js';
import type { LegalHoldResponse, RetentionPolicyResponse } from './dto/retention.schemas.js';

// Retention settings, legal holds and the integrity status over HTTP:
// administrators only, and never below what the database enforces.
describe('retention and legal holds (integration)', () => {
  let t: TestApp;
  let connected: TestConnectedApp;
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
    connected = await registerApp(t.app);
  });

  // Changes need a recent step-up (docs/adr/0012): the suite's administrator has one.
  const asAdmin = () => asUser(t.app, admin.id, 'admin', 0, { recent: true });
  const asMember = () => asUser(t.app, member.id, 'member');
  const retention = (appId = connected.id) => `/api/connected-apps/${appId}/retention`;

  it('needs a recent step-up to change retention or holds, and records the changes', async () => {
    const stale = asUser(t.app, admin.id, 'admin');
    await request(t.server)
      .put(`${retention()}/security`)
      .set(stale)
      .send({ days: 800 })
      .expect(403);
    await request(t.server)
      .post('/api/legal-holds')
      .set(stale)
      .send({ appId: connected.id, caseRef: 'C-1', reason: 'Litigation about 42', actorId: 'u-42' })
      .expect(403);
    await request(t.server).get(retention()).set(stale).expect(200);
    await request(t.server)
      .put(`${retention()}/security`)
      .set(asAdmin())
      .send({ days: 800 })
      .expect(200);
    const recorded = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'hub.retention.changed' },
    });
    expect(recorded).toMatchObject({
      actorId: admin.id,
      details: { class: 'security', days: 800 },
    });
  });

  it('lets only administrators in', async () => {
    await request(t.server).get(retention()).expect(401);
    await request(t.server).get(retention()).set(asMember()).expect(403);
    await request(t.server)
      .put(`${retention()}/security`)
      .set(asMember())
      .send({ days: 800 })
      .expect(403);
    await request(t.server).post('/api/legal-holds').set(asMember()).send({}).expect(403);
    await request(t.server).get('/api/integrity/status').set(asMember()).expect(403);
  });

  it('shows each class with its minimum, and refuses a setting below it', async () => {
    const listed = await request(t.server).get(retention()).set(asAdmin()).expect(200);
    const policies = envelopeOf<RetentionPolicyResponse[]>(listed).data;
    expect(policies.find((policy) => policy.class === 'security')).toEqual({
      class: 'security',
      minimumDays: 730,
      days: 730,
      custom: false,
    });
    await request(t.server)
      .put(`${retention()}/security`)
      .set(asAdmin())
      .send({ days: 365 })
      .expect(400);
    await request(t.server)
      .put(`${retention()}/forever`)
      .set(asAdmin())
      .send({ days: 800 })
      .expect(400);
    await request(t.server)
      .put(`${retention()}/security`)
      .set(asAdmin())
      .send({ days: 99_999 })
      .expect(400);
    const set = await request(t.server)
      .put(`${retention()}/security`)
      .set(asAdmin())
      .send({ days: 800 })
      .expect(200);
    expect(
      envelopeOf<RetentionPolicyResponse[]>(set).data.find((policy) => policy.class === 'security'),
    ).toMatchObject({ days: 800, custom: true });
    await request(t.server).get(retention(MISSING_ID)).set(asAdmin()).expect(404);
    await request(t.server).get(retention('not-a-uuid')).set(asAdmin()).expect(400);
  });

  it('places, lists and releases a legal hold, once', async () => {
    await request(t.server)
      .post('/api/legal-holds')
      .set(asAdmin())
      .send({ appId: connected.id, caseRef: 'CASE-1', reason: 'Litigation about account 42' })
      .expect(400);
    await request(t.server)
      .post('/api/legal-holds')
      .set(asAdmin())
      .send({
        appId: connected.id,
        caseRef: 'CASE-1',
        reason: 'Litigation about account 42',
        resourceId: 'doc-7',
      })
      .expect(400);
    await request(t.server)
      .post('/api/legal-holds')
      .set(asAdmin())
      .send({ appId: connected.id, caseRef: 'CASE-1', reason: 'Too short', actorId: 'user-42' })
      .expect(400);
    await request(t.server)
      .post('/api/legal-holds')
      .set(asAdmin())
      .send({
        appId: MISSING_ID,
        caseRef: 'CASE-1',
        reason: 'Litigation about account 42',
        actorId: 'user-42',
      })
      .expect(404);

    const created = await request(t.server)
      .post('/api/legal-holds')
      .set(asAdmin())
      .send({
        appId: connected.id,
        caseRef: 'CASE-1',
        reason: 'Litigation about account 42',
        actorEmail: 'Person@Example.com',
      })
      .expect(201);
    const hold = envelopeOf<LegalHoldResponse>(created).data;
    expect(hold).toMatchObject({ byEmail: true, createdById: admin.id, release: null });
    expect(JSON.stringify(created.body)).not.toContain('Person@Example.com');
    const stored = await t.prisma.legalHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(stored.actorEmailHmac).toMatch(/^[0-9a-f]{64}$/);

    const listed = await request(t.server)
      .get(`/api/connected-apps/${connected.id}/legal-holds`)
      .set(asAdmin())
      .expect(200);
    expect(envelopeOf<LegalHoldResponse[]>(listed).data.map((row) => row.id)).toEqual([hold.id]);

    const release = (id: string) =>
      request(t.server)
        .post(`/api/legal-holds/${id}/release`)
        .set(asAdmin())
        .send({ reason: 'Case closed by the court' });
    const released = await release(hold.id).expect(200);
    expect(envelopeOf<LegalHoldResponse>(released).data.release).toMatchObject({
      reason: 'Case closed by the court',
      releasedById: admin.id,
    });
    await release(hold.id).expect(400);
    await release(MISSING_ID).expect(404);
  });

  it('shows the integrity state to administrators', async () => {
    const res = await request(t.server).get('/api/integrity/status').set(asAdmin()).expect(200);
    expect(envelopeOf<IntegrityStatus>(res).data).toEqual({
      streams: [],
      verifications: [],
      lastCheckpoint: null,
    });
  });
});
