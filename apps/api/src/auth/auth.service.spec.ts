import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HubAuditService } from '../hub-audit/hub-audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_TOKEN_TTL_SEC } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { MfaChallengesService } from './mfa/mfa-challenges.service.js';
import { NO_PANEL_ACCESS } from './panel-access.js';
import { dummyPasswordHash, hashPassword } from './password.js';
import type { SessionsService } from './sessions.service.js';

const USER = {
  id: '0190b6a1-0000-7000-8000-000000000001',
  email: 'user@example.com',
  name: 'User',
  role: 'viewer' as 'admin' | 'auditor' | 'viewer' | 'member',
};
const REFRESH = {
  token: 'refresh-token',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  securityVersion: 3,
};
const jwt = new JwtService({ secret: 'spec-only-secret-not-for-real-use-'.padEnd(64, '0') });

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('right password');
});

type Found = typeof USER & {
  passwordHash: string;
  /** The applications it sees: one unless said otherwise. */
  _count?: { appAssignments: number };
  securityVersion?: number;
  disabledAt?: Date | null;
  mfaFactor?: { confirmedAt: Date | null } | null;
};

function setup(found: Found | null) {
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      found === null
        ? null
        : { securityVersion: 3, disabledAt: null, _count: { appAssignments: 1 }, ...found },
    );
  const sessions = {
    create: vi.fn().mockResolvedValue(REFRESH),
    rotate: vi.fn().mockResolvedValue({ user: USER, securityVersion: 5, session: REFRESH }),
    retire: vi.fn().mockResolvedValue(undefined),
  };
  const challenges = {
    create: vi.fn((user: { id: string }, mfa: string) =>
      Promise.resolve({ mfa, challengeToken: `challenge-of-${user.id}`, expiresIn: 300 }),
    ),
  };
  const hubAudit = { recordQuietly: vi.fn((..._args: unknown[]) => Promise.resolve()) };
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const service = new AuthService(
    prisma,
    jwt,
    sessions as unknown as SessionsService,
    challenges as unknown as MfaChallengesService,
    hubAudit as unknown as HubAuditService,
  );
  return { service, findUnique, sessions, challenges, hubAudit };
}

describe('AuthService at boot', () => {
  it('builds the timing dummy hash, so the first unknown-email sign-in pays no extra hash', async () => {
    const { service } = setup(null);
    await service.onModuleInit();
    const started = performance.now();
    await dummyPasswordHash();
    expect(performance.now() - started).toBeLessThan(5);
  });
});

describe('AuthService', () => {
  it('answers the second factor step, never a session, for the right password', async () => {
    const { service, sessions, challenges } = setup({
      ...USER,
      passwordHash,
      mfaFactor: { confirmedAt: new Date() },
    });
    await expect(service.signIn(USER.email, 'right password')).resolves.toEqual({
      mfa: 'verify',
      challengeToken: `challenge-of-${USER.id}`,
      expiresIn: 300,
    });
    // Bound to the account's securityVersion: a new password voids it.
    expect(challenges.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER.id, securityVersion: 3 }),
      'verify',
    );
    expect(sessions.create).not.toHaveBeenCalled();
    expect(sessions.retire).not.toHaveBeenCalled();
  });

  it('asks an account without a confirmed second factor to set one up', async () => {
    for (const mfaFactor of [null, { confirmedAt: null }]) {
      const { service } = setup({ ...USER, passwordHash, mfaFactor });
      await expect(service.signIn(USER.email, 'right password')).resolves.toMatchObject({
        mfa: 'enroll',
      });
    }
  });

  it('mints access tokens that say a second factor was passed, and how', async () => {
    const { service } = setup(null);
    const session = await service.sessionFor(USER, 3, ['pwd', 'otp']);
    expect(session).toMatchObject({ expiresIn: ACCESS_TOKEN_TTL_SEC, user: USER });
    const claims = await jwt.verifyAsync<Record<string, unknown>>(session.accessToken);
    expect(claims).toMatchObject({
      sub: USER.id,
      role: 'viewer',
      sv: 3,
      mfa: true,
      amr: ['pwd', 'otp'],
    });
    expect(claims).not.toHaveProperty('ra');
    const stepped = await service.sessionFor(USER, 3, ['pwd', 'otp'], 1_760_000_000);
    await expect(jwt.verifyAsync(stepped.accessToken)).resolves.toMatchObject({
      ra: 1_760_000_000,
    });
  });

  it('looks the email up trimmed and lowercased', async () => {
    const { service, findUnique } = setup({ ...USER, passwordHash });
    await service.signIn('  User@Example.COM ', 'right password');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'user@example.com' } }),
    );
  });

  it('gives one answer for a wrong password and an unknown email', async () => {
    const wrong = setup({ ...USER, passwordHash }).service.signIn(USER.email, 'wrong');
    const unknown = setup(null).service.signIn('nobody@example.com', 'whatever');
    // Both handlers attached at once: either may reject first.
    await Promise.all([
      expect(wrong).rejects.toThrow(new UnauthorizedException('Invalid email or password')),
      expect(unknown).rejects.toThrow(new UnauthorizedException('Invalid email or password')),
    ]);
  });

  it('touches no session when the credentials are wrong, and records the failure', async () => {
    const { service, sessions, challenges, hubAudit } = setup({ ...USER, passwordHash });
    await expect(service.signIn(USER.email, 'wrong')).rejects.toThrow(UnauthorizedException);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(challenges.create).not.toHaveBeenCalled();
    expect(hubAudit.recordQuietly).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hub.session.sign_in_failed',
        resource: { type: 'user', id: USER.id },
        details: { stage: 'password' },
      }),
    );
    // An unknown address names no account.
    const unknown = setup(null);
    await expect(unknown.service.signIn('nobody@example.com', 'x')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(unknown.hubAudit.recordQuietly.mock.calls[0]?.[0]).not.toHaveProperty('resource');
  });

  it('refuses a disabled account as a wrong password, and records that the password was right', async () => {
    const disabledAt = new Date('2026-10-17T12:00:00.000Z');
    const { service, challenges, hubAudit } = setup({ ...USER, passwordHash, disabledAt });
    await expect(service.signIn(USER.email, 'right password')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
    expect(challenges.create).not.toHaveBeenCalled();
    expect(hubAudit.recordQuietly).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hub.session.sign_in_failed',
        resource: { type: 'user', id: USER.id },
        details: { stage: 'password', accountDisabled: true },
      }),
    );
    // A wrong password for it is just a wrong password.
    const wrong = setup({ ...USER, passwordHash, disabledAt });
    await expect(wrong.service.signIn(USER.email, 'wrong')).rejects.toThrow(UnauthorizedException);
    expect(wrong.hubAudit.recordQuietly).toHaveBeenCalledWith(
      expect.objectContaining({ details: { stage: 'password' } }),
    );
  });

  it.each([
    ['a member', 'member', 1],
    ['an auditor without an application', 'auditor', 0],
    ['a viewer without an application', 'viewer', 0],
  ] as const)(
    'tells %s with the right password that the panel is not theirs, before any second factor',
    async (_case, role, apps) => {
      const { service, challenges, hubAudit } = setup({
        ...USER,
        role,
        passwordHash,
        mfaFactor: { confirmedAt: new Date() },
        _count: { appAssignments: apps },
      });
      await expect(service.signIn(USER.email, 'right password')).rejects.toThrow(
        new ForbiddenException(NO_PANEL_ACCESS),
      );
      expect(challenges.create).not.toHaveBeenCalled();
      expect(hubAudit.recordQuietly).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hub.session.sign_in_failed',
          outcome: 'denied',
          resource: { type: 'user', id: USER.id },
          details: { stage: 'password', noPanelAccess: true },
        }),
      );
      // A wrong password tells nothing about the account: a wrong password.
      const wrong = setup({ ...USER, role, passwordHash, _count: { appAssignments: apps } });
      await expect(wrong.service.signIn(USER.email, 'wrong')).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    },
  );

  it('lets an administrator in without any application assigned', async () => {
    const { service } = setup({
      ...USER,
      role: 'admin',
      passwordHash,
      mfaFactor: { confirmedAt: new Date() },
      _count: { appAssignments: 0 },
    });
    await expect(service.signIn(USER.email, 'right password')).resolves.toMatchObject({
      mfa: 'verify',
    });
  });

  it('refreshes by rotating the session and minting a new access token', async () => {
    const { service, sessions } = setup(null);
    const result = await service.refresh('old-token');
    expect(sessions.rotate).toHaveBeenCalledWith('old-token');
    expect(result.refresh).toBe(REFRESH);
    // Carried on from the session family: it passed a second factor.
    await expect(jwt.verifyAsync(result.session.accessToken)).resolves.toMatchObject({
      sub: USER.id,
      sv: 5,
      mfa: true,
      amr: ['mfa'],
    });
  });

  it('logs out by retiring the session family', async () => {
    const { service, sessions } = setup(null);
    await service.logout('a-token');
    expect(sessions.retire).toHaveBeenCalledWith('a-token', 'logout');
  });
});
