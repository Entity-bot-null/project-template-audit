import { Secret } from 'otpauth';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../../test/app.js';
import {
  asUser,
  bearer,
  completeEnrollment,
  forgetUsedCode,
  seedUser,
  signIn,
  TEST_PASSWORD,
  totpCode,
} from '../../../test/auth.js';
import { envelopeOf } from '../../../test/http.js';
import { SYSTEM_APP_ID } from '../../connected-apps/connected-apps.service.js';
import { codeAt } from './totp.js';

const EMAIL = 'person@example.com';

// Second factors against the real database (docs/adr/0012): every account
// signs in with a code after its password, sets one up the first time, and
// steps up before a sensitive action; Audit Hub records each step.
describe('second factors (integration)', () => {
  let t: TestApp;

  // A fresh app per test: the rate limiter's counters start empty.
  beforeEach(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma);
  });

  afterEach(async () => {
    await t.app.close();
  });

  const challengeFor = async (email = EMAIL) => {
    const res = await request(t.server)
      .post('/api/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return envelopeOf<{ mfa: string; challengeToken: string }>(res).data;
  };
  const verify = (challengeToken: string, body: Record<string, string>) =>
    request(t.server)
      .post('/api/auth/mfa/verify')
      .send({ challengeToken, ...body });
  const hubActions = async () =>
    (
      await t.prisma.auditEvent.findMany({
        where: { appId: SYSTEM_APP_ID },
        orderBy: { recordedAt: 'asc' },
        select: { action: true },
      })
    ).map((row) => row.action);

  it('sets up a second factor at the first sign-in, then asks for it every time', async () => {
    await seedUser(t.prisma, { email: EMAIL, role: 'admin', mfa: false });
    const first = await challengeFor();
    expect(first.mfa).toBe('enroll');
    // The set-up's challenge does not sign in with a code, nor the other way round.
    await verify(first.challengeToken, { code: '123456' }).expect(401);

    const enrolled = await completeEnrollment(t.server, first.challengeToken);
    expect(enrolled.recoveryCodes).toHaveLength(10);
    expect(enrolled.recoveryCodes[0]).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
    // Only HMACs are stored.
    const stored = await t.prisma.mfaRecoveryCode.findMany();
    expect(JSON.stringify(stored)).not.toContain(enrolled.recoveryCodes[0]?.replace('-', ''));
    const factor = await t.prisma.mfaFactor.findFirstOrThrow();
    expect(Buffer.from(factor.secret).toString('base64')).not.toContain(enrolled.secret);

    const next = await challengeFor();
    expect(next.mfa).toBe('verify');
    await forgetUsedCode(EMAIL);
    const code = codeAt(Buffer.from(Secret.fromBase32(enrolled.secret).bytes));
    await verify(next.challengeToken, { code }).expect(200);
    expect(await hubActions()).toEqual([
      'hub.mfa.enrolled',
      'hub.session.signed_in',
      'hub.session.signed_in',
    ]);
  });

  it('takes a code once, and ends the step after five wrong ones', async () => {
    await seedUser(t.prisma, { email: EMAIL, role: 'admin' });
    await forgetUsedCode(EMAIL);
    const code = totpCode();
    await verify((await challengeFor()).challengeToken, { code }).expect(200);
    // The same code again, in the same 30 s: refused (replay).
    const again = await challengeFor();
    await verify(again.challengeToken, { code }).expect(401);

    const challenge = await challengeFor();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await verify(challenge.challengeToken, { code: '000000' }).expect(401);
    }
    await forgetUsedCode(EMAIL);
    // The fifth wrong one ends it: the right code no longer helps.
    await verify(challenge.challengeToken, { code: '000000' }).expect(401);
    await verify(challenge.challengeToken, { code: totpCode() }).expect(401);
    const failures = (await hubActions()).filter(
      (action) => action === 'hub.session.sign_in_failed',
    );
    expect(failures).toHaveLength(6);
  });

  it('signs in once with each recovery code', async () => {
    await seedUser(t.prisma, { email: EMAIL, role: 'admin', mfa: false });
    const enrolled = await completeEnrollment(t.server, (await challengeFor()).challengeToken);
    const [recovery = ''] = enrolled.recoveryCodes;
    const typed = recovery.toUpperCase().replace('-', ' ');
    await verify((await challengeFor()).challengeToken, { recoveryCode: typed }).expect(200);
    await verify((await challengeFor()).challengeToken, { recoveryCode: recovery }).expect(401);
    await expect(
      t.prisma.mfaRecoveryCode.count({ where: { usedAt: { not: null } } }),
    ).resolves.toBe(1);
    expect(await hubActions()).toContain('hub.mfa.recovery_code_used');
  });

  it('steps up with the password and a code, for sensitive actions only', async () => {
    const person = await seedUser(t.prisma, { email: EMAIL, role: 'admin' });
    const session = await signIn(t.server, EMAIL);
    const codes = () =>
      request(t.server).post('/api/account/mfa/recovery-codes').set(bearer(session.accessToken));
    const refused = await codes().expect(403);
    expect(refused.headers['audit-error']).toBe('reauthentication_required');

    await forgetUsedCode(EMAIL);
    await request(t.server)
      .post('/api/account/step-up')
      .set(bearer(session.accessToken))
      .send({ password: 'wrong-password', code: totpCode() })
      .expect(403);
    await forgetUsedCode(EMAIL);
    const stepped = await request(t.server)
      .post('/api/account/step-up')
      .set(bearer(session.accessToken))
      .send({ password: TEST_PASSWORD, code: totpCode() })
      .expect(200);
    const token = envelopeOf<{ accessToken: string }>(stepped).data.accessToken;
    const fresh = await request(t.server)
      .post('/api/account/mfa/recovery-codes')
      .set(bearer(token))
      .expect(200);
    expect(envelopeOf<{ recoveryCodes: string[] }>(fresh).data.recoveryCodes).toHaveLength(10);
    const status = await request(t.server).get('/api/account/mfa').set(bearer(token)).expect(200);
    expect(envelopeOf(status).data).toMatchObject({ recoveryCodesLeft: 10 });
    expect(person.id).toBeDefined();
    expect(await hubActions()).toEqual(
      expect.arrayContaining(['hub.session.stepped_up', 'hub.mfa.recovery_codes_regenerated']),
    );
  });

  it("lets an administrator reset someone's factor after a step-up, ending their sessions", async () => {
    const admin = await seedUser(t.prisma, { email: 'admin@example.com', role: 'admin' });
    const person = await seedUser(t.prisma, { email: EMAIL, role: 'admin' });
    const session = await signIn(t.server, EMAIL);
    const reset = (recent: boolean) =>
      request(t.server)
        .post(`/api/users/${person.id}/mfa-reset`)
        .set(asUser(t.app, admin.id, 'admin', 0, { recent }))
        .send({ reason: 'Lost the phone and the codes' });
    await reset(false).expect(403);
    await reset(true).expect(204);
    await request(t.server)
      .post('/api/auth/refresh')
      .set('Cookie', session.refreshCookie)
      .expect(401);
    expect((await challengeFor()).mfa).toBe('enroll');
    await request(t.server)
      .post(`/api/users/${admin.id}/mfa-reset`)
      .set(asUser(t.app, admin.id, 'admin', 0, { recent: true }))
      .send({ reason: 'Lost the phone and the codes' })
      .expect(403);
    expect(await hubActions()).toContain('hub.mfa.reset');
  });

  it('refuses an old session that started without a second factor', async () => {
    const person = await seedUser(t.prisma, { email: EMAIL, role: 'admin' });
    const session = await signIn(t.server, EMAIL);
    await t.prisma.session.updateMany({
      where: { userId: person.id },
      data: { mfaVerifiedAt: null },
    });
    await request(t.server)
      .post('/api/auth/refresh')
      .set('Cookie', session.refreshCookie)
      .expect(401);
  });
});
