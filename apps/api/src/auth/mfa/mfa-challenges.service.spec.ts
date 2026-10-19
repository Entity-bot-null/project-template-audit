import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../common/utils/sha256.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_SEC,
  MfaChallengesService,
  type TakenChallenge,
} from './mfa-challenges.service.js';

const USER_ID = '0190b6a1-0000-7000-8000-000000000001';
const CHALLENGE_ID = '0190b6a1-0000-7000-8000-0000000000c1';
const NOW = new Date('2026-10-15T12:00:00.000Z').getTime();

interface Row {
  id: string;
  userId: string;
  purpose: string;
  tokenHash: string;
  attempts: number;
  securityVersion: number;
  expiresAt: Date;
  usedAt: Date | null;
  user: { securityVersion: number; disabledAt: Date | null };
}

const rowFor = (token: string, overrides: Partial<Row> = {}): Row => ({
  id: CHALLENGE_ID,
  userId: USER_ID,
  purpose: 'verify',
  tokenHash: sha256Hex(token),
  attempts: 0,
  securityVersion: 2,
  expiresAt: new Date(Date.now() + 60_000),
  usedAt: null,
  user: { securityVersion: 2, disabledAt: null },
  ...overrides,
});

// Only the calls are checked here: the queries themselves (the single use
// under a race, the attempt counter) run against PostgreSQL in mfa.int.spec.ts.
function setup(row: Row | null = null, count = 1) {
  const mfaChallenge = {
    create: vi.fn(() => Promise.resolve({})),
    findUnique: vi.fn(({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(row !== null && row.tokenHash === where.tokenHash ? row : null),
    ),
    updateMany: vi.fn(() => Promise.resolve({ count })),
    deleteMany: vi.fn(() => Promise.resolve({ count })),
  };
  const prisma = { mfaChallenge } as unknown as PrismaService;
  return { service: new MfaChallengesService(prisma), mfaChallenge };
}

const taken: TakenChallenge = { id: CHALLENGE_ID, userId: USER_ID, purpose: 'verify' };

afterEach(() => {
  vi.useRealTimers();
});

describe('MfaChallengesService.create', () => {
  it('hands the client a random token and stores only its hash, bound to the securityVersion', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { service, mfaChallenge } = setup();
    const answer = await service.create({ id: USER_ID, securityVersion: 2 }, 'enroll');

    expect(answer).toEqual({
      mfa: 'enroll',
      challengeToken: expect.stringMatching(/^[\w-]{43}$/) as string,
      expiresIn: CHALLENGE_TTL_SEC,
    });
    expect(mfaChallenge.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        purpose: 'enroll',
        tokenHash: sha256Hex(answer.challengeToken),
        securityVersion: 2,
        expiresAt: new Date(NOW + CHALLENGE_TTL_SEC * 1000),
      },
    });
    const second = await service.create({ id: USER_ID, securityVersion: 2 }, 'enroll');
    expect(second.challengeToken).not.toBe(answer.challengeToken);
  });

  it('writes in the transaction it is given', async () => {
    const { service, mfaChallenge } = setup();
    const tx = { mfaChallenge: { create: vi.fn(() => Promise.resolve({})) } };
    await service.create({ id: USER_ID, securityVersion: 0 }, 'verify', tx as never);
    expect(tx.mfaChallenge.create).toHaveBeenCalledOnce();
    expect(mfaChallenge.create).not.toHaveBeenCalled();
  });
});

describe('MfaChallengesService.take', () => {
  it('finds a live challenge by the hash of its token, for one of the purposes asked', async () => {
    const { service, mfaChallenge } = setup(rowFor('token'));
    await expect(service.take('token', ['verify', 'enroll'])).resolves.toEqual(taken);
    expect(mfaChallenge.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256Hex('token') },
      include: { user: { select: { securityVersion: true, disabledAt: true } } },
    });
  });

  it('answers 401 for an unknown, used, expired, exhausted or stale challenge', async () => {
    const dead = [
      null,
      rowFor('token', { usedAt: new Date() }),
      rowFor('token', { expiresAt: new Date(Date.now()) }),
      rowFor('token', { attempts: CHALLENGE_MAX_ATTEMPTS }),
      // A new password or a reset since the password was checked.
      rowFor('token', { user: { securityVersion: 3, disabledAt: null } }),
      // An account disabled by hand meanwhile (disabling also raises the version).
      rowFor('token', { user: { securityVersion: 2, disabledAt: new Date() } }),
    ];
    for (const row of dead) {
      await expect(setup(row).service.take('token', ['verify'])).rejects.toThrow(
        new UnauthorizedException('Sign in again: this step expired or was used'),
      );
    }
  });

  it('keeps a challenge to its purpose: a set-up step does not sign in, nor the other way round', async () => {
    await expect(setup(rowFor('token')).service.take('token', ['enroll'])).rejects.toThrow(
      UnauthorizedException,
    );
    const enroll = setup(rowFor('token', { purpose: 'enroll', attempts: 4 }));
    await expect(enroll.service.take('token', ['enroll'])).resolves.toMatchObject({
      purpose: 'enroll',
    });
    await expect(enroll.service.take('token', ['verify'])).rejects.toThrow(UnauthorizedException);
  });
});

describe('MfaChallengesService attempts and use', () => {
  it('spends an attempt on a wrong code, while the challenge is unused', async () => {
    const { service, mfaChallenge } = setup();
    await service.failed(taken);
    expect(mfaChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID, usedAt: null },
      data: { attempts: { increment: 1 } },
    });
  });

  it('spends the challenge once, and says when another request already did', async () => {
    const { service, mfaChallenge } = setup(null, 1);
    await expect(service.consume(taken)).resolves.toBe(true);
    expect(mfaChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID, usedAt: null, attempts: { lt: CHALLENGE_MAX_ATTEMPTS } },
      data: { usedAt: expect.any(Date) as Date },
    });
    await expect(setup(null, 0).service.consume(taken)).resolves.toBe(false);
  });

  it('spends it in the transaction it is given', async () => {
    const { service, mfaChallenge } = setup();
    const tx = { mfaChallenge: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) } };
    await expect(service.consume(taken, tx as never)).resolves.toBe(true);
    expect(tx.mfaChallenge.updateMany).toHaveBeenCalledOnce();
    expect(mfaChallenge.updateMany).not.toHaveBeenCalled();
  });
});

describe('MfaChallengesService.sweep', () => {
  it('deletes the challenges expired more than an hour ago, and counts them', async () => {
    const { service, mfaChallenge } = setup(null, 3);
    await expect(service.sweep(NOW)).resolves.toBe(3);
    expect(mfaChallenge.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(NOW - 3_600_000) } },
    });
  });

  it('sweeps against the current time by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { service, mfaChallenge } = setup(null, 0);
    await expect(service.sweep()).resolves.toBe(0);
    expect(mfaChallenge.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(NOW - 3_600_000) } },
    });
  });
});
