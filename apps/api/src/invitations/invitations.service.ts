import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { hashAccountToken } from '../auth/account-tokens.js';
import { normalizeEmail } from '../auth/auth.constants.js';
import type { MfaChallengeResponse } from '../auth/mfa/dto/mfa.schemas.js';
import { MfaChallengesService } from '../auth/mfa/mfa-challenges.service.js';
import type { AuthUser } from '../auth/dto/auth.schemas.js';
import { hashPassword } from '../auth/password.js';
import { passwordProblem } from '../auth/password-policy.js';
import type { Page, PageQuery } from '../common/pagination.js';
import type { Role } from '../common/types/request-user.js';
import { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import type { InvitationPayload } from '../infrastructure/mail/templates/invitation.template.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateInvitationDto, InvitationResponse } from './dto/invitation.schemas.js';

const ACCOUNT_TRANSACTION = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

/** One answer for every link that does not work: unknown, replaced, revoked, used or expired. */
export const INVALID_INVITATION = 'This invitation is invalid or has expired';
export const ACCOUNT_EXISTS = 'An account with this address exists';
export const HELD_BACK =
  'This address got a message moments ago (or several today): invite it again later';

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  expiresAt: true,
  invitedBy: { select: { id: true, name: true } },
  apps: {
    select: { app: { select: { id: true, slug: true, name: true } } },
    orderBy: { app: { name: 'asc' } },
  },
} as const;

/** The invitation's message was held back (per-address limits): its replacement is rolled back. */
class HeldBack extends Error {}

// Administrators invite people to create an account with a given role
// (docs/security.md#invitations). No account exists until the invitation is
// accepted, with the link sent to the address, by a person who chooses their
// own name and password; the role is the administrator's choice and cannot
// be changed on the way. Inviting an address again replaces its invitation
// and link; revoking deletes it.
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailOutboxService,
    private readonly challenges: MfaChallengesService,
  ) {}

  /** Invitations can be sent: email is configured. */
  get available(): boolean {
    return this.mail.enabled;
  }

  /**
   * Invites an address (administrators only: the controller's guard). An
   * address with an account answers 409 (administrators see every account
   * anyway); one that got a message moments ago, 429, and nothing changes.
   */
  async invite(
    adminId: string,
    { email, role, appIds }: CreateInvitationDto,
  ): Promise<InvitationResponse> {
    if (!this.available) throw new ServiceUnavailableException('Invitations are not available');
    const address = normalizeEmail(email);
    const unique = [...new Set(appIds)];
    let invitation: InvitationRow;
    try {
      invitation = await this.prisma.$transaction(async (tx) => {
        // Invitations of one address, one at a time (any instance).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invitation:${address}`}, 0))`;
        const account = await tx.user.findUnique({
          where: { email: address },
          select: { id: true },
        });
        if (account !== null) throw new ConflictException(ACCOUNT_EXISTS);
        // Applications that can be assigned: not Audit Hub's own, still in service.
        const known = await tx.connectedApp.count({
          where: { id: { in: unique }, system: false, status: { not: 'retired' } },
        });
        if (known !== unique.length) throw new NotFoundException('Application not found');
        await tx.invitation.deleteMany({ where: { email: address } });
        const created = await tx.invitation.create({
          data: {
            email: address,
            role,
            invitedById: adminId,
            apps: { create: unique.map((appId) => ({ appId })) },
          },
          select: INVITATION_SELECT,
        });
        const payload: InvitationPayload = { invitationId: created.id };
        const result = await this.mail.enqueue(tx, { kind: 'invitation', to: address, payload });
        if (result !== 'queued') throw new HeldBack();
        return created;
      }, ACCOUNT_TRANSACTION);
    } catch (error) {
      if (error instanceof HeldBack)
        throw new HttpException(HELD_BACK, HttpStatus.TOO_MANY_REQUESTS);
      throw error;
    }
    this.mail.notifyQueued();
    this.logger.log(
      `Invitation ${invitation.id} (${role}, ${String(unique.length)} applications) sent by admin ${adminId}`,
    );
    return toResponse(invitation);
  }

  /** Pending invitations, newest first. */
  async list({ limit, offset }: PageQuery): Promise<Page<InvitationResponse>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invitation.findMany({
        select: INVITATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.invitation.count(),
    ]);
    return { items: rows.map(toResponse), total };
  }

  /** Deletes an invitation: its link stops working at once. */
  async revoke(adminId: string, id: string): Promise<void> {
    const { count } = await this.prisma.invitation.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Invitation not found');
    this.logger.log(`Invitation ${id} revoked by admin ${adminId}`);
  }

  /**
   * Creates the account of an invitation with its link's token, the name and
   * the password the person chooses (the policy first: a refused password
   * keeps the link), with the invitation's role, and answers the challenge to
   * set up its second factor: the session starts once it is confirmed
   * (docs/adr/0012).
   */
  async accept(
    token: string,
    name: string,
    password: string,
    now = Date.now(),
  ): Promise<MfaChallengeResponse> {
    const tokenHash = hashAccountToken(token);
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      select: { id: true, email: true, expiresAt: true },
    });
    if (invitation?.expiresAt == null || invitation.expiresAt.getTime() <= now) {
      throw new NotFoundException(INVALID_INVITATION);
    }
    const problem = passwordProblem(password, { email: invitation.email, name });
    if (problem !== undefined) throw new BadRequestException(`password: ${problem}`);
    // Hashed before the transaction, which holds the invitation's lock meanwhile.
    const passwordHash = await hashPassword(password);

    let user: AuthUser;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        // The address's lock, as when inviting: a new invitation for it
        // cannot be created alongside this acceptance.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invitation:${invitation.email}`}, 0))`;
        // Still this invitation, with this link (not replaced, revoked or
        // used), and still vouched for: whoever sent it must still be an
        // administrator who may sign in (an invitation outlives a demotion,
        // disabling or removal otherwise, with the role it grants).
        const rows = await tx.$queryRaw<
          { role: Role; invitedById: string | null; inviterRole: Role | null }[]
        >`
          SELECT i."role", i."invited_by_id" AS "invitedById", u."role" AS "inviterRole"
          FROM "invitations" i
          LEFT JOIN "users" u ON u."id" = i."invited_by_id" AND u."disabled_at" IS NULL
          WHERE i."id" = ${invitation.id}::uuid AND i."token_hash" = ${tokenHash}
          FOR UPDATE OF i`;
        const locked = rows[0];
        if (locked?.inviterRole !== 'admin') throw new NotFoundException(INVALID_INVITATION);
        // And it must still open the panel (auth/panel-access.ts): an
        // auditor's or a viewer's applications may have been retired since,
        // and a member, invited before members stopped being invited, never
        // could sign in. The administrator sees it pending, and invites again.
        const apps =
          locked.role === 'admin'
            ? []
            : await tx.invitationApp.findMany({
                where: {
                  invitationId: invitation.id,
                  app: { system: false, status: { not: 'retired' } },
                },
                select: { appId: true },
              });
        if (locked.role === 'member' || (locked.role !== 'admin' && apps.length === 0)) {
          throw new NotFoundException(INVALID_INVITATION);
        }
        await tx.invitation.delete({ where: { id: invitation.id } });
        const created = await tx.user.create({
          data: { email: invitation.email, name, role: locked.role, passwordHash },
          select: { id: true, email: true, name: true, role: true },
        });
        if (apps.length > 0) {
          await tx.userAppAssignment.createMany({
            data: apps.map(({ appId }) => ({
              userId: created.id,
              appId,
              createdById: locked.invitedById,
            })),
          });
        }
        return created;
      }, ACCOUNT_TRANSACTION);
    } catch (error) {
      // users.email is unique: an account appeared for the address meanwhile.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(ACCOUNT_EXISTS);
      }
      throw error;
    }
    this.logger.log(`Account ${user.id} (${user.role}) created from invitation ${invitation.id}`);
    // No session yet: the account sets up its second factor first (docs/adr/0012).
    return this.challenges.create({ id: user.id, securityVersion: 0 }, 'enroll');
  }
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  expiresAt: Date | null;
  invitedBy: { id: string; name: string } | null;
  apps: { app: { id: string; slug: string; name: string } }[];
}

function toResponse(row: InvitationRow): InvitationResponse {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    apps: row.apps.map(({ app }) => ({ appId: app.id, slug: app.slug, name: app.name })),
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
