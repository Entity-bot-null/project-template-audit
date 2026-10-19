import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Secret } from 'otpauth';
import request from 'supertest';
import pg from 'pg';
import { codeAt } from '../src/auth/mfa/totp.js';
import { hashPassword } from '../src/auth/password.js';
import { secretBoxFromConfig } from '../src/common/crypto/secret-box.js';
import { env } from '../src/env/env.js';
import { seedTotpBytes } from '../src/seed/seed.js';
import { testDatabaseUrl } from './db-url.js';
import type { Role } from '../src/common/types/request-user.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { envelopeOf } from './http.js';

export const TEST_PASSWORD = 'correct-horse-battery';

/**
 * Creates a user with a real argon2 hash and, as every Audit Hub account
 * needs one (docs/adr/0012), a second factor with the seed's public TOTP
 * secret; the role defaults to member, who cannot sign in to the panel
 * (auth/panel-access.ts): an admin, or an auditor or a viewer with an
 * application, signs in. `mfa: false` leaves the factor to be set up.
 */
export async function seedUser(
  prisma: PrismaService,
  data: { email: string; name?: string; role?: Role; mfa?: boolean },
) {
  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email.split('@')[0] ?? data.email,
      role: data.role ?? 'member',
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  if (data.mfa !== false) {
    const sealed = testSecretBox().seal(seedTotpBytes(), `mfa_factors:${user.id}`);
    await prisma.mfaFactor.create({
      data: {
        userId: user.id,
        secret: sealed.ciphertext,
        encKeyId: sealed.keyId,
        confirmedAt: new Date(),
      },
    });
  }
  return user;
}

/** The SecretBox the app under test uses (the same environment). */
function testSecretBox() {
  return secretBoxFromConfig({
    secret: env.AUDIT_SECRETS_KEY,
    previous: env.AUDIT_SECRETS_KEY_PREVIOUS,
    fallback: env.JWT_ACCESS_SECRET,
  }).box;
}

/** A code of the seed's TOTP secret, now. */
export const totpCode = (now: number = Date.now()) => codeAt(seedTotpBytes(), now);

/**
 * Forgets the last code an account used: a code works once per 30 s step, and
 * a suite signs the same account in several times within one.
 */
export async function forgetUsedCode(email: string): Promise<void> {
  const db = new pg.Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await db.query(
      'UPDATE "mfa_factors" SET "last_used_step" = NULL WHERE "user_id" = (SELECT "id" FROM "users" WHERE "email" = $1)',
      [email.trim().toLowerCase()],
    );
  } finally {
    await db.end();
  }
}

export interface SignedIn {
  accessToken: string;
  /** The Set-Cookie headers of the response. */
  setCookies: string[];
  /** `refresh_token=<value>`, ready for a Cookie header. */
  refreshCookie: string;
}

/**
 * Signs in through the API, the password then a code (docs/adr/0012), and
 * returns what a browser would hold.
 */
export async function signIn(
  server: Server,
  email: string,
  password = TEST_PASSWORD,
  /** Base32, for an account that set up its own factor (completeEnrollment): the seed's otherwise. */
  totpSecret?: string,
): Promise<SignedIn> {
  const challenge = await request(server)
    .post('/api/auth/sign-in')
    .send({ email, password })
    .expect(200);
  const { challengeToken, mfa } = envelopeOf<{ challengeToken: string; mfa: string }>(
    challenge,
  ).data;
  if (mfa !== 'verify') throw new Error(`sign-in asked for ${mfa}: seed the user with a factor`);
  await forgetUsedCode(email);
  const res = await request(server)
    .post('/api/auth/mfa/verify')
    .send({
      challengeToken,
      code:
        totpSecret === undefined
          ? totpCode()
          : codeAt(Buffer.from(Secret.fromBase32(totpSecret).bytes)),
    })
    .expect(200);
  const setCookies = cookiesOf(res);
  const refresh = setCookies.find((cookie) => cookie.startsWith('refresh_token='));
  if (refresh === undefined) throw new Error('sign-in set no refresh cookie');
  return {
    accessToken: envelopeOf<{ accessToken: string }>(res).data.accessToken,
    setCookies,
    refreshCookie: refresh.split(';', 1)[0] ?? refresh,
  };
}

export function cookiesOf(res: request.Response): string[] {
  const header: unknown = res.headers['set-cookie'];
  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }
  return typeof header === 'string' ? [header] : [];
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * A bearer header minted with the app's own signer, for a user the suite
 * created (seedUser): the guard checks the token's securityVersion (sv)
 * against the account's, 0 for a new one. Every token passed a second factor
 * (docs/adr/0012); `recent` adds a step-up of now (RequireRecentAuth).
 */
export function asUser(
  app: INestApplication,
  id: string,
  role: Role = 'member',
  sv = 0,
  options: { recent?: boolean } = {},
) {
  return bearer(
    app.get(JwtService).sign({
      sub: id,
      role,
      sv,
      mfa: true,
      amr: ['pwd', 'otp'],
      ...(options.recent === true ? { ra: Math.floor(Date.now() / 1000) } : {}),
    }),
  );
}

/**
 * Starts setting up the second factor of a challenge with mfa: enroll, and
 * answers the new secret and a code of it, for the confirmation.
 */
export async function startEnrollment(server: Server, challengeToken: string) {
  const started = await request(server)
    .post('/api/auth/mfa/enroll')
    .send({ challengeToken })
    .expect(200);
  const { secret } = envelopeOf<{ secret: string }>(started).data;
  return { secret, code: codeAt(Buffer.from(Secret.fromBase32(secret).bytes)) };
}

/**
 * Sets up the second factor of a challenge with mfa: enroll (a sign-up, an
 * invitation, an account without one), as the web app does, and returns the
 * session and the recovery codes.
 */
export async function completeEnrollment(server: Server, challengeToken: string, cookie?: string) {
  const { secret, code } = await startEnrollment(server, challengeToken);
  const confirm = request(server).post('/api/auth/mfa/enroll/confirm');
  if (cookie !== undefined) confirm.set('Cookie', cookie);
  const res = await confirm.send({ challengeToken, code }).expect(200);
  return {
    res,
    secret,
    accessToken: envelopeOf<{ accessToken: string }>(res).data.accessToken,
    recoveryCodes: envelopeOf<{ recoveryCodes: string[] }>(res).data.recoveryCodes,
    setCookies: cookiesOf(res),
  };
}
