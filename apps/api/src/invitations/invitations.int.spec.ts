import { Logger } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import {
  asUser,
  bearer,
  completeEnrollment,
  forgetUsedCode,
  seedUser,
  signIn,
} from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import { registerApp, type TestConnectedApp } from '../../test/ingest.js';
import {
  deleteMessagesTo,
  mailTestOptions,
  messagesTo,
  readMessage,
  skipWithoutMailpit,
  testAddress,
} from '../../test/mailpit.js';
import { MailWorker } from '../infrastructure/mail/mail-worker.service.js';
import { MAIL_OPTIONS } from '../infrastructure/mail/mail.constants.js';
import type { MailOptions } from '../infrastructure/mail/mail.types.js';

// Invitations end to end against PostgreSQL and Mailpit: administrators only,
// the link out of a real message, no account until it is accepted, and the
// role fixed by the administrator.

const PASSWORD = 'violet harbour lantern 7';
const ACCEPT_LINK = /\/accept-invitation#token=([A-Za-z0-9_-]{43})/;

interface InvitationApp extends TestApp {
  worker: MailWorker;
}

async function app(overrides: Partial<MailOptions> = {}): Promise<InvitationApp> {
  const t = await createTestApp((builder) =>
    builder.overrideProvider(MAIL_OPTIONS).useValue(mailTestOptions(overrides)),
  );
  const worker = t.app.get(MailWorker);
  // The spec decides when messages go out (runOnce), not the poll.
  vi.spyOn(worker, 'wake').mockImplementation(() => undefined);
  return { ...t, worker };
}

describe.skipIf(skipWithoutMailpit)('invitations (PostgreSQL + Mailpit)', () => {
  let t: InvitationApp;
  let adminToken: string;
  let connected: TestConnectedApp;
  const addresses: string[] = [];

  function address(): string {
    const email = testAddress();
    addresses.push(email);
    return email;
  }

  const invite = (email: string, role = 'admin', token = adminToken, appIds?: string[]) =>
    request(t.server)
      .post('/api/admin/invitations')
      .set(bearer(token))
      .send({ email, role, ...(appIds === undefined ? {} : { appIds }) });

  /** Sends the queue and returns the newest invitation link's token sent to `email`. */
  async function linkFor(email: string): Promise<string> {
    await t.worker.runOnce();
    const found = (await messagesTo(email)).find((m) => m.Subject.startsWith('You are invited'));
    if (found === undefined) throw new Error(`no invitation to ${email}`);
    const token = ACCEPT_LINK.exec((await readMessage(found.ID)).text)?.[1];
    if (token === undefined) throw new Error('no invitation link in the message');
    return token;
  }

  const accept = (token: string, name = 'Katherine Johnson', password = PASSWORD) =>
    request(t.server).post('/api/auth/invitations/accept').send({ token, name, password });

  beforeEach(async () => {
    t = await app();
    await resetDatabase(t.prisma);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const admin = await seedUser(t.prisma, { email: address(), name: 'Admin', role: 'admin' });
    adminToken = (await signIn(t.server, admin.email)).accessToken;
    connected = await registerApp(t.app, 'my-project');
  });
  afterEach(async () => {
    await t.app.close();
    for (const email of addresses.splice(0)) await deleteMessagesTo(email);
  });

  it('creates no account until the link of a real message is accepted, with the invited role, then signs in', async () => {
    const email = address();
    const created = await invite(email, 'admin').expect(201);
    expect(envelopeOf(created).data).toMatchObject({ email, role: 'admin', expiresAt: null });
    const token = await linkFor(email);
    expect(await t.prisma.user.count({ where: { email } })).toBe(0);
    expect(JSON.stringify(await t.prisma.invitation.findMany())).not.toContain(token);
    const listed = await request(t.server)
      .get('/api/admin/invitations')
      .set(bearer(adminToken))
      .expect(200);
    const page = envelopeOf<{
      items: { email: string; expiresAt: string | null }[];
      total: number;
    }>(listed).data;
    expect(page.total).toBe(1);
    expect(page.items[0]?.expiresAt).not.toBeNull();

    // The account exists; its session starts once its second factor is set up (docs/adr/0012).
    const res = await accept(token).expect(200);
    const challenge = envelopeOf<{ mfa: string; challengeToken: string }>(res).data;
    expect(challenge.mfa).toBe('enroll');
    const enrolled = await completeEnrollment(t.server, challenge.challengeToken);
    const session = envelopeOf<{ accessToken: string; user: Record<string, unknown> }>(
      enrolled.res,
    ).data;
    expect(session.user).toMatchObject({ email, name: 'Katherine Johnson', role: 'admin' });
    await request(t.server).get('/api/users').set(bearer(session.accessToken)).expect(200);
    await forgetUsedCode(email);
    await signIn(t.server, email, PASSWORD, enrolled.secret);
    expect(await t.prisma.invitation.count()).toBe(0);
    await accept(token).expect(404);
  });

  it('gives an auditor or a viewer the applications chosen, so they sign in at once', async () => {
    const email = address();
    const created = await invite(email, 'viewer', adminToken, [connected.id]).expect(201);
    expect(envelopeOf(created).data).toMatchObject({
      role: 'viewer',
      apps: [{ appId: connected.id, slug: 'my-project', name: 'App my-project' }],
    });
    const token = await linkFor(email);
    const challenge = envelopeOf<{ challengeToken: string }>(await accept(token).expect(200)).data;
    const enrolled = await completeEnrollment(t.server, challenge.challengeToken);
    const session = envelopeOf<{ accessToken: string }>(enrolled.res).data;
    const account = await t.prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, role: true, appAssignments: { select: { appId: true } } },
    });
    expect(account).toMatchObject({ role: 'viewer', appAssignments: [{ appId: connected.id }] });
    // Assigned by whoever invited; the invitation and its applications are gone.
    expect(
      await t.prisma.userAppAssignment.findFirst({ where: { userId: account.id } }),
    ).toMatchObject({ createdById: expect.any(String) as string });
    expect(await t.prisma.invitationApp.count()).toBe(0);
    // In the panel at once, seeing its application.
    const overview = await request(t.server)
      .get('/api/overview')
      .set(bearer(session.accessToken))
      .expect(200);
    expect(envelopeOf<{ apps: { appId: string }[] }>(overview).data.apps).toEqual([
      expect.objectContaining({ appId: connected.id }),
    ]);
  });

  it('stops working once its applications were retired, and for a member invited before', async () => {
    const email = address();
    await invite(email, 'auditor', adminToken, [connected.id]).expect(201);
    const token = await linkFor(email);
    await t.prisma.connectedApp.update({
      where: { id: connected.id },
      data: { status: 'retired' },
    });
    await accept(token).expect(404);
    expect(await t.prisma.user.count({ where: { email } })).toBe(0);
    // Pending, for the administrator to see and invite again.
    expect(await t.prisma.invitation.count({ where: { email } })).toBe(1);

    // A member could never sign in: an invitation of one from before is dead.
    const member = address();
    await invite(member).expect(201);
    const memberToken = await linkFor(member);
    await t.prisma.invitation.updateMany({ where: { email: member }, data: { role: 'member' } });
    await accept(memberToken).expect(404);
    expect(await t.prisma.user.count({ where: { email: member } })).toBe(0);
  });

  it('is for administrators only', async () => {
    // An auditor's token: a member could not even sign in (auth/panel-access.ts).
    const auditor = await seedUser(t.prisma, { email: address(), role: 'auditor' });
    const asAuditor = asUser(t.app, auditor.id, 'auditor');
    await request(t.server)
      .post('/api/admin/invitations')
      .set(asAuditor)
      .send({ email: address(), role: 'admin' })
      .expect(403);
    await request(t.server).get('/api/admin/invitations').set(asAuditor).expect(403);
    await request(t.server)
      .delete('/api/admin/invitations/0190b6a1-0000-7000-8000-000000000001')
      .set(asAuditor)
      .expect(403);
    await request(t.server)
      .post('/api/admin/invitations')
      .send({ email: address(), role: 'admin' })
      .expect(401);
    expect(await t.prisma.invitation.count()).toBe(0);
  });

  it('refuses an address that has an account, a role that cannot sign in, applications that do not fit, and an address it does not know', async () => {
    const existing = await seedUser(t.prisma, { email: address() });
    await invite(existing.email).expect(409);
    await invite(address(), 'owner').expect(400);
    await invite(address(), 'member').expect(400);
    // An auditor or a viewer without applications could not sign in; an
    // administrator sees every one.
    await invite(address(), 'viewer').expect(400);
    await invite(address(), 'admin', adminToken, [connected.id]).expect(400);
    await invite(address(), 'auditor', adminToken, ['0190b6a1-0000-7000-8000-00000000dead']).expect(
      404,
    );
    await t.prisma.connectedApp.update({
      where: { id: connected.id },
      data: { status: 'retired' },
    });
    await invite(address(), 'auditor', adminToken, [connected.id]).expect(404);
    await invite('not-an-email').expect(400);
    expect(await t.prisma.invitation.count()).toBe(0);
  });

  it('replaces the earlier invitation and its link when inviting again; revoking ends the link', async () => {
    const email = address();
    await invite(email).expect(201);
    const first = await linkFor(email);
    // Past the one-message-a-minute limit of the address.
    await t.prisma.mailMessage.updateMany({ data: { createdAt: new Date(Date.now() - 61_000) } });
    const again = await invite(email).expect(201);
    const second = await linkFor(email);
    await accept(first).expect(404);

    const id = envelopeOf<{ id: string }>(again).data.id;
    await request(t.server)
      .delete(`/api/admin/invitations/${id}`)
      .set(bearer(adminToken))
      .expect(204);
    await accept(second).expect(404);
    await request(t.server)
      .delete(`/api/admin/invitations/${id}`)
      .set(bearer(adminToken))
      .expect(404);
  });

  it('answers 429 within a minute of the last message to the address, keeping the earlier link', async () => {
    const email = address();
    await invite(email, 'viewer', adminToken, [connected.id]).expect(201);
    const token = await linkFor(email);
    await invite(email, 'admin').expect(429);
    // Nothing changed: the earlier invitation, its link and its role stand.
    await accept(token).expect(200);
    const account = await t.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(account.role).toBe('viewer');
  });

  it('keeps the link through a refused password, refuses an expired one, and creates one account from two acceptances', async () => {
    const email = address();
    await invite(email).expect(201);
    const token = await linkFor(email);
    for (const weak of ['too short', 'correcthorsebatterystaple', 'katherine and her numbers']) {
      await accept(token, 'Katherine Johnson', weak).expect(400);
    }
    const results = await Promise.all([accept(token), accept(token)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 404]);
    expect(await t.prisma.user.count({ where: { email } })).toBe(1);

    const late = address();
    await invite(late).expect(201);
    const lateToken = await linkFor(late);
    await t.prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    await accept(lateToken).expect(404);
  });

  it('stops working once whoever invited is no longer an administrator', async () => {
    const email = address();
    await invite(email, 'admin').expect(201);
    const token = await linkFor(email);
    await t.prisma.user.updateMany({ where: { role: 'admin' }, data: { role: 'member' } });
    await accept(token).expect(404);
    expect(await t.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('stops working once whoever invited may no longer sign in (disabled or removed)', async () => {
    const email = address();
    await invite(email, 'admin').expect(201);
    const token = await linkFor(email);
    await t.prisma.user.updateMany({ where: { role: 'admin' }, data: { disabledAt: new Date() } });
    await accept(token).expect(404);
    expect(await t.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('answers 409 when the address got an account after the invitation was sent', async () => {
    const email = address();
    await invite(email).expect(201);
    const token = await linkFor(email);
    await seedUser(t.prisma, { email, name: 'Signed up meanwhile' });
    await accept(token).expect(409);
  });

  it('says what it offers, answers 503 without email, and refuses a cross-site acceptance', async () => {
    const offered = await request(t.server).get('/api/auth/capabilities').expect(200);
    expect(envelopeOf<{ invitations: boolean }>(offered).data.invitations).toBe(true);
    await request(t.server)
      .post('/api/auth/invitations/accept')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://evil.example')
      .send({ token: 'a'.repeat(43), name: 'X', password: PASSWORD })
      .expect(403);
    await accept('not-a-token').expect(400);

    await t.app.close();
    t = await app({ smtpUrl: undefined });
    const off = await request(t.server).get('/api/auth/capabilities').expect(200);
    expect(envelopeOf<{ invitations: boolean }>(off).data.invitations).toBe(false);
    const admin = await seedUser(t.prisma, { email: address(), role: 'admin' });
    adminToken = (await signIn(t.server, admin.email)).accessToken;
    await invite(address()).expect(503);
  });
});
