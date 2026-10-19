import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { seedUser, signIn, TEST_PASSWORD } from '../../test/auth.js';
import { registerApp, type TestConnectedApp } from '../../test/ingest.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import { NO_PANEL_ACCESS } from './panel-access.js';

// Who may sign in to Audit Hub's panel (auth/panel-access.ts), against the
// real database: administrators, and auditors and viewers who see an
// application still in service. Everyone else is told so once the password
// is right, and a session whose account lost its way in ends at its refresh.
describe('access to the panel (integration)', () => {
  let t: TestApp;
  let app: TestConnectedApp;

  // An application per test: each starts with the sign-in limit of an
  // address untouched (10 a minute).
  beforeEach(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma);
    app = await registerApp(t.app, 'my-project');
  });

  afterEach(async () => {
    await t.app.close();
  });

  const attempt = (email: string, password = TEST_PASSWORD) =>
    request(t.server).post('/api/auth/sign-in').send({ email, password });
  const refresh = (cookie: string) =>
    request(t.server).post('/api/auth/refresh').set('Cookie', cookie);
  const denials = () =>
    t.prisma.auditEvent.findMany({
      where: { appId: SYSTEM_APP_ID, action: 'hub.session.sign_in_failed', outcome: 'denied' },
      select: { resourceId: true, details: true },
    });

  it('tells a member with the right password that the panel is not theirs, and records it', async () => {
    const member = await seedUser(t.prisma, { email: 'member@example.com' });
    const refused = await attempt(member.email).expect(403);
    expect(refused.body).toEqual({ data: null, message: NO_PANEL_ACCESS });
    expect(await denials()).toEqual([
      { resourceId: member.id, details: { stage: 'password', noPanelAccess: true } },
    ]);
    // No second factor was asked: no challenge exists.
    expect(await t.prisma.mfaChallenge.count({ where: { userId: member.id } })).toBe(0);
    // A wrong password says nothing more than for anyone else.
    await attempt(member.email, 'not the password').expect(401);
  });

  it('lets an administrator in without any application', async () => {
    const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
    await signIn(t.server, admin.email);
  });

  it('lets an auditor or a viewer in once an application is assigned, not before', async () => {
    for (const role of ['auditor', 'viewer'] as const) {
      const person = await seedUser(t.prisma, { email: `${role}@example.com`, role });
      await attempt(person.email).expect(403);
      await t.prisma.userAppAssignment.create({ data: { userId: person.id, appId: app.id } });
      await signIn(t.server, person.email);
    }
  });

  it('ends the session at its refresh once the last application is unassigned or retired', async () => {
    const auditor = await seedUser(t.prisma, { email: 'auditor@example.com', role: 'auditor' });
    await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: app.id } });

    const unassigned = await signIn(t.server, auditor.email);
    await t.prisma.userAppAssignment.deleteMany({ where: { userId: auditor.id } });
    await refresh(unassigned.refreshCookie).expect(401);
    // Ended, not merely refused: assigning it again needs a new sign-in.
    await t.prisma.userAppAssignment.create({ data: { userId: auditor.id, appId: app.id } });
    await refresh(unassigned.refreshCookie).expect(401);

    const retired = await signIn(t.server, auditor.email);
    await t.prisma.connectedApp.update({ where: { id: app.id }, data: { status: 'retired' } });
    await refresh(retired.refreshCookie).expect(401);
    await attempt(auditor.email).expect(403);
    expect(await t.prisma.session.count({ where: { userId: auditor.id, revokedAt: null } })).toBe(
      0,
    );
  });

  it('refuses a disabled member as a wrong password: disabling comes first', async () => {
    const member = await seedUser(t.prisma, { email: 'member@example.com' });
    await t.prisma.user.update({ where: { id: member.id }, data: { disabledAt: new Date() } });
    await attempt(member.email).expect(401);
    expect(await denials()).toEqual([]);
  });
});
