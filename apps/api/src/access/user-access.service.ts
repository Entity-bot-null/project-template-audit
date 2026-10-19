import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ACCOUNT_REMOVED } from '../auth/auth.constants.js';
import { hashPassword } from '../auth/password.js';
import { lockUser, revokeSessionsLocked } from '../auth/sessions.service.js';
import type { Role } from '../common/types/request-user.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UserAccessResponse } from './dto/access.schemas.js';

type Tx = Prisma.TransactionClient;

/** 409: a change that would leave nobody who may administer Audit Hub. */
export const LAST_ADMIN = 'Audit Hub needs at least one administrator';
/** The name a removed account keeps, for the records that still name its id. */
export const REMOVED_NAME = 'Removed user';
/** The address a removed account keeps: unique, and never deliverable (RFC 2606). */
export const removedEmail = (id: string): string => `removed+${id}@users.invalid`;

/** What removing an account changed beyond the account itself. */
export interface Removal {
  /** Open alerts that were assigned to the person, now assigned to nobody. */
  alertsUnassigned: number;
}

// What a person may do and see in Audit Hub (docs/security.md#authorization):
// their role, and for auditors and viewers the applications assigned to them;
// whether their account may sign in; and its removal. A change that ends what
// was granted (a role change, disabling, removing) raises the account's
// securityVersion: its access tokens stop at once, and the next refresh
// brings the new role. Every change that could leave Audit Hub without an
// administrator who may sign in takes the same lock, so two of them cannot
// both pass the count.
@Injectable()
export class UserAccessService {
  private readonly logger = new Logger('Access');

  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserAccessResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        disabledAt: true,
        removedAt: true,
        mfaFactor: { select: { confirmedAt: true } },
        appAssignments: {
          select: { app: { select: { id: true, slug: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (user === null) throw new NotFoundException('User not found');
    return {
      userId: user.id,
      role: user.role,
      mfaConfirmedAt: user.mfaFactor?.confirmedAt?.toISOString() ?? null,
      disabledAt: user.disabledAt?.toISOString() ?? null,
      removedAt: user.removedAt?.toISOString() ?? null,
      apps: user.appAssignments.map(({ app }) => ({
        appId: app.id,
        slug: app.slug,
        name: app.name,
      })),
    };
  }

  /** Answers the previous role. Never leaves Audit Hub without an administrator. */
  async changeRole(adminId: string, userId: string, role: Role): Promise<Role> {
    const previous = await this.prisma.$transaction(async (tx) => {
      await lockAdministration(tx);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, disabledAt: true, removedAt: true },
      });
      if (user === null) throw new NotFoundException('User not found');
      if (user.removedAt !== null) throw new ConflictException(ACCOUNT_REMOVED);
      if (user.role === 'admin' && user.disabledAt === null && role !== 'admin') {
        await assertAnotherAdmin(tx, userId);
      }
      await lockUser(tx, userId);
      await tx.user.update({
        where: { id: userId },
        data: { role, securityVersion: { increment: 1 } },
      });
      return user.role;
    });
    this.logger.log(`Role of user ${userId} changed from ${previous} to ${role} by ${adminId}`);
    return previous;
  }

  /**
   * Disables an account, or enables it again; answers whether it changed.
   * Disabling ends every session and access token in the same transaction;
   * sign-in, refresh and the access-token guard refuse the account until it
   * is enabled. Nobody disables their own account, nor the last administrator
   * who may sign in.
   */
  async setDisabled(adminId: string, userId: string, disabled: boolean): Promise<boolean> {
    if (disabled && userId === adminId) {
      throw new ConflictException('You cannot disable your own account');
    }
    const changed = await this.prisma.$transaction(async (tx) => {
      await lockAdministration(tx);
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, disabledAt: true, removedAt: true },
      });
      if (user === null) throw new NotFoundException('User not found');
      if (user.removedAt !== null) throw new ConflictException(ACCOUNT_REMOVED);
      if ((user.disabledAt !== null) === disabled) return false;
      if (disabled && user.role === 'admin') await assertAnotherAdmin(tx, userId);
      await tx.user.update({
        where: { id: userId },
        data: disabled
          ? { disabledAt: new Date(), securityVersion: { increment: 1 } }
          : { disabledAt: null },
      });
      if (disabled) await revokeSessionsLocked(tx, userId);
      return true;
    });
    if (changed) {
      this.logger.log(`User ${userId} ${disabled ? 'disabled' : 'enabled'} by ${adminId}`);
    }
    return changed;
  }

  /**
   * Removes a person from Audit Hub (someone who left, a cancellation
   * request): the account keeps its id, so the records that name it (Audit
   * Hub's own log, alerts, holds, exports) still resolve, but nothing of the
   * person: the address and the name are replaced, the password with one
   * nobody knows, and the second factor, recovery codes, sessions, links,
   * unsent messages, assignments and the invitations they sent are deleted.
   * Open alerts assigned to them are assigned to nobody. The account stays
   * disabled for good. Nobody removes their own account, nor the last
   * administrator who may sign in.
   */
  async remove(adminId: string, userId: string): Promise<Removal> {
    if (userId === adminId) throw new ConflictException('You cannot remove your own account');
    // Hashed before the transaction, which holds the locks meanwhile.
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
    const removal = await this.prisma.$transaction(async (tx) => {
      await lockAdministration(tx);
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, disabledAt: true, removedAt: true },
      });
      if (user === null) throw new NotFoundException('User not found');
      if (user.removedAt !== null) throw new ConflictException(ACCOUNT_REMOVED);
      if (user.role === 'admin' && user.disabledAt === null) await assertAnotherAdmin(tx, userId);
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          email: removedEmail(userId),
          name: REMOVED_NAME,
          passwordHash,
          role: 'member',
          disabledAt: user.disabledAt ?? now,
          removedAt: now,
          securityVersion: { increment: 1 },
        },
      });
      await tx.session.deleteMany({ where: { userId } });
      await tx.mfaFactor.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaChallenge.deleteMany({ where: { userId } });
      await tx.accountToken.deleteMany({ where: { userId } });
      // A message on its way (sending) finishes, and then keeps no address.
      await tx.mailMessage.deleteMany({ where: { userId, status: { not: 'sending' } } });
      await tx.userAppAssignment.deleteMany({ where: { userId } });
      await tx.invitation.deleteMany({ where: { invitedById: userId } });
      return { alertsUnassigned: await unassignOpenAlerts(tx, adminId, userId) };
    });
    this.logger.log(`User ${userId} removed by ${adminId}`);
    return removal;
  }

  /** Replaces the applications an auditor or a viewer may see. */
  async assignApps(adminId: string, userId: string, appIds: string[]): Promise<UserAccessResponse> {
    const unique = [...new Set(appIds)];
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, removedAt: true },
      });
      if (user === null) throw new NotFoundException('User not found');
      if (user.removedAt !== null) throw new ConflictException(ACCOUNT_REMOVED);
      const known = await tx.connectedApp.count({ where: { id: { in: unique }, system: false } });
      if (known !== unique.length) throw new NotFoundException('Application not found');
      await tx.userAppAssignment.deleteMany({ where: { userId, appId: { notIn: unique } } });
      await tx.userAppAssignment.createMany({
        data: unique.map((appId) => ({ userId, appId, createdById: adminId })),
        skipDuplicates: true,
      });
    });
    this.logger.log(`Applications of user ${userId} set to ${String(unique.length)} by ${adminId}`);
    return this.get(userId);
  }
}

// Every change that may leave Audit Hub without an administrator who may sign
// in (a demotion, disabling, removing) takes this lock first, any instance.
async function lockAdministration(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('user-roles', 0))`;
}

/** 409 unless an administrator other than `userId` may sign in; under lockAdministration. */
async function assertAnotherAdmin(tx: Tx, userId: string): Promise<void> {
  const others = await tx.user.count({
    where: { role: 'admin', disabledAt: null, id: { not: userId } },
  });
  if (others === 0) throw new ConflictException(LAST_ADMIN);
}

// An alert still being worked on goes back to nobody, with the change in its
// history (and its version raised, as for any assignment): closed ones keep
// who worked on them.
async function unassignOpenAlerts(tx: Tx, adminId: string, userId: string): Promise<number> {
  const open = await tx.alert.findMany({
    where: { assigneeId: userId, status: { in: ['open', 'in_review'] } },
    select: { id: true },
  });
  if (open.length === 0) return 0;
  const ids = open.map((alert) => alert.id);
  await tx.alert.updateMany({
    where: { id: { in: ids } },
    data: { assigneeId: null, version: { increment: 1 } },
  });
  await tx.alertActivity.createMany({
    data: ids.map((alertId) => ({
      alertId,
      kind: 'assigned',
      userId: adminId,
      note: 'unassigned',
    })),
  });
  return ids.length;
}
