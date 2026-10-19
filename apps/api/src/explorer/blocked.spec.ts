import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../prisma/generated/client.js';
import {
  blockedApps,
  blockedWithEmail,
  blockOf,
  isBlocked,
  presentUnblocked,
  withoutBlocked,
  withoutSubjects,
} from './blocked.js';

// The SQL (an erasure run, not undone by an active legal hold) runs against
// the database in explorer.int.spec.ts; here, what the helpers ask and what
// they make of the rows.

const APP = '0199e0b1-0000-7000-8000-000000000001';
const OTHER = '0199e0b1-0000-7000-8000-000000000002';
const SINCE = new Date('2026-10-15T12:00:00.000Z');
const THROUGH = new Date('2026-10-16T12:00:00.000Z');

function setup(rows: unknown[]) {
  const prisma = {
    // Tagged template calls: the strings, then the values in order.
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve(rows),
    ),
  };
  return { prisma, client: prisma as unknown as PrismaService };
}

describe('blockOf', () => {
  it("answers the subject's block in the application: its first erasure and its last", async () => {
    const { prisma, client } = setup([{ appId: APP, since: SINCE, through: THROUGH }]);
    await expect(blockOf(client, APP, 'user-7')).resolves.toEqual({
      since: SINCE,
      through: THROUGH,
    });
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0]!;
    expect(strings.join('?')).toContain('"erasure_runs"');
    expect(values.slice(0, 3)).toEqual(['user-7', APP, APP]);
    // Not while an active hold names them.
    expect((values[3] as Prisma.Sql).sql).toContain('"legal_holds"');
  });

  it('answers null for a subject not blocked there', async () => {
    const { client } = setup([]);
    await expect(blockOf(client, APP, 'user-7')).resolves.toBeNull();
  });
});

describe('isBlocked', () => {
  it('blocks what occurred up to the last erasure, and nothing after it', () => {
    const block = { since: SINCE, through: THROUGH };
    expect(isBlocked(block, SINCE)).toBe(true);
    expect(isBlocked(block, THROUGH)).toBe(true);
    expect(isBlocked(block, new Date(THROUGH.getTime() + 1))).toBe(false);
    expect(isBlocked(null, SINCE)).toBe(false);
  });
});

describe('blockedApps', () => {
  it('lists every application where the subject is blocked, whichever it is', async () => {
    const { prisma, client } = setup([
      { appId: APP, since: SINCE, through: SINCE },
      { appId: OTHER, since: SINCE, through: THROUGH },
    ]);
    await expect(blockedApps(client, 'user-7')).resolves.toEqual([
      { appId: APP, through: SINCE },
      { appId: OTHER, through: THROUGH },
    ]);
    expect(prisma.$queryRaw.mock.calls[0]!.slice(1, 4)).toEqual(['user-7', null, null]);
  });

  it('lists none for a subject blocked nowhere', async () => {
    const { client } = setup([]);
    await expect(blockedApps(client, 'user-7')).resolves.toEqual([]);
  });
});

describe('blockedWithEmail', () => {
  it("asks for the blocked subjects with the address's pseudonyms, in the column asked", async () => {
    const found = [{ appId: APP, subject: 'user-7', through: THROUGH }];
    const { prisma, client } = setup(found);
    await expect(blockedWithEmail(client, [APP], ['a'.repeat(64)], 'own')).resolves.toEqual(found);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0]!;
    expect(strings.join('?')).toContain('"erasure_runs"');
    expect(values[0]).toEqual([APP]);
    expect((values[2] as Prisma.Sql).sql).toBe('"actor_email_hmac"');
    expect(values[3]).toEqual(['a'.repeat(64)]);
    await blockedWithEmail(client, [APP, OTHER], ['b'.repeat(64)], 'shared');
    expect((prisma.$queryRaw.mock.calls[1]![3] as Prisma.Sql).sql).toBe(
      '"actor_email_hmac_shared"',
    );
  });

  it('asks nothing without an application or a pseudonym', async () => {
    const { prisma, client } = setup([]);
    await expect(blockedWithEmail(client, [], ['a'.repeat(64)], 'own')).resolves.toEqual([]);
    await expect(blockedWithEmail(client, [APP], [], 'shared')).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('presentUnblocked', () => {
  it('answers the applications the database finds the person in, unblocked', async () => {
    const { prisma, client } = setup([{ appId: OTHER }]);
    await expect(presentUnblocked(client, [APP, OTHER], ['c'.repeat(64)])).resolves.toEqual([
      OTHER,
    ]);
    const [, ...values] = prisma.$queryRaw.mock.calls[0]!;
    expect(values.slice(0, 2)).toEqual([[APP, OTHER], ['c'.repeat(64)]]);
    await expect(presentUnblocked(client, [], ['c'.repeat(64)])).resolves.toEqual([]);
    await expect(presentUnblocked(client, [APP], [])).resolves.toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });
});

describe('withoutSubjects', () => {
  it('leaves out what each blocked subject did up to their block, and nothing when none is', () => {
    expect(withoutSubjects([])).toEqual([]);
    expect(
      withoutSubjects([
        { appId: APP, subject: 'user-7', through: SINCE },
        { appId: OTHER, subject: 'user-9', through: THROUGH },
      ]),
    ).toEqual([
      {
        NOT: {
          OR: [
            { appId: APP, actorId: 'user-7', occurredAt: { lte: SINCE } },
            { appId: OTHER, actorId: 'user-9', occurredAt: { lte: THROUGH } },
          ],
        },
      },
    ]);
  });
});

describe('withoutBlocked', () => {
  it('leaves out what occurred up to each block, in its application, and nothing when none is', () => {
    expect(withoutBlocked([])).toEqual([]);
    expect(
      withoutBlocked([
        { appId: APP, through: SINCE },
        { appId: OTHER, through: THROUGH },
      ]),
    ).toEqual([
      {
        NOT: {
          OR: [
            { appId: APP, occurredAt: { lte: SINCE } },
            { appId: OTHER, occurredAt: { lte: THROUGH } },
          ],
        },
      },
    ]);
  });
});
