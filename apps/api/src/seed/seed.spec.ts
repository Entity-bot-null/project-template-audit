import { Secret } from 'otpauth';
import { describe, expect, it, vi } from 'vitest';
import { checkPassword } from '../auth/password.js';
import { secretBoxFromConfig } from '../common/crypto/secret-box.js';
import { ROLES } from '../common/types/request-user.js';
import type { PrismaClient } from '../prisma/generated/client.js';
import { SEED_TOTP_SECRET, SEED_USERS, seed, seedTotpBytes } from './seed.js';

// The real password hashing and secret box; a stand-in for the two tables.
// run.ts, the entry point, seeds a real database for `pnpm db:seed` and the
// E2E server (scripts/e2e-server.mjs), whose specs sign in as these accounts.

const { box } = secretBoxFromConfig({
  secret: 's'.repeat(64),
  previous: undefined,
  fallback: 'j'.repeat(64),
});

interface UserUpsert {
  where: { email: string };
  create: { email: string; name: string; role: string; passwordHash: string };
  update: { name: string; role: string; passwordHash: string };
  select: { id: true };
}
interface Factor {
  secret: Uint8Array;
  encKeyId: string;
  confirmedAt: Date;
  lastUsedStep: null;
}
interface FactorUpsert {
  where: { userId: string };
  create: Factor & { userId: string };
  update: Factor;
}

function setup() {
  const prisma = {
    user: {
      upsert: vi.fn((args: UserUpsert) => Promise.resolve({ id: `id-${args.where.email}` })),
    },
    mfaFactor: { upsert: vi.fn((_args: FactorUpsert) => Promise.resolve({})) },
  };
  return { prisma, client: prisma as unknown as PrismaClient };
}

describe('seedTotpBytes', () => {
  it("answers the bytes of the public secret, for every account's second factor", () => {
    const bytes = seedTotpBytes();
    expect(bytes).toBeInstanceOf(Buffer);
    expect(bytes).toHaveLength(20);
    expect(new Secret({ buffer: new Uint8Array(bytes).buffer }).base32).toBe(SEED_TOTP_SECRET);
  });

  it('answers a fresh copy each time', () => {
    const first = seedTotpBytes();
    first.fill(0);
    expect(seedTotpBytes()).not.toEqual(first);
  });
});

describe('SEED_USERS', () => {
  it('has one account per role, each with its own address', () => {
    expect(SEED_USERS.map((user) => user.role).sort()).toEqual([...ROLES].sort());
    expect(new Set(SEED_USERS.map((user) => user.email)).size).toBe(SEED_USERS.length);
  });
});

describe('seed', () => {
  it('upserts every account by its email, with a hash of its password', async () => {
    const { prisma, client } = setup();
    await seed(client, box);

    expect(prisma.user.upsert).toHaveBeenCalledTimes(SEED_USERS.length);
    for (const [index, user] of SEED_USERS.entries()) {
      const args = prisma.user.upsert.mock.calls[index]?.[0];
      expect(args).toMatchObject({
        where: { email: user.email },
        create: { email: user.email, name: user.name, role: user.role },
        // A re-run resets the name, the role and the password.
        update: { name: user.name, role: user.role },
        select: { id: true },
      });
      const hash = args?.create.passwordHash ?? '';
      expect(hash).toMatch(/^\$argon2id\$/);
      expect(hash).not.toContain(user.password);
      expect(args?.update.passwordHash).toBe(hash);
      expect(await checkPassword(hash, user.password)).toBe(true);
    }
  });

  it('sets up the second factor of every account, sealed to its row and confirmed', async () => {
    const { prisma, client } = setup();
    const before = Date.now();
    await seed(client, box);

    expect(prisma.mfaFactor.upsert).toHaveBeenCalledTimes(SEED_USERS.length);
    for (const [index, user] of SEED_USERS.entries()) {
      const id = `id-${user.email}`;
      const args = prisma.mfaFactor.upsert.mock.calls[index]?.[0];
      expect(args?.where).toEqual({ userId: id });
      expect(args?.create).toEqual({ userId: id, ...args?.update });
      // A re-run also forgets the last code used.
      expect(args?.update).toMatchObject({ encKeyId: box.currentKeyId, lastUsedStep: null });
      expect(args?.update.confirmedAt.getTime()).toBeGreaterThanOrEqual(before);
      const sealed = args?.update.secret ?? new Uint8Array();
      expect(box.open(sealed, `mfa_factors:${id}`)).toEqual(seedTotpBytes());
      // Bound to its row: another account's context does not open it.
      expect(() => box.open(sealed, 'mfa_factors:another-user')).toThrow('does not authenticate');
    }
  });

  it('stops at the first failure', async () => {
    const { prisma, client } = setup();
    prisma.user.upsert.mockRejectedValueOnce(new Error('database unreachable'));
    await expect(seed(client, box)).rejects.toThrow('database unreachable');
    expect(prisma.user.upsert).toHaveBeenCalledOnce();
    expect(prisma.mfaFactor.upsert).not.toHaveBeenCalled();
  });
});
