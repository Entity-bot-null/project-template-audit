import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAccountToken } from '../auth/account-tokens.js';
import type { MfaChallengesService } from '../auth/mfa/mfa-challenges.service.js';
import { checkPassword } from '../auth/password.js';
import type { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  ACCOUNT_EXISTS,
  HELD_BACK,
  INVALID_INVITATION,
  InvitationsService,
} from './invitations.service.js';

// The transaction's SQL, locks and concurrency run against PostgreSQL in
// invitations.int.spec.ts; here, the order of the decisions.

const NOW = Date.parse('2026-10-13T10:00:00Z');
const TOKEN = 'd'.repeat(43);
const GOOD = 'violet harbour lantern 7';
const CREATED = {
  id: 'i2',
  email: 'ada@example.test',
  role: 'admin' as const,
  createdAt: new Date(NOW),
  expiresAt: null,
  invitedBy: { id: 'a1', name: 'Admin' },
  apps: [] as { app: { id: string; slug: string; name: string } }[],
};

interface Setup {
  mailEnabled?: boolean;
  /** The account the address already has; null: none. */
  account?: { id: string } | null;
  /** What the token's hash finds; null: none. */
  invitation?: Record<string, unknown> | null;
  /** What the locked SELECT of the invitation finds. */
  lockedRows?: unknown[];
  /** Of the applications asked for, how many cannot be assigned (unknown, Audit Hub's own, retired). */
  unknownApps?: number;
  /** The invitation's applications still in service, at acceptance. */
  invitedApps?: { appId: string }[];
}

function setup({
  mailEnabled = true,
  account = null,
  invitation = { id: 'i1', email: 'ada@example.test', expiresAt: new Date(NOW + 60_000) },
  lockedRows = [{ role: 'admin', invitedById: 'a1', inviterRole: 'admin' }],
  unknownApps = 0,
  invitedApps = [],
}: Setup = {}) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(() => {
      calls.push('lock address');
      return Promise.resolve(1);
    }),
    $queryRaw: vi.fn(() => {
      calls.push('lock invitation');
      return Promise.resolve(lockedRows);
    }),
    user: {
      findUnique: vi.fn(() => Promise.resolve(account)),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        calls.push('create account');
        return Promise.resolve({
          id: 'u9',
          email: args.data.email,
          name: args.data.name,
          role: args.data.role,
        });
      }),
    },
    invitation: {
      deleteMany: vi.fn(() => {
        calls.push('drop earlier invitation');
        return Promise.resolve({ count: 1 });
      }),
      create: vi.fn(() => {
        calls.push('record invitation');
        return Promise.resolve(CREATED);
      }),
      delete: vi.fn(() => {
        calls.push('delete invitation');
        return Promise.resolve({});
      }),
    },
    connectedApp: {
      count: vi.fn((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(args.where.id.in.length - unknownApps),
      ),
    },
    invitationApp: { findMany: vi.fn(() => Promise.resolve(invitedApps)) },
    userAppAssignment: {
      createMany: vi.fn((args: { data: unknown[] }) => {
        calls.push('assign applications');
        return Promise.resolve({ count: args.data.length });
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: unknown) =>
      typeof work === 'function'
        ? (work as (client: typeof tx) => Promise<unknown>)(tx)
        : Promise.all(work as Promise<unknown>[]),
    ),
    invitation: {
      findUnique: vi.fn(() => Promise.resolve(invitation)),
      findMany: vi.fn(() => Promise.resolve([CREATED])),
      count: vi.fn(() => Promise.resolve(1)),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
  };
  const mail = {
    enabled: mailEnabled,
    enqueue: vi.fn((_tx: unknown, input: { kind: string }) => {
      calls.push(`queue ${input.kind}`);
      return Promise.resolve('queued');
    }),
    notifyQueued: vi.fn(),
  };
  const challenge = { mfa: 'enroll' as const, challengeToken: 'challenge', expiresIn: 300 };
  const challenges = {
    create: vi.fn(() => {
      calls.push('open second factor set-up');
      return Promise.resolve(challenge);
    }),
  };
  const service = new InvitationsService(
    prisma as unknown as PrismaService,
    mail as unknown as MailOutboxService,
    challenges as unknown as MfaChallengesService,
  );
  return { service, prisma, tx, mail, challenges, calls, challenge };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('InvitationsService.invite', () => {
  it('replaces the earlier invitation of the address, records this one and queues its message', async () => {
    const { service, tx, mail, calls } = setup();
    const invited = await service.invite('a1', {
      email: '  Ada@Example.TEST ',
      role: 'admin',
      appIds: [],
    });
    expect(calls).toEqual([
      'lock address',
      'drop earlier invitation',
      'record invitation',
      'queue invitation',
    ]);
    expect(tx.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email: 'ada@example.test',
          role: 'admin',
          invitedById: 'a1',
          apps: { create: [] },
        },
      }),
    );
    expect(mail.enqueue).toHaveBeenCalledWith(expect.anything(), {
      kind: 'invitation',
      to: 'ada@example.test',
      payload: { invitationId: 'i2' },
    });
    expect(mail.notifyQueued).toHaveBeenCalledOnce();
    expect(invited).toEqual({
      id: 'i2',
      email: 'ada@example.test',
      role: 'admin',
      apps: [],
      invitedBy: { id: 'a1', name: 'Admin' },
      createdAt: new Date(NOW).toISOString(),
      expiresAt: null,
    });
  });

  it('invites an auditor or a viewer with the applications they will see, each once', async () => {
    const { service, tx } = setup();
    tx.invitation.create.mockResolvedValueOnce({
      ...CREATED,
      role: 'viewer' as never,
      apps: [{ app: { id: 'app1', slug: 'shop', name: 'Shop' } }],
    });
    const invited = await service.invite('a1', {
      email: 'ada@example.test',
      role: 'viewer',
      appIds: ['app1', 'app1'],
    });
    // Only applications that can be assigned: not Audit Hub's own, not retired.
    expect(tx.connectedApp.count).toHaveBeenCalledWith({
      where: { id: { in: ['app1'] }, system: false, status: { not: 'retired' } },
    });
    const [[{ data }]] = tx.invitation.create.mock.calls as unknown as [
      [{ data: { role: string; apps: unknown } }],
    ];
    expect(data).toMatchObject({ role: 'viewer', apps: { create: [{ appId: 'app1' }] } });
    expect(invited.apps).toEqual([{ appId: 'app1', slug: 'shop', name: 'Shop' }]);
  });

  it('answers 404 for an application it cannot assign, sending nothing', async () => {
    const { service, tx, mail } = setup({ unknownApps: 1 });
    await expect(
      service.invite('a1', { email: 'ada@example.test', role: 'auditor', appIds: ['gone'] }),
    ).rejects.toThrow(new NotFoundException('Application not found'));
    expect(tx.invitation.deleteMany).not.toHaveBeenCalled();
    expect(tx.invitation.create).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('answers 409 for an address that has an account, changing nothing', async () => {
    const { service, tx, mail } = setup({ account: { id: 'u1' } });
    await expect(
      service.invite('a1', { email: 'ada@example.test', role: 'admin', appIds: [] }),
    ).rejects.toThrow(new ConflictException(ACCOUNT_EXISTS));
    expect(tx.invitation.deleteMany).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('answers 429 when the address got its share of messages: the replacement rolls back', async () => {
    const { service, mail } = setup();
    mail.enqueue.mockResolvedValueOnce('suppressed');
    const refused = service.invite('a1', { email: 'ada@example.test', role: 'admin', appIds: [] });
    await expect(refused).rejects.toThrow(HELD_BACK);
    await expect(refused).rejects.toBeInstanceOf(HttpException);
    await refused.catch((error: unknown) => {
      expect((error as HttpException).getStatus()).toBe(429);
    });
    expect(mail.notifyQueued).not.toHaveBeenCalled();
  });

  it('answers 503 without email, and passes other failures on', async () => {
    const off = setup({ mailEnabled: false });
    expect(off.service.available).toBe(false);
    await expect(
      off.service.invite('a1', { email: 'ada@example.test', role: 'admin', appIds: [] }),
    ).rejects.toThrow(ServiceUnavailableException);
    const failing = setup();
    failing.prisma.$transaction.mockRejectedValueOnce(new Error('database down'));
    await expect(
      failing.service.invite('a1', { email: 'ada@example.test', role: 'admin', appIds: [] }),
    ).rejects.toThrow('database down');
  });
});

describe('InvitationsService.list and revoke', () => {
  it('lists pending invitations newest first, paged', async () => {
    const { service, prisma } = setup();
    await expect(service.list({ limit: 20, offset: 40 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'i2', expiresAt: null })],
      total: 1,
    });
    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        skip: 40,
      }),
    );
  });

  it('revokes one, and answers 404 for none', async () => {
    const { service, prisma } = setup();
    await service.revoke('a1', 'i1');
    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({ where: { id: 'i1' } });
    prisma.invitation.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.revoke('a1', 'i1')).rejects.toThrow(NotFoundException);
  });
});

describe('InvitationsService.accept', () => {
  it('creates the account with the invitation role under its lock, then asks for its second factor', async () => {
    const { service, tx, challenges, calls, challenge } = setup();
    const result = await service.accept(TOKEN, 'Ada Lovelace', GOOD, NOW);
    // No session before a second factor is set up (docs/adr/0012).
    expect(calls).toEqual([
      'lock address',
      'lock invitation',
      'delete invitation',
      'create account',
      'open second factor set-up',
    ]);
    const [sql, ...values] = tx.$queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(values).toEqual(['i1', hashAccountToken(TOKEN)]);
    const [[{ data }]] = tx.user.create.mock.calls as unknown as [
      [{ data: { email: string; name: string; role: string; passwordHash: string } }],
    ];
    // The role is the invitation's, read under the lock: never the request's.
    expect(data).toMatchObject({ email: 'ada@example.test', name: 'Ada Lovelace', role: 'admin' });
    await expect(checkPassword(data.passwordHash, GOOD)).resolves.toBe(true);
    expect(challenges.create).toHaveBeenCalledWith(
      expect.objectContaining({ securityVersion: 0 }),
      'enroll',
    );
    expect(result).toEqual(challenge);
  });

  it.each([
    ['unknown, replaced, revoked or used', null],
    ['never sent', { id: 'i1', email: 'ada@example.test', expiresAt: null }],
    ['expired', { id: 'i1', email: 'ada@example.test', expiresAt: new Date(NOW) }],
  ])('answers 404 for an invitation %s', async (_case, invitation) => {
    const { service, prisma } = setup({ invitation });
    await expect(service.accept(TOKEN, 'Ada', GOOD, NOW)).rejects.toThrow(
      new NotFoundException(INVALID_INVITATION),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a weak password before taking the link, judged against the address and the name', async () => {
    const { service, prisma } = setup();
    for (const weak of ['short', 'correcthorsebatterystaple', 'lovelace is the best name']) {
      await expect(service.accept(TOKEN, 'Ada Lovelace', weak, NOW)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('assigns an auditor or a viewer the applications of the invitation still in service', async () => {
    const { service, tx, calls } = setup({
      lockedRows: [{ role: 'viewer', invitedById: 'a1', inviterRole: 'admin' }],
      invitedApps: [{ appId: 'app1' }, { appId: 'app2' }],
    });
    await service.accept(TOKEN, 'Ada Lovelace', GOOD, NOW);
    expect(tx.invitationApp.findMany).toHaveBeenCalledWith({
      where: { invitationId: 'i1', app: { system: false, status: { not: 'retired' } } },
      select: { appId: true },
    });
    expect(calls).toEqual([
      'lock address',
      'lock invitation',
      'delete invitation',
      'create account',
      'assign applications',
      'open second factor set-up',
    ]);
    expect(tx.userAppAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'u9', appId: 'app1', createdById: 'a1' },
        { userId: 'u9', appId: 'app2', createdById: 'a1' },
      ],
    });
  });

  it.each([
    ['an auditor whose applications were all retired', 'auditor'],
    ['a member, who could never sign in', 'member'],
  ])('answers 404 for an invitation of %s: it no longer opens the panel', async (_case, role) => {
    const { service, tx, challenges } = setup({
      lockedRows: [{ role, invitedById: 'a1', inviterRole: 'admin' }],
    });
    await expect(service.accept(TOKEN, 'Ada', GOOD, NOW)).rejects.toThrow(
      new NotFoundException(INVALID_INVITATION),
    );
    expect(tx.invitation.delete).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(challenges.create).not.toHaveBeenCalled();
  });

  it.each([
    ['demoted since', 'member'],
    ['deleted since', null],
  ])(
    'answers 404 when whoever invited was %s: nobody vouches for it any more',
    async (_case, inviterRole) => {
      const { service, tx, challenges } = setup({
        lockedRows: [{ role: 'admin', invitedById: 'a1', inviterRole }],
      });
      await expect(service.accept(TOKEN, 'Ada', GOOD, NOW)).rejects.toThrow(
        new NotFoundException(INVALID_INVITATION),
      );
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(challenges.create).not.toHaveBeenCalled();
    },
  );

  it('answers 404 when the invitation changed after it was read, 409 for a taken address', async () => {
    const replaced = setup({ lockedRows: [] });
    await expect(replaced.service.accept(TOKEN, 'Ada', GOOD, NOW)).rejects.toThrow(
      INVALID_INVITATION,
    );
    expect(replaced.tx.user.create).not.toHaveBeenCalled();
    const taken = setup();
    taken.tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(taken.service.accept(TOKEN, 'Ada', GOOD, NOW)).rejects.toThrow(
      new ConflictException(ACCOUNT_EXISTS),
    );
    expect(taken.challenges.create).not.toHaveBeenCalled();
    const failing = setup();
    failing.tx.user.create.mockRejectedValueOnce(new Error('database down'));
    await expect(failing.service.accept(TOKEN, 'Ada', GOOD, NOW)).rejects.toThrow('database down');
  });
});
