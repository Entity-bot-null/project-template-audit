import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Secret } from 'otpauth';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSecretKey, SecretBox } from '../../common/crypto/secret-box.js';
import type { RequestUser } from '../../common/types/request-user.js';
import type { HubAuditService } from '../../hub-audit/hub-audit.service.js';
import type { MailOutboxService } from '../../infrastructure/mail/mail-outbox.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthService } from '../auth.service.js';
import { NO_PANEL_ACCESS } from '../panel-access.js';
import { hashPassword } from '../password.js';
import type { SessionsService } from '../sessions.service.js';
import type { ChallengePurpose, MfaChallengesService } from './mfa-challenges.service.js';
import { MfaService } from './mfa.service.js';
import { codeAt, recoveryCodeHash, TOTP_PERIOD_SEC } from './totp.js';

const USER = {
  id: '0190b6a1-0000-7000-8000-000000000001',
  email: 'ada@example.test',
  name: 'Ada',
  role: 'viewer' as const,
};
const CALLER: RequestUser = { id: USER.id, role: 'viewer' };
const ADMIN: RequestUser = { id: '0190b6a1-0000-7000-8000-000000000002', role: 'admin' };
const CHALLENGE = { id: '0190b6a1-0000-7000-8000-0000000000c1', userId: USER.id };
const REFRESH = {
  token: 'refresh-token',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  securityVersion: 4,
};

// A fixed clock: the codes, and the step they belong to, are known.
const NOW = new Date('2026-10-15T12:00:10.000Z').getTime();
const STEP = BigInt(Math.floor(NOW / 1000 / TOTP_PERIOD_SEC));
const CONFIRMED_AT = new Date('2026-09-01T08:00:00.000Z');

const SECRET = Buffer.from('0123456789abcdefghij');
const box = new SecretBox([deriveSecretKey('spec-only-secrets-key-'.padEnd(64, '0'), 'spec')]);
const SEALED = box.seal(SECRET, `mfa_factors:${USER.id}`);
const PEPPER = Buffer.alloc(32, 1);
const PREVIOUS_PEPPER = Buffer.alloc(32, 2);
const request = { ip: '203.0.113.7' } as unknown as Request;

/** The code of the secret `offset` time steps from now. */
const codeOf = (offset = 0) => codeAt(SECRET, NOW + offset * TOTP_PERIOD_SEC * 1000);
const WRONG_CODE = '000000';

interface FactorRow {
  userId: string;
  secret: Uint8Array;
  encKeyId: string;
  confirmedAt: Date | null;
  lastUsedStep: bigint | null;
}

interface CodeRow {
  userId: string;
  codeHash: string;
  usedAt: Date | null;
}

const factorWith = (overrides: Partial<FactorRow> = {}): FactorRow => ({
  userId: USER.id,
  secret: SEALED.ciphertext,
  encKeyId: SEALED.keyId,
  confirmedAt: CONFIRMED_AT,
  lastUsedStep: null,
  ...overrides,
});

const storedCode = (code: string, pepper = PEPPER): CodeRow => ({
  userId: USER.id,
  codeHash: recoveryCodeHash(pepper, code.replace('-', '')),
  usedAt: null,
});

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('right password');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

interface Options {
  user?: boolean;
  /** When an administrator removed the account; null: never. */
  removedAt?: Date | null;
  factor?: FactorRow | null;
  codes?: CodeRow[];
  mailEnabled?: boolean;
  peppers?: Buffer[];
  consumed?: boolean;
  /** The applications the account sees (auth/panel-access.ts): one by default. */
  apps?: number;
}

// An in-memory stand-in for the account, its factor and its recovery codes,
// enough for the rules (a code works once, a recovery code once). The real
// queries, locks and races run against PostgreSQL in mfa.int.spec.ts.
function setup({
  user = true,
  removedAt = null,
  factor = factorWith(),
  codes = [],
  mailEnabled = true,
  peppers = [PEPPER],
  consumed = true,
  apps = 1,
}: Options = {}) {
  const state = {
    user: user
      ? {
          ...USER,
          passwordHash,
          securityVersion: 4,
          removedAt,
          _count: { appAssignments: apps },
        }
      : null,
    factor: factor === null ? null : { ...factor },
    codes: codes.map((code) => ({ ...code })),
  };
  // The user row as a `select` asks for it, its factor included.
  const userRow = (fields: Record<string, unknown>) => {
    if (state.user === null) return null;
    const row: Record<string, unknown> = { ...state.user, mfaFactor: state.factor };
    return Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));
  };
  const userTable = {
    findUnique: vi.fn(({ select }: { select: Record<string, unknown> }) =>
      Promise.resolve(userRow(select)),
    ),
    findUniqueOrThrow: vi.fn(({ select }: { select: Record<string, unknown> }) => {
      const row = userRow(select);
      return row === null ? Promise.reject(new Error('No User found')) : Promise.resolve(row);
    }),
    update: vi.fn(() => {
      if (state.user !== null) state.user.securityVersion += 1;
      return Promise.resolve(state.user);
    }),
  };
  const mfaFactor = {
    findUnique: vi.fn(({ where }: { where: { userId: string } }) =>
      Promise.resolve(state.factor?.userId === where.userId ? { ...state.factor } : null),
    ),
    upsert: vi.fn(
      ({
        create,
        update,
      }: {
        create: Pick<FactorRow, 'userId' | 'secret' | 'encKeyId'>;
        update: Partial<FactorRow>;
      }) => {
        state.factor =
          state.factor === null
            ? { ...create, confirmedAt: null, lastUsedStep: null }
            : { ...state.factor, ...update };
        return Promise.resolve(state.factor);
      },
    ),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: Partial<FactorRow> & { userId: string };
        data: Partial<FactorRow>;
      }) => {
        const row = state.factor;
        const hit =
          row !== null &&
          row.userId === where.userId &&
          (!('lastUsedStep' in where) || row.lastUsedStep === where.lastUsedStep) &&
          (!('confirmedAt' in where) || row.confirmedAt === where.confirmedAt) &&
          (where.secret === undefined || Buffer.from(row.secret).equals(where.secret));
        if (hit) Object.assign(row, data);
        return Promise.resolve({ count: hit ? 1 : 0 });
      },
    ),
    deleteMany: vi.fn(() => {
      const count = state.factor === null ? 0 : 1;
      state.factor = null;
      return Promise.resolve({ count });
    }),
  };
  const mfaRecoveryCode = {
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { userId: string; codeHash: { in: string[] } };
        data: { usedAt: Date };
      }) => {
        const hit = state.codes.filter(
          (row) =>
            row.userId === where.userId &&
            row.usedAt === null &&
            where.codeHash.in.includes(row.codeHash),
        );
        for (const row of hit) Object.assign(row, data);
        return Promise.resolve({ count: hit.length });
      },
    ),
    count: vi.fn(({ where }: { where: { userId: string } }) =>
      Promise.resolve(
        state.codes.filter((row) => row.userId === where.userId && row.usedAt === null).length,
      ),
    ),
    deleteMany: vi.fn(({ where }: { where: { userId: string } }) => {
      const before = state.codes.length;
      state.codes = state.codes.filter((row) => row.userId !== where.userId);
      return Promise.resolve({ count: before - state.codes.length });
    }),
    createMany: vi.fn(({ data }: { data: Omit<CodeRow, 'usedAt'>[] }) => {
      state.codes.push(...data.map((row) => ({ ...row, usedAt: null })));
      return Promise.resolve({ count: data.length });
    }),
  };
  const session = { updateMany: vi.fn(() => Promise.resolve({ count: 2 })) };
  // The user row lock (SELECT ... FOR UPDATE).
  const $queryRaw = vi.fn(() => Promise.resolve([]));
  const tx = { user: userTable, mfaFactor, mfaRecoveryCode, session, $queryRaw };
  const prisma = {
    ...tx,
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };

  const challenges = {
    take: vi.fn((_token: string, purposes: readonly ChallengePurpose[]) =>
      Promise.resolve({ ...CHALLENGE, purpose: purposes[0] }),
    ),
    failed: vi.fn(() => Promise.resolve()),
    consume: vi.fn(() => Promise.resolve(consumed)),
  };
  const sessions = {
    retire: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve(REFRESH)),
  };
  const auth = {
    sessionFor: vi.fn((authUser: typeof USER, _securityVersion: number, amr: string[]) =>
      Promise.resolve({ accessToken: `access-${amr.join('+')}`, expiresIn: 900, user: authUser }),
    ),
  };
  const mail = {
    enabled: mailEnabled,
    enqueue: vi.fn((..._args: unknown[]) => Promise.resolve('queued')),
    notifyQueued: vi.fn(),
  };
  const hubAudit = { recordQuietly: vi.fn((..._args: unknown[]) => Promise.resolve()) };
  const service = new MfaService(
    prisma as unknown as PrismaService,
    challenges as unknown as MfaChallengesService,
    sessions as unknown as SessionsService,
    auth as unknown as AuthService,
    box,
    mail as unknown as MailOutboxService,
    hubAudit as unknown as HubAuditService,
    peppers,
  );
  return { service, state, prisma, tx, challenges, sessions, auth, mail, hubAudit };
}

type Setup = ReturnType<typeof setup>;

/** The Audit Hub events recorded, in order. */
const actionsOf = ({ hubAudit }: Setup) =>
  hubAudit.recordQuietly.mock.calls.map(([input]) => (input as { action: string }).action);

const expectRefused = ({ challenges, hubAudit, sessions }: Setup) => {
  // The wrong code spends one of the challenge's attempts.
  expect(challenges.failed).toHaveBeenCalledWith({ ...CHALLENGE, purpose: 'verify' });
  expect(hubAudit.recordQuietly).toHaveBeenCalledWith({
    action: 'hub.session.sign_in_failed',
    outcome: 'failure',
    actor: { type: 'anonymous' },
    resource: { type: 'user', id: USER.id },
    details: { stage: 'second_factor' },
    request,
  });
  expect(sessions.create).not.toHaveBeenCalled();
};

const expectMailed = ({ mail, tx }: Setup, change: string) => {
  expect(mail.enqueue).toHaveBeenCalledWith(tx, {
    kind: 'mfa_changed',
    to: USER.email,
    userId: USER.id,
    payload: { change, at: new Date(NOW).toISOString() },
  });
  expect(mail.notifyQueued).toHaveBeenCalledOnce();
};

describe('MfaService.verify', () => {
  it('signs in with a right code, and records its step so it works once', async () => {
    const ctx = setup();
    const result = await ctx.service.verify('challenge', { code: codeOf() }, request, 'old');

    expect(ctx.challenges.take).toHaveBeenCalledWith('challenge', ['verify']);
    expect(ctx.state.factor?.lastUsedStep).toBe(STEP);
    expect(ctx.challenges.consume).toHaveBeenCalledWith({ ...CHALLENGE, purpose: 'verify' });
    expect(ctx.challenges.failed).not.toHaveBeenCalled();
    // The session the sign-in replaces ends; the new one is bound to the password checked.
    expect(ctx.sessions.retire).toHaveBeenCalledWith('old', 'sign-in');
    expect(ctx.sessions.create).toHaveBeenCalledWith(USER.id, passwordHash, expect.any(Date));
    expect(ctx.auth.sessionFor).toHaveBeenCalledWith(USER, REFRESH.securityVersion, ['pwd', 'otp']);
    expect(result).toEqual({
      session: { accessToken: 'access-pwd+otp', expiresIn: 900, user: USER },
      refresh: REFRESH,
    });
    expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith({
      action: 'hub.session.signed_in',
      actor: { type: 'user', id: USER.id, role: 'viewer' },
      details: { method: 'totp' },
      request,
    });
    expect(actionsOf(ctx)).toEqual(['hub.session.signed_in']);
    // An ordinary sign-in sends no email.
    expect(ctx.mail.enqueue).not.toHaveBeenCalled();
  });

  it('takes a code once: the same code, or an older one, is refused after it', async () => {
    const ctx = setup();
    await ctx.service.verify('challenge', { code: codeOf() }, request);
    expect(ctx.sessions.retire).not.toHaveBeenCalled();
    ctx.sessions.create.mockClear();

    for (const code of [codeOf(), codeOf(-1)]) {
      await expect(ctx.service.verify('challenge', { code }, request)).rejects.toThrow(
        new UnauthorizedException('The code is wrong or was already used'),
      );
    }
    expectRefused(ctx);
    expect(ctx.challenges.failed).toHaveBeenCalledTimes(2);
    expect(ctx.state.factor?.lastUsedStep).toBe(STEP);

    // The next step's code is new: it works.
    await ctx.service.verify('challenge', { code: codeOf(1) }, request);
    expect(ctx.state.factor?.lastUsedStep).toBe(STEP + 1n);
  });

  it('refuses a wrong code, spends an attempt and records the failure', async () => {
    expect([codeOf(-1), codeOf(), codeOf(1)]).not.toContain(WRONG_CODE);
    const ctx = setup();
    await expect(ctx.service.verify('challenge', { code: WRONG_CODE }, request)).rejects.toThrow(
      UnauthorizedException,
    );
    expectRefused(ctx);
    expect(ctx.state.factor?.lastUsedStep).toBeNull();
    expect(actionsOf(ctx)).toEqual(['hub.session.sign_in_failed']);
  });

  it('refuses a right code another request used first (a race on the step)', async () => {
    const ctx = setup();
    ctx.prisma.mfaFactor.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.service.verify('challenge', { code: codeOf() }, request)).rejects.toThrow(
      'The code is wrong or was already used',
    );
    expect(ctx.prisma.mfaFactor.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, lastUsedStep: null },
      data: { lastUsedStep: STEP },
    });
    expectRefused(ctx);
  });

  it('asks to sign in again when the account has no confirmed second factor', async () => {
    for (const factor of [null, factorWith({ confirmedAt: null })]) {
      const ctx = setup({ factor });
      await expect(ctx.service.verify('challenge', { code: codeOf() }, request)).rejects.toThrow(
        new UnauthorizedException('Sign in again'),
      );
      expect(ctx.challenges.failed).not.toHaveBeenCalled();
      expect(ctx.sessions.create).not.toHaveBeenCalled();
    }
  });

  it('asks to sign in again when another request spent the challenge first', async () => {
    const ctx = setup({ consumed: false });
    await expect(ctx.service.verify('challenge', { code: codeOf() }, request)).rejects.toThrow(
      new UnauthorizedException('Sign in again'),
    );
    expect(ctx.sessions.create).not.toHaveBeenCalled();
    expect(ctx.hubAudit.recordQuietly).not.toHaveBeenCalled();
  });

  it('signs in once with a recovery code, as typed, and tells the person by email', async () => {
    const ctx = setup({ codes: [storedCode('abcde-fghjk'), storedCode('mnpqr-stvwx')] });
    const result = await ctx.service.verify(
      'challenge',
      { recoveryCode: ' ABCDE FGHJK ' },
      request,
    );

    expect(ctx.auth.sessionFor).toHaveBeenCalledWith(USER, REFRESH.securityVersion, ['pwd', 'rcv']);
    expect(result.session.accessToken).toBe('access-pwd+rcv');
    expect(ctx.state.codes.map((row) => row.usedAt)).toEqual([new Date(NOW), null]);
    // The step of a code is untouched: a recovery code is not a code.
    expect(ctx.state.factor?.lastUsedStep).toBeNull();
    expectMailed(ctx, 'recovery_code_used');
    expect(actionsOf(ctx)).toEqual(['hub.mfa.recovery_code_used', 'hub.session.signed_in']);
    expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith({
      action: 'hub.mfa.recovery_code_used',
      actor: { type: 'user', id: USER.id, role: 'viewer' },
      request,
    });
    expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hub.session.signed_in',
        details: { method: 'recovery_code' },
      }),
    );

    await expect(
      ctx.service.verify('challenge', { recoveryCode: 'abcde-fghjk' }, request),
    ).rejects.toThrow('The code is wrong or was already used');
    expect(ctx.challenges.failed).toHaveBeenCalledOnce();
  });

  it('spends no recovery code when another request spent the challenge first', async () => {
    const ctx = setup({ consumed: false, codes: [storedCode('abcde-fghjk')] });
    await expect(
      ctx.service.verify('challenge', { recoveryCode: 'abcde-fghjk' }, request),
    ).rejects.toThrow(new UnauthorizedException('Sign in again'));
    // The challenge and the code go together, in one transaction.
    expect(ctx.challenges.consume).toHaveBeenCalledWith(
      { ...CHALLENGE, purpose: 'verify' },
      ctx.tx,
    );
    expect(ctx.state.codes[0]?.usedAt).toBeNull();
    expect(ctx.sessions.create).not.toHaveBeenCalled();
  });

  it('checks a recovery code against the previous pepper too, during a key rotation', async () => {
    const ctx = setup({
      codes: [storedCode('abcde-fghjk', PREVIOUS_PEPPER)],
      peppers: [PEPPER, PREVIOUS_PEPPER],
    });
    await ctx.service.verify('challenge', { recoveryCode: 'abcde-fghjk' }, request);
    expect(ctx.prisma.mfaRecoveryCode.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER.id,
        codeHash: {
          in: [
            recoveryCodeHash(PEPPER, 'abcdefghjk'),
            recoveryCodeHash(PREVIOUS_PEPPER, 'abcdefghjk'),
          ],
        },
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) as Date },
    });
    expect(ctx.state.codes[0]?.usedAt).not.toBeNull();
  });

  it('refuses a malformed or missing recovery code without looking it up', async () => {
    const ctx = setup({ codes: [storedCode('abcde-fghjk')] });
    for (const input of [{ recoveryCode: 'not-a-code' }, {}]) {
      await expect(ctx.service.verify('challenge', input, request)).rejects.toThrow(
        UnauthorizedException,
      );
    }
    expect(ctx.prisma.mfaRecoveryCode.updateMany).not.toHaveBeenCalled();
    expect(ctx.challenges.failed).toHaveBeenCalledTimes(2);
    expectRefused(ctx);
    expect(ctx.mail.enqueue).not.toHaveBeenCalled();
  });

  it('refuses a recovery code that is not one of the account', async () => {
    const ctx = setup({ codes: [storedCode('abcde-fghjk')] });
    await expect(
      ctx.service.verify('challenge', { recoveryCode: 'mnpqr-stvwx' }, request),
    ).rejects.toThrow(UnauthorizedException);
    expectRefused(ctx);
    expect(ctx.state.codes[0]?.usedAt).toBeNull();
  });
});

describe('MfaService.startEnrollment', () => {
  it('makes a new secret, stores it sealed, and answers what an authenticator app needs', async () => {
    const ctx = setup({ factor: null });
    const enrollment = await ctx.service.startEnrollment('challenge');

    expect(ctx.challenges.take).toHaveBeenCalledWith('challenge', ['enroll']);
    const stored = ctx.state.factor;
    expect(stored).toMatchObject({
      userId: USER.id,
      encKeyId: box.currentKeyId,
      confirmedAt: null,
      lastUsedStep: null,
    });
    // Only the ciphertext is stored, bound to the account's row.
    const secret = box.open(stored?.secret ?? new Uint8Array(), `mfa_factors:${USER.id}`);
    expect(secret).toHaveLength(20);
    expect(Buffer.from(stored?.secret ?? []).includes(secret)).toBe(false);
    expect(Buffer.from(Secret.fromBase32(enrollment.secret).bytes)).toEqual(secret);
    expect(enrollment.uri).toContain('otpauth://totp/Audit%20Hub:ada%40example.test?');
    expect(enrollment.qr.length).toBeGreaterThan(20);
  });

  it('replaces a secret not confirmed yet, and forgets the step its codes used', async () => {
    const ctx = setup({ factor: factorWith({ confirmedAt: null, lastUsedStep: STEP }) });
    const enrollment = await ctx.service.startEnrollment('challenge');
    expect(ctx.state.factor?.lastUsedStep).toBeNull();
    const secret = box.open(ctx.state.factor?.secret ?? new Uint8Array(), `mfa_factors:${USER.id}`);
    expect(secret).not.toEqual(SECRET);
    expect(Buffer.from(Secret.fromBase32(enrollment.secret).bytes)).toEqual(secret);
  });

  it('refuses when a second factor is set up already', async () => {
    const ctx = setup();
    await expect(ctx.service.startEnrollment('challenge')).rejects.toThrow(
      new ConflictException('A second factor is set up already: sign in with it'),
    );
    expect(ctx.prisma.mfaFactor.upsert).not.toHaveBeenCalled();
    expect(ctx.state.factor?.secret).toEqual(SEALED.ciphertext);
  });
});

describe('MfaService.confirmEnrollment', () => {
  const pending = () => factorWith({ confirmedAt: null });

  it('confirms the factor with a code, stores only HMACs of new recovery codes, and signs in', async () => {
    const ctx = setup({ factor: pending(), codes: [storedCode('abcde-fghjk')] });
    const result = await ctx.service.confirmEnrollment('challenge', codeOf(), request, 'old');

    expect(ctx.challenges.take).toHaveBeenCalledWith('challenge', ['enroll']);
    expect(ctx.state.factor).toMatchObject({ confirmedAt: new Date(NOW), lastUsedStep: STEP });
    expect(result.recoveryCodes).toHaveLength(10);
    // The old codes are gone; the new ones are kept as HMACs of the current pepper.
    expect(ctx.state.codes.map((row) => row.codeHash)).toEqual(
      result.recoveryCodes.map((code) => recoveryCodeHash(PEPPER, code.replace('-', ''))),
    );
    expect(JSON.stringify(ctx.state.codes)).not.toContain(result.recoveryCodes[0]);
    expect(ctx.sessions.retire).toHaveBeenCalledWith('old', 'sign-in');
    expect(ctx.auth.sessionFor).toHaveBeenCalledWith(USER, REFRESH.securityVersion, ['pwd', 'otp']);
    expect(result).toMatchObject({ session: { accessToken: 'access-pwd+otp' }, refresh: REFRESH });
    expectMailed(ctx, 'enrolled');
    expect(actionsOf(ctx)).toEqual(['hub.mfa.enrolled', 'hub.session.signed_in']);
    expect(ctx.hubAudit.recordQuietly).toHaveBeenLastCalledWith({
      action: 'hub.session.signed_in',
      actor: { type: 'user', id: USER.id, role: 'viewer' },
      details: { method: 'totp' },
      request,
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(`Second factor set up by user ${USER.id}`);
  });

  it('sets nothing up for an account that lost its way into the panel meanwhile', async () => {
    const ctx = setup({ factor: pending(), apps: 0 });
    await expect(ctx.service.confirmEnrollment('challenge', codeOf(), request)).rejects.toThrow(
      new ForbiddenException(NO_PANEL_ACCESS),
    );
    expect(ctx.state.factor).toMatchObject({ confirmedAt: null });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.sessions.create).not.toHaveBeenCalled();
  });

  it('asks to start again without a set-up in progress', async () => {
    for (const factor of [null, factorWith()]) {
      const ctx = setup({ factor });
      await expect(ctx.service.confirmEnrollment('challenge', codeOf(), request)).rejects.toThrow(
        new ConflictException('Start the set-up again'),
      );
      expect(ctx.challenges.failed).not.toHaveBeenCalled();
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('refuses a wrong code, spending an attempt', async () => {
    const ctx = setup({ factor: pending() });
    await expect(ctx.service.confirmEnrollment('challenge', WRONG_CODE, request)).rejects.toThrow(
      new UnauthorizedException('The code is wrong or was already used'),
    );
    expect(ctx.challenges.failed).toHaveBeenCalledWith({ ...CHALLENGE, purpose: 'enroll' });
    expect(actionsOf(ctx)).toEqual(['hub.session.sign_in_failed']);
    expect(ctx.state.factor?.confirmedAt).toBeNull();
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('asks to start again when another start replaced the secret meanwhile', async () => {
    const ctx = setup({ factor: pending() });
    // Read with the old secret; a new start stored another before the update.
    ctx.prisma.mfaFactor.findUnique.mockResolvedValueOnce(pending());
    const replaced = { ...pending(), secret: box.seal(Buffer.alloc(20), 'other').ciphertext };
    ctx.state.factor = replaced;
    await expect(ctx.service.confirmEnrollment('challenge', codeOf(), request)).rejects.toThrow(
      new ConflictException('Start the set-up again'),
    );
    expect(ctx.prisma.mfaRecoveryCode.createMany).not.toHaveBeenCalled();
    expect(ctx.sessions.create).not.toHaveBeenCalled();
    expect(replaced.confirmedAt).toBeNull();
  });

  it('makes no recovery codes without a pepper', async () => {
    const ctx = setup({ factor: pending(), peppers: [] });
    await expect(ctx.service.confirmEnrollment('challenge', codeOf(), request)).rejects.toThrow(
      'No recovery code pepper',
    );
    expect(ctx.prisma.mfaRecoveryCode.createMany).not.toHaveBeenCalled();
    expect(ctx.sessions.create).not.toHaveBeenCalled();
  });
});

describe('MfaService.stepUp', () => {
  it('mints an access token that says the password and a code were confirmed now', async () => {
    const ctx = setup();
    const session = await ctx.service.stepUp(CALLER, 'right password', codeOf(), request);

    expect(session.accessToken).toBe('access-pwd+otp');
    expect(ctx.auth.sessionFor).toHaveBeenCalledWith(
      USER,
      4,
      ['pwd', 'otp'],
      Math.floor(NOW / 1000),
    );
    expect(ctx.state.factor?.lastUsedStep).toBe(STEP);
    expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith({
      action: 'hub.session.stepped_up',
      actor: { type: 'user', id: USER.id, role: 'viewer' },
      request,
    });
    // A step-up is not a new sign-in: no session, no challenge.
    expect(ctx.sessions.create).not.toHaveBeenCalled();
    expect(ctx.challenges.take).not.toHaveBeenCalled();
  });

  it('answers 404 for an account that is gone', async () => {
    const ctx = setup({ user: false });
    await expect(ctx.service.stepUp(CALLER, 'right password', codeOf(), request)).rejects.toThrow(
      new NotFoundException('User not found'),
    );
  });

  it('answers 403, not 401, for a wrong password or code, and records the failure', async () => {
    const cases: [Options, string, string][] = [
      [{}, 'wrong password', codeOf()],
      [{}, 'right password', WRONG_CODE],
      // Replayed: the step of this code was used already.
      [{ factor: factorWith({ lastUsedStep: STEP }) }, 'right password', codeOf()],
      [{ factor: null }, 'right password', codeOf()],
      [{ factor: factorWith({ confirmedAt: null }) }, 'right password', codeOf()],
    ];
    for (const [options, password, code] of cases) {
      const ctx = setup(options);
      await expect(ctx.service.stepUp(CALLER, password, code, request)).rejects.toThrow(
        new ForbiddenException('The password or the code is wrong'),
      );
      expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith({
        action: 'hub.session.sign_in_failed',
        outcome: 'failure',
        actor: { type: 'user', id: USER.id, role: 'viewer' },
        details: { stage: 'second_factor' },
        request,
      });
      expect(ctx.auth.sessionFor).not.toHaveBeenCalled();
    }
  });

  it('spends no code on a wrong password', async () => {
    const ctx = setup();
    await expect(ctx.service.stepUp(CALLER, 'wrong password', codeOf(), request)).rejects.toThrow(
      ForbiddenException,
    );
    expect(ctx.prisma.mfaFactor.updateMany).not.toHaveBeenCalled();
    expect(ctx.state.factor?.lastUsedStep).toBeNull();
  });

  it('answers 403 when another request used the code first', async () => {
    const ctx = setup();
    ctx.prisma.mfaFactor.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.service.stepUp(CALLER, 'right password', codeOf(), request)).rejects.toThrow(
      ForbiddenException,
    );
    expect(actionsOf(ctx)).toEqual(['hub.session.sign_in_failed']);
  });
});

describe('MfaService.status', () => {
  it('says when the factor was confirmed, and how many recovery codes are left', async () => {
    const used = { ...storedCode('mnpqr-stvwx'), usedAt: new Date() };
    const ctx = setup({ codes: [storedCode('abcde-fghjk'), used] });
    await expect(ctx.service.status(USER.id)).resolves.toEqual({
      confirmedAt: CONFIRMED_AT.toISOString(),
      recoveryCodesLeft: 1,
    });
  });

  it('says null without a confirmed factor', async () => {
    for (const factor of [null, factorWith({ confirmedAt: null })]) {
      await expect(setup({ factor }).service.status(USER.id)).resolves.toEqual({
        confirmedAt: null,
        recoveryCodesLeft: 0,
      });
    }
  });
});

describe('MfaService.regenerateRecoveryCodes', () => {
  it('replaces the recovery codes, tells the person by email, and records it', async () => {
    const ctx = setup({ codes: [storedCode('abcde-fghjk')] });
    const codes = await ctx.service.regenerateRecoveryCodes(CALLER, request);

    expect(codes).toHaveLength(10);
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(ctx.state.codes.map((row) => row.codeHash)).toEqual(
      codes.map((code) => recoveryCodeHash(PEPPER, code.replace('-', ''))),
    );
    expect(ctx.state.codes).not.toContainEqual(storedCode('abcde-fghjk'));
    expectMailed(ctx, 'recovery_codes_regenerated');
    expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith({
      action: 'hub.mfa.recovery_codes_regenerated',
      actor: { type: 'user', id: USER.id, role: 'viewer' },
      request,
    });
  });

  it('sends no email while email is off', async () => {
    const ctx = setup({ mailEnabled: false });
    await ctx.service.regenerateRecoveryCodes(CALLER, request);
    expect(ctx.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(ctx.mail.enqueue).not.toHaveBeenCalled();
    expect(ctx.mail.notifyQueued).not.toHaveBeenCalled();
    expect(actionsOf(ctx)).toEqual(['hub.mfa.recovery_codes_regenerated']);
  });

  it('sends no email to an account that is gone', async () => {
    const ctx = setup({ user: false });
    await ctx.service.regenerateRecoveryCodes(CALLER, request);
    expect(ctx.prisma.user.findUnique).toHaveBeenCalledOnce();
    expect(ctx.mail.enqueue).not.toHaveBeenCalled();
    expect(ctx.mail.notifyQueued).not.toHaveBeenCalled();
  });
});

describe('MfaService.reset', () => {
  it('refuses to reset the second factor of the administrator who asks', async () => {
    const ctx = setup();
    await expect(ctx.service.reset(ADMIN, ADMIN.id, 'lost phone', request)).rejects.toThrow(
      new ForbiddenException('Reset your own second factor with a recovery code instead'),
    );
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.hubAudit.recordQuietly).not.toHaveBeenCalled();
  });

  it('answers 404 for an account that does not exist', async () => {
    const ctx = setup({ user: false });
    await expect(ctx.service.reset(ADMIN, USER.id, 'lost phone', request)).rejects.toThrow(
      new NotFoundException('User not found'),
    );
    expect(ctx.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(ctx.prisma.mfaFactor.deleteMany).not.toHaveBeenCalled();
    expect(ctx.hubAudit.recordQuietly).not.toHaveBeenCalled();
  });

  it('answers 409 for a removed account: nothing to reset, no address to tell', async () => {
    const ctx = setup({ removedAt: new Date(NOW), factor: null });
    await expect(ctx.service.reset(ADMIN, USER.id, 'lost phone', request)).rejects.toThrow(
      new ConflictException('The account was removed'),
    );
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
    expect(ctx.mail.enqueue).not.toHaveBeenCalled();
    expect(ctx.hubAudit.recordQuietly).not.toHaveBeenCalled();
  });

  it('removes the factor and the codes, bumps the securityVersion and ends every session, under the lock', async () => {
    const ctx = setup({ codes: [storedCode('abcde-fghjk')] });
    await ctx.service.reset(ADMIN, USER.id, 'lost phone', request);

    expect(ctx.state.factor).toBeNull();
    expect(ctx.state.codes).toEqual([]);
    // Every challenge and access token minted before is void.
    expect(ctx.state.user?.securityVersion).toBe(5);
    expect(ctx.prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER.id },
      data: { securityVersion: { increment: 1 } },
    });
    expect(ctx.prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, revokedAt: null },
      data: { revokedAt: new Date(NOW) },
    });
    const [lockedAt] = ctx.prisma.$queryRaw.mock.invocationCallOrder;
    const [deletedAt] = ctx.prisma.mfaFactor.deleteMany.mock.invocationCallOrder;
    expect(lockedAt).toBeLessThan(deletedAt ?? 0);
    expectMailed(ctx, 'reset');
    expect(ctx.hubAudit.recordQuietly).toHaveBeenCalledWith({
      action: 'hub.mfa.reset',
      actor: { type: 'user', id: ADMIN.id, role: 'admin' },
      resource: { type: 'user', id: USER.id },
      details: { reason: 'lost phone' },
      request,
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      `Second factor of user ${USER.id} reset by ${ADMIN.id}`,
    );
  });

  it('records a reset from the command line, without a request', async () => {
    const ctx = setup();
    await ctx.service.reset(ADMIN, USER.id, 'lost phone');
    const input = ctx.hubAudit.recordQuietly.mock.calls[0]?.[0];
    expect(input).toMatchObject({ action: 'hub.mfa.reset', details: { reason: 'lost phone' } });
    expect(input).not.toHaveProperty('request');
  });
});
