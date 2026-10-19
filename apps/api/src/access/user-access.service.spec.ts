import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { verifyPassword } from '../auth/password.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../common/types/request-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UserAccessService } from './user-access.service.js';

// The SQL (the advisory lock, the row lock, the unique assignments, the
// removal of everything of a person) runs in explorer.int.spec.ts and
// user-accounts.int.spec.ts; here, the rules: who exists, the last
// administrator who may sign in, one's own account, a removed account, which
// applications may be assigned.

const ADMIN = '0199e0b1-0000-7000-8000-00000000000a';
const USER = '0199e0b1-0000-7000-8000-00000000000b';
const APP = '0199e0b1-0000-7000-8000-000000000001';
const OTHER_APP = '0199e0b1-0000-7000-8000-000000000002';
const CONFIRMED = new Date('2026-10-15T12:00:00.000Z');
const DISABLED = new Date('2026-10-16T09:00:00.000Z');
const ALERT = '0199e0b1-0000-7000-8000-0000000000a1';
const OTHER_ALERT = '0199e0b1-0000-7000-8000-0000000000a2';

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: USER,
  role: 'auditor',
  disabledAt: null,
  removedAt: null,
  mfaFactor: { confirmedAt: CONFIRMED },
  appAssignments: [
    { app: { id: APP, slug: 'my-project', name: 'My project' } },
    { app: { id: OTHER_APP, slug: 'billing', name: 'Billing' } },
  ],
  ...overrides,
});

function setup(
  role: Role = 'member',
  state: { disabledAt?: Date | null; removedAt?: Date | null } = {},
) {
  const deleted = () => vi.fn((_args: unknown) => Promise.resolve({ count: 0 }));
  const tx = {
    $executeRaw: vi.fn(() => Promise.resolve(1)),
    $queryRaw: vi.fn(() => Promise.resolve([] as unknown[])),
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: USER,
          role,
          disabledAt: state.disabledAt ?? null,
          removedAt: state.removedAt ?? null,
        } as unknown),
      ),
      count: vi.fn((_args: unknown) => Promise.resolve(2)),
      update: vi.fn((_args: unknown) => Promise.resolve({})),
    },
    connectedApp: { count: vi.fn((_args: unknown) => Promise.resolve(0)) },
    userAppAssignment: {
      deleteMany: deleted(),
      createMany: vi.fn((_args: unknown) => Promise.resolve({ count: 0 })),
    },
    session: { updateMany: deleted(), deleteMany: deleted() },
    mfaFactor: { deleteMany: deleted() },
    mfaRecoveryCode: { deleteMany: deleted() },
    mfaChallenge: { deleteMany: deleted() },
    accountToken: { deleteMany: deleted() },
    mailMessage: { deleteMany: deleted() },
    invitation: { deleteMany: deleted() },
    alert: {
      findMany: vi.fn((_args: unknown) => Promise.resolve([] as { id: string }[])),
      updateMany: vi.fn((_args: unknown) => Promise.resolve({ count: 0 })),
    },
    alertActivity: { createMany: vi.fn((_args: unknown) => Promise.resolve({ count: 0 })) },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    user: { findUnique: vi.fn((_args: unknown) => Promise.resolve(userRow() as unknown)) },
  };
  const service = new UserAccessService(prisma as unknown as PrismaService);
  return { tx, prisma, service };
}

describe('UserAccessService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('get', () => {
    it('answers the role, the second factor and the assigned applications in order', async () => {
      const { prisma, service } = setup();
      await expect(service.get(USER)).resolves.toEqual({
        userId: USER,
        role: 'auditor',
        mfaConfirmedAt: '2026-10-15T12:00:00.000Z',
        disabledAt: null,
        removedAt: null,
        apps: [
          { appId: APP, slug: 'my-project', name: 'My project' },
          { appId: OTHER_APP, slug: 'billing', name: 'Billing' },
        ],
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER },
          select: expect.objectContaining({
            appAssignments: expect.objectContaining({ orderBy: { createdAt: 'asc' } }) as unknown,
          }) as unknown,
        }),
      );
    });

    it('answers no second factor until one is set up or confirmed', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValueOnce(
        userRow({ role: 'member', mfaFactor: null, appAssignments: [] }),
      );
      await expect(service.get(USER)).resolves.toEqual({
        userId: USER,
        role: 'member',
        mfaConfirmedAt: null,
        disabledAt: null,
        removedAt: null,
        apps: [],
      });
      prisma.user.findUnique.mockResolvedValueOnce(userRow({ mfaFactor: { confirmedAt: null } }));
      await expect(service.get(USER)).resolves.toMatchObject({ mfaConfirmedAt: null });
    });

    it('answers when the account was disabled, and removed', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValueOnce(
        userRow({ disabledAt: DISABLED, removedAt: DISABLED, mfaFactor: null, appAssignments: [] }),
      );
      await expect(service.get(USER)).resolves.toMatchObject({
        disabledAt: '2026-10-16T09:00:00.000Z',
        removedAt: '2026-10-16T09:00:00.000Z',
      });
    });

    it('answers 404 for an unknown user', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.get(USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('changeRole', () => {
    it('changes the role under the lock, ends the access tokens and answers the previous one', async () => {
      const { tx, service } = setup('viewer');
      await expect(service.changeRole(ADMIN, USER, 'auditor')).resolves.toBe('viewer');
      expect(tx.$executeRaw).toHaveBeenCalledOnce();
      // The user row lock (lockUser), then the change.
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { role: 'auditor', securityVersion: { increment: 1 } },
      });
      // Not demoting an administrator: no count.
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        `Role of user ${USER} changed from viewer to auditor by ${ADMIN}`,
      );
    });

    it('answers 404 for an unknown user, changing nothing', async () => {
      const { tx, service } = setup();
      tx.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.changeRole(ADMIN, USER, 'admin')).rejects.toThrow(NotFoundException);
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('never demotes the last administrator who may sign in', async () => {
      const { tx, service } = setup('admin');
      tx.user.count.mockResolvedValueOnce(0);
      await expect(service.changeRole(ADMIN, ADMIN, 'auditor')).rejects.toThrow(
        new ConflictException('Audit Hub needs at least one administrator'),
      );
      // A disabled administrator does not count.
      expect(tx.user.count).toHaveBeenCalledWith({
        where: { role: 'admin', disabledAt: null, id: { not: ADMIN } },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });

    it('demotes a disabled administrator without counting: they could not administer anyway', async () => {
      const { tx, service } = setup('admin', { disabledAt: DISABLED });
      await expect(service.changeRole(ADMIN, USER, 'viewer')).resolves.toBe('admin');
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalledOnce();
    });

    it('answers 409 for a removed account, changing nothing', async () => {
      const { tx, service } = setup('member', { disabledAt: DISABLED, removedAt: DISABLED });
      await expect(service.changeRole(ADMIN, USER, 'admin')).rejects.toThrow(
        new ConflictException('The account was removed'),
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('demotes an administrator while another one remains', async () => {
      const { tx, service } = setup('admin');
      await expect(service.changeRole(ADMIN, USER, 'member')).resolves.toBe('admin');
      expect(tx.user.count).toHaveBeenCalledOnce();
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: 'member', securityVersion: { increment: 1 } } }),
      );
    });

    it('keeps an administrator one without counting, and still ends their tokens', async () => {
      const { tx, service } = setup('admin');
      await expect(service.changeRole(ADMIN, USER, 'admin')).resolves.toBe('admin');
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalledOnce();
    });
  });

  describe('setDisabled', () => {
    it('disables under the locks, ends every session and access token, and answers that it changed', async () => {
      vi.useFakeTimers({ now: DISABLED, toFake: ['Date'] });
      try {
        const { tx, service } = setup('auditor');
        await expect(service.setDisabled(ADMIN, USER, true)).resolves.toBe(true);
        // The administration lock, then the account's row.
        expect(tx.$executeRaw).toHaveBeenCalledOnce();
        expect(tx.$queryRaw).toHaveBeenCalledOnce();
        expect(tx.user.update).toHaveBeenCalledWith({
          where: { id: USER },
          data: { disabledAt: DISABLED, securityVersion: { increment: 1 } },
        });
        expect(tx.session.updateMany).toHaveBeenCalledWith({
          where: { userId: USER, revokedAt: null },
          data: { revokedAt: DISABLED },
        });
        // Not an administrator: no count.
        expect(tx.user.count).not.toHaveBeenCalled();
        expect(Logger.prototype.log).toHaveBeenCalledWith(`User ${USER} disabled by ${ADMIN}`);
      } finally {
        vi.useRealTimers();
      }
    });

    it('enables again without touching the sessions (there are none) or the version', async () => {
      const { tx, service } = setup('auditor', { disabledAt: DISABLED });
      await expect(service.setDisabled(ADMIN, USER, false)).resolves.toBe(true);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { disabledAt: null },
      });
      expect(tx.session.updateMany).not.toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(`User ${USER} enabled by ${ADMIN}`);
    });

    it('answers false, changing and logging nothing, when the account is as asked already', async () => {
      const enabled = setup('auditor');
      await expect(enabled.service.setDisabled(ADMIN, USER, false)).resolves.toBe(false);
      const disabled = setup('auditor', { disabledAt: DISABLED });
      await expect(disabled.service.setDisabled(ADMIN, USER, true)).resolves.toBe(false);
      expect(enabled.tx.user.update).not.toHaveBeenCalled();
      expect(disabled.tx.user.update).not.toHaveBeenCalled();
      expect(disabled.tx.session.updateMany).not.toHaveBeenCalled();
      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });

    it('never disables your own account, before any lock', async () => {
      const { prisma, service } = setup('admin');
      await expect(service.setDisabled(ADMIN, ADMIN, true)).rejects.toThrow(
        new ConflictException('You cannot disable your own account'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('never disables the last administrator who may sign in', async () => {
      const { tx, service } = setup('admin');
      tx.user.count.mockResolvedValueOnce(0);
      await expect(service.setDisabled(ADMIN, USER, true)).rejects.toThrow(
        new ConflictException('Audit Hub needs at least one administrator'),
      );
      expect(tx.user.count).toHaveBeenCalledWith({
        where: { role: 'admin', disabledAt: null, id: { not: USER } },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.session.updateMany).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown account and 409 for a removed one, changing nothing', async () => {
      const unknown = setup();
      unknown.tx.user.findUnique.mockResolvedValueOnce(null);
      await expect(unknown.service.setDisabled(ADMIN, USER, true)).rejects.toThrow(
        new NotFoundException('User not found'),
      );
      const removed = setup('member', { disabledAt: DISABLED, removedAt: DISABLED });
      await expect(removed.service.setDisabled(ADMIN, USER, false)).rejects.toThrow(
        new ConflictException('The account was removed'),
      );
      expect(unknown.tx.user.update).not.toHaveBeenCalled();
      expect(removed.tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('keeps the id and nothing of the person, deletes what was theirs, and stays disabled', async () => {
      vi.useFakeTimers({ now: DISABLED, toFake: ['Date'] });
      try {
        const { tx, service } = setup('auditor');
        await expect(service.remove(ADMIN, USER)).resolves.toEqual({ alertsUnassigned: 0 });
        const [[{ data }]] = tx.user.update.mock.calls as unknown as [
          [{ data: Record<string, unknown> & { passwordHash: string } }],
        ];
        expect(data).toEqual({
          email: `removed+${USER}@users.invalid`,
          name: 'Removed user',
          passwordHash: expect.stringMatching(/^\$argon2id\$/) as unknown,
          role: 'member',
          disabledAt: DISABLED,
          removedAt: DISABLED,
          securityVersion: { increment: 1 },
        });
        // A password nobody knows, not even an empty one.
        await expect(verifyPassword(data.passwordHash, '')).resolves.toBe(false);
        for (const table of [
          tx.session,
          tx.mfaFactor,
          tx.mfaRecoveryCode,
          tx.mfaChallenge,
          tx.accountToken,
          tx.userAppAssignment,
        ]) {
          expect(table.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
        }
        expect(tx.mailMessage.deleteMany).toHaveBeenCalledWith({
          where: { userId: USER, status: { not: 'sending' } },
        });
        expect(tx.invitation.deleteMany).toHaveBeenCalledWith({ where: { invitedById: USER } });
        expect(tx.alert.updateMany).not.toHaveBeenCalled();
        expect(Logger.prototype.log).toHaveBeenCalledWith(`User ${USER} removed by ${ADMIN}`);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the date an account was disabled on', async () => {
      const { tx, service } = setup('auditor', { disabledAt: DISABLED });
      await service.remove(ADMIN, USER);
      expect(tx.user.update.mock.calls[0]?.[0]).toMatchObject({
        data: { disabledAt: DISABLED },
      });
    });

    it('assigns the open alerts of the person to nobody, with the change in their history', async () => {
      const { tx, service } = setup('auditor');
      tx.alert.findMany.mockResolvedValueOnce([{ id: ALERT }, { id: OTHER_ALERT }]);
      await expect(service.remove(ADMIN, USER)).resolves.toEqual({ alertsUnassigned: 2 });
      // Closed ones keep who worked on them.
      expect(tx.alert.findMany).toHaveBeenCalledWith({
        where: { assigneeId: USER, status: { in: ['open', 'in_review'] } },
        select: { id: true },
      });
      expect(tx.alert.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [ALERT, OTHER_ALERT] } },
        data: { assigneeId: null, version: { increment: 1 } },
      });
      expect(tx.alertActivity.createMany).toHaveBeenCalledWith({
        data: [
          { alertId: ALERT, kind: 'assigned', userId: ADMIN, note: 'unassigned' },
          { alertId: OTHER_ALERT, kind: 'assigned', userId: ADMIN, note: 'unassigned' },
        ],
      });
    });

    it('never removes your own account, nor the last administrator who may sign in', async () => {
      const own = setup('admin');
      await expect(own.service.remove(ADMIN, ADMIN)).rejects.toThrow(
        new ConflictException('You cannot remove your own account'),
      );
      expect(own.prisma.$transaction).not.toHaveBeenCalled();
      const last = setup('admin');
      last.tx.user.count.mockResolvedValueOnce(0);
      await expect(last.service.remove(ADMIN, USER)).rejects.toThrow(
        new ConflictException('Audit Hub needs at least one administrator'),
      );
      expect(last.tx.user.update).not.toHaveBeenCalled();
      expect(last.tx.session.deleteMany).not.toHaveBeenCalled();
    });

    it('removes a disabled administrator without counting', async () => {
      const { tx, service } = setup('admin', { disabledAt: DISABLED });
      await service.remove(ADMIN, USER);
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalledOnce();
    });

    it('answers 404 for an unknown account and 409 for one removed already', async () => {
      const unknown = setup();
      unknown.tx.user.findUnique.mockResolvedValueOnce(null);
      await expect(unknown.service.remove(ADMIN, USER)).rejects.toThrow(
        new NotFoundException('User not found'),
      );
      const removed = setup('member', { disabledAt: DISABLED, removedAt: DISABLED });
      await expect(removed.service.remove(ADMIN, USER)).rejects.toThrow(
        new ConflictException('The account was removed'),
      );
      expect(removed.tx.user.update).not.toHaveBeenCalled();
      expect(removed.tx.session.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('assignApps', () => {
    it('replaces the assignments with the given applications, once each, and answers the access', async () => {
      const { tx, service } = setup();
      tx.connectedApp.count.mockResolvedValueOnce(2);
      const access = await service.assignApps(ADMIN, USER, [APP, OTHER_APP, APP]);

      // Only applications of others, never Audit Hub's own.
      expect(tx.connectedApp.count).toHaveBeenCalledWith({
        where: { id: { in: [APP, OTHER_APP] }, system: false },
      });
      expect(tx.userAppAssignment.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, appId: { notIn: [APP, OTHER_APP] } },
      });
      expect(tx.userAppAssignment.createMany).toHaveBeenCalledWith({
        data: [
          { userId: USER, appId: APP, createdById: ADMIN },
          { userId: USER, appId: OTHER_APP, createdById: ADMIN },
        ],
        skipDuplicates: true,
      });
      expect(access.apps.map((app) => app.appId)).toEqual([APP, OTHER_APP]);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        `Applications of user ${USER} set to 2 by ${ADMIN}`,
      );
    });

    it('ends every assignment with an empty list', async () => {
      const { tx, service } = setup();
      await service.assignApps(ADMIN, USER, []);
      expect(tx.userAppAssignment.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, appId: { notIn: [] } },
      });
      expect(tx.userAppAssignment.createMany).toHaveBeenCalledWith({
        data: [],
        skipDuplicates: true,
      });
    });

    it('answers 404 for an unknown user, changing nothing', async () => {
      const { tx, service } = setup();
      tx.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.assignApps(ADMIN, USER, [APP])).rejects.toThrow('User not found');
      expect(tx.connectedApp.count).not.toHaveBeenCalled();
      expect(tx.userAppAssignment.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 409 for a removed account, changing nothing', async () => {
      const { tx, service } = setup('member', { disabledAt: DISABLED, removedAt: DISABLED });
      await expect(service.assignApps(ADMIN, USER, [APP])).rejects.toThrow(
        new ConflictException('The account was removed'),
      );
      expect(tx.connectedApp.count).not.toHaveBeenCalled();
      expect(tx.userAppAssignment.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 404 when an application is unknown or the system one, changing nothing', async () => {
      const { tx, prisma, service } = setup();
      tx.connectedApp.count.mockResolvedValueOnce(1);
      await expect(service.assignApps(ADMIN, USER, [APP, OTHER_APP])).rejects.toThrow(
        new NotFoundException('Application not found'),
      );
      expect(tx.userAppAssignment.deleteMany).not.toHaveBeenCalled();
      expect(tx.userAppAssignment.createMany).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
