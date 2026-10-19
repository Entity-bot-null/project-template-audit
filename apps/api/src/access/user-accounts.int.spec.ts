import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { asUser, seedUser, signIn, TEST_PASSWORD } from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import { registerApp, type TestConnectedApp } from '../../test/ingest.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import type { UserAccessResponse } from './dto/access.schemas.js';
import { LAST_ADMIN, UserAccessService } from './user-access.service.js';

// Disabling and removing Audit Hub's own accounts against the real database:
// what ends at once (sessions, access tokens, sign-in, links), the last
// administrator who may sign in under concurrency, and what a removal leaves
// (the id, for the records that name it) and takes (everything of the person).
describe("Audit Hub's accounts: disabling and removing (integration)", () => {
  let t: TestApp;
  let app: TestConnectedApp;
  let admin: { id: string; email: string };
  let auditor: { id: string; email: string };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    app = await registerApp(t.app, 'my-project');
    admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
    auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
    await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: app.id } });
  });

  const asAdmin = (recent = true) => asUser(t.app, admin.id, 'admin', 0, { recent });
  const status = (id: string) => `/api/users/${id}/status`;
  const hubActions = (action: string) =>
    t.prisma.auditEvent.count({ where: { appId: SYSTEM_APP_ID, action } });
  const signInAttempt = (email: string, password = TEST_PASSWORD) =>
    request(t.server).post('/api/auth/sign-in').send({ email, password });

  describe('disabling', () => {
    it('ends every session and access token at once, refuses sign-in as a wrong password, and enabling lets them back', async () => {
      const session = await signIn(t.server, auditor.email);
      await request(t.server)
        .patch(status(auditor.id))
        .set(asAdmin(false))
        .send({ disabled: true })
        .expect(403);

      const disabled = await request(t.server)
        .patch(status(auditor.id))
        .set(asAdmin())
        .send({ disabled: true })
        .expect(200);
      expect(envelopeOf<UserAccessResponse>(disabled).data).toMatchObject({
        userId: auditor.id,
        role: 'auditor',
        disabledAt: expect.any(String) as string,
        removedAt: null,
      });

      await request(t.server)
        .get('/api/users/me')
        .set({ Authorization: `Bearer ${session.accessToken}` })
        .expect(401);
      await request(t.server)
        .post('/api/auth/refresh')
        .set('Cookie', session.refreshCookie)
        .expect(401);
      const right = await signInAttempt(auditor.email).expect(401);
      const wrong = await signInAttempt(auditor.email, 'not the password').expect(401);
      expect(right.body).toEqual(wrong.body);
      expect(await t.prisma.session.count({ where: { userId: auditor.id, revokedAt: null } })).toBe(
        0,
      );

      // Asking again changes and records nothing.
      await request(t.server)
        .patch(status(auditor.id))
        .set(asAdmin())
        .send({ disabled: true })
        .expect(200);
      expect(await hubActions('hub.user.disabled')).toBe(1);
      const refused = await t.prisma.auditEvent.findFirstOrThrow({
        where: {
          appId: SYSTEM_APP_ID,
          action: 'hub.session.sign_in_failed',
          resourceId: auditor.id,
        },
        orderBy: { recordedAt: 'asc' },
        select: { details: true },
      });
      expect(refused.details).toEqual({ stage: 'password', accountDisabled: true });

      const enabled = await request(t.server)
        .patch(status(auditor.id))
        .set(asAdmin())
        .send({ disabled: false })
        .expect(200);
      expect(envelopeOf<UserAccessResponse>(enabled).data.disabledAt).toBeNull();
      await signIn(t.server, auditor.email);
      expect(await hubActions('hub.user.enabled')).toBe(1);
    });

    it('never disables your own account, nor the last administrator who may sign in when two try at once', async () => {
      await request(t.server)
        .patch(status(admin.id))
        .set(asAdmin())
        .send({ disabled: true })
        .expect(409);
      const other = await seedUser(t.prisma, { email: 'other-admin@example.com', role: 'admin' });
      const access = t.app.get(UserAccessService);
      const outcomes = await Promise.allSettled([
        access.setDisabled(admin.id, other.id, true),
        access.setDisabled(other.id, admin.id, true),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const failures = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      expect(failures.map((failure) => (failure.reason as Error).message)).toEqual([LAST_ADMIN]);
      expect(await t.prisma.user.count({ where: { role: 'admin', disabledAt: null } })).toBe(1);
      // Nor demoted while the other one is disabled.
      const [remaining] = await t.prisma.user.findMany({
        where: { role: 'admin', disabledAt: null },
        select: { id: true },
      });
      await expect(
        access.changeRole(admin.id, remaining?.id ?? '', 'auditor'),
      ).rejects.toMatchObject({ message: LAST_ADMIN });
    });

    it('takes a disabled account out of alert work: no assignment, no alert email', async () => {
      await request(t.server)
        .patch(status(auditor.id))
        .set(asAdmin())
        .send({ disabled: true })
        .expect(200);
      const alert = await t.prisma.alert.create({
        data: {
          appId: app.id,
          rule: 'brute_force_account',
          severity: 'high',
          groupKey: 'brute_force_account:user-9',
          title: 'Many failed sign-ins',
          summary: {},
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
      await request(t.server)
        .patch(`/api/alerts/${alert.id}`)
        .set(asAdmin())
        .send({ assigneeId: auditor.id, version: 0 })
        .expect(409);
    });
  });

  describe('removing', () => {
    it('keeps the id and nothing of the person, and what they did stays in the log', async () => {
      await signIn(t.server, auditor.email);
      await t.prisma.mfaRecoveryCode.create({
        data: { userId: auditor.id, codeHash: 'a'.repeat(64) },
      });
      await t.prisma.mailMessage.create({
        data: {
          kind: 'password_reset',
          recipient: auditor.email,
          recipientHash: 'b'.repeat(64),
          userId: auditor.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const alert = (status: 'open' | 'resolved') =>
        t.prisma.alert.create({
          data: {
            appId: app.id,
            rule: 'brute_force_account',
            severity: 'high',
            status,
            groupKey: `brute_force_account:${status}`,
            title: 'Many failed sign-ins',
            summary: {},
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            assigneeId: auditor.id,
            ...(status === 'resolved' ? { resolvedAt: new Date(), resolvedById: admin.id } : {}),
          },
        });
      const open = await alert('open');
      const resolved = await alert('resolved');
      const loggedBefore = await t.prisma.auditEvent.count({
        where: { appId: SYSTEM_APP_ID, actorId: auditor.id },
      });
      expect(loggedBefore).toBeGreaterThan(0);

      await request(t.server).delete(`/api/users/${auditor.id}`).set(asAdmin(false)).expect(403);
      await request(t.server).delete(`/api/users/${auditor.id}`).set(asAdmin()).expect(204);

      const removed = await t.prisma.user.findUniqueOrThrow({ where: { id: auditor.id } });
      expect(removed).toMatchObject({
        email: `removed+${auditor.id}@users.invalid`,
        name: 'Removed user',
        role: 'member',
        disabledAt: expect.any(Date) as Date,
        removedAt: expect.any(Date) as Date,
      });
      const where = { where: { userId: auditor.id } };
      expect(await t.prisma.session.count(where)).toBe(0);
      expect(await t.prisma.mfaFactor.count(where)).toBe(0);
      expect(await t.prisma.mfaRecoveryCode.count(where)).toBe(0);
      expect(await t.prisma.mfaChallenge.count(where)).toBe(0);
      expect(await t.prisma.accountToken.count(where)).toBe(0);
      expect(await t.prisma.mailMessage.count(where)).toBe(0);
      expect(await t.prisma.userAppAssignment.count(where)).toBe(0);
      await expect(
        t.prisma.alert.findUniqueOrThrow({ where: { id: open.id } }),
      ).resolves.toMatchObject({ assigneeId: null, version: 1 });
      await expect(
        t.prisma.alert.findUniqueOrThrow({ where: { id: resolved.id } }),
      ).resolves.toMatchObject({ assigneeId: auditor.id, version: 0 });
      await expect(
        t.prisma.alertActivity.findFirstOrThrow({ where: { alertId: open.id, kind: 'assigned' } }),
      ).resolves.toMatchObject({ userId: admin.id, note: 'unassigned' });

      // Nobody signs in to it, by the old address or the placeholder.
      await signInAttempt(auditor.email).expect(401);
      await signInAttempt(removed.email).expect(401);
      // The log of what they did keeps its id, which still resolves.
      expect(
        await t.prisma.auditEvent.count({ where: { appId: SYSTEM_APP_ID, actorId: auditor.id } }),
      ).toBe(loggedBefore);
      const recorded = await t.prisma.auditEvent.findFirstOrThrow({
        where: { appId: SYSTEM_APP_ID, action: 'hub.user.removed' },
        select: { actorId: true, resourceId: true, details: true },
      });
      expect(recorded).toEqual({
        actorId: admin.id,
        resourceId: auditor.id,
        details: { alertsUnassigned: 1 },
      });
      const page = envelopeOf<{ items: { id: string; removedAt: string | null }[] }>(
        await request(t.server).get('/api/users').set(asAdmin(false)).expect(200),
      ).data;
      expect(page.items.find((user) => user.id === auditor.id)?.removedAt).toEqual(
        expect.any(String),
      );
    });

    it('changes a removed account no more, and the address may be used again', async () => {
      await request(t.server).delete(`/api/users/${auditor.id}`).set(asAdmin()).expect(204);
      const users = `/api/users/${auditor.id}`;
      await request(t.server).delete(users).set(asAdmin()).expect(409);
      await request(t.server)
        .patch(`${users}/status`)
        .set(asAdmin())
        .send({ disabled: false })
        .expect(409);
      await request(t.server)
        .patch(`${users}/role`)
        .set(asAdmin())
        .send({ role: 'admin' })
        .expect(409);
      await request(t.server)
        .put(`${users}/apps`)
        .set(asAdmin())
        .send({ appIds: [app.id] })
        .expect(409);
      await request(t.server)
        .post(`${users}/mfa-reset`)
        .set(asAdmin())
        .send({ reason: 'lost their phone' })
        .expect(409);
      // A new account for the same person starts from nothing.
      const again = await seedUser(t.prisma, { email: auditor.email, role: 'viewer' });
      expect(again.id).not.toBe(auditor.id);
    });

    it('never removes your own account, nor the last administrator who may sign in', async () => {
      await request(t.server).delete(`/api/users/${admin.id}`).set(asAdmin()).expect(409);
      const other = await seedUser(t.prisma, { email: 'other-admin@example.com', role: 'admin' });
      const access = t.app.get(UserAccessService);
      const outcomes = await Promise.allSettled([
        access.remove(admin.id, other.id),
        access.remove(other.id, admin.id),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(await t.prisma.user.count({ where: { role: 'admin', disabledAt: null } })).toBe(1);
    });

    it('deletes the invitations a removed administrator sent: none can be accepted', async () => {
      const other = await seedUser(t.prisma, { email: 'other-admin@example.com', role: 'admin' });
      await t.prisma.invitation.create({
        data: { email: 'invited@example.com', role: 'auditor', invitedById: other.id },
      });
      await request(t.server).delete(`/api/users/${other.id}`).set(asAdmin()).expect(204);
      expect(await t.prisma.invitation.count()).toBe(0);
    });
  });
});
