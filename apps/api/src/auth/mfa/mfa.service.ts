import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SecretBox } from '../../common/crypto/secret-box.js';
import type { RequestUser } from '../../common/types/request-user.js';
import { HubAuditService } from '../../hub-audit/hub-audit.service.js';
import { MailOutboxService } from '../../infrastructure/mail/mail-outbox.service.js';
import type { Prisma } from '../../prisma/generated/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ACCOUNT_REMOVED } from '../auth.constants.js';
import { type Amr, AuthService, type SignInResult } from '../auth.service.js';
import type { AuthSession } from '../dto/auth.schemas.js';
import { mayUsePanel, NO_PANEL_ACCESS, PANEL_ACCESS_SELECT } from '../panel-access.js';
import { checkPassword } from '../password.js';
import { lockUser, revokeSessionsLocked, SessionsService } from '../sessions.service.js';
import type { MfaEnrollment } from './dto/mfa.schemas.js';
import { MfaChallengesService, type TakenChallenge } from './mfa-challenges.service.js';
import { MFA_PEPPERS, type MfaPeppers } from './mfa.constants.js';
import {
  acceptedStep,
  enrollmentOf,
  newRecoveryCodes,
  normalizeRecoveryCode,
  recoveryCodeHash,
  SECRET_BYTES,
} from './totp.js';

export type MfaChange = 'enrolled' | 'recovery_code_used' | 'recovery_codes_regenerated' | 'reset';

const factorContext = (userId: string) => `mfa_factors:${userId}`;
const wrongCode = () => new UnauthorizedException('The code is wrong or was already used');

/** Rolls back a recovery code's transaction, saying why (spendRecoveryCode). */
class NotSpent extends Error {
  constructor(readonly outcome: 'wrong' | 'expired') {
    super(outcome);
  }
}

type Tx = Prisma.TransactionClient;

// Second factors (docs/adr/0012): every account signs in with a TOTP code
// (or a recovery code) after its password, sets one up the first time, and
// confirms both again (step-up) before a sensitive action. Secrets are
// AES-256-GCM ciphertexts (AUDIT_SECRETS_KEY); a code works once
// (lastUsedStep); recovery codes are HMACs. Every step is an event of Audit
// Hub's own audit log, and a change a person did not make reaches them by
// email (mfa_changed).
@Injectable()
export class MfaService {
  private readonly logger = new Logger('Mfa');

  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: MfaChallengesService,
    private readonly sessions: SessionsService,
    private readonly auth: AuthService,
    private readonly box: SecretBox,
    private readonly mail: MailOutboxService,
    private readonly hubAudit: HubAuditService,
    @Inject(MFA_PEPPERS) private readonly peppers: MfaPeppers,
  ) {}

  /** The second factor after the password: a code, or a recovery code once. */
  async verify(
    token: string,
    input: { code?: string; recoveryCode?: string },
    request: Request,
    previousToken?: string,
  ): Promise<SignInResult> {
    const challenge = await this.challenges.take(token, ['verify']);
    const factor = await this.prisma.mfaFactor.findUnique({ where: { userId: challenge.userId } });
    if (factor?.confirmedAt == null) throw new UnauthorizedException('Sign in again');

    let amr: Amr[];
    if (input.code !== undefined) {
      const step = acceptedStep(this.secretOf(factor), input.code, factor.lastUsedStep);
      if (
        step === undefined ||
        !(await this.useStep(challenge.userId, factor.lastUsedStep, step))
      ) {
        await this.refuse(challenge, request);
        throw wrongCode();
      }
      amr = ['pwd', 'otp'];
    } else {
      const spent = await this.spendRecoveryCode(challenge, input.recoveryCode ?? '');
      if (spent === 'expired') throw new UnauthorizedException('Sign in again');
      if (spent === 'wrong') {
        await this.refuse(challenge, request);
        throw wrongCode();
      }
      amr = ['pwd', 'rcv'];
    }
    const result = await this.startSession(challenge, amr, previousToken, amr.includes('rcv'));
    if (amr.includes('rcv')) {
      await this.notify(challenge.userId, 'recovery_code_used');
      await this.hubAudit.recordQuietly({
        action: 'hub.mfa.recovery_code_used',
        actor: this.actorOf(result),
        request,
      });
    }
    await this.hubAudit.recordQuietly({
      action: 'hub.session.signed_in',
      actor: this.actorOf(result),
      details: { method: amr.includes('rcv') ? 'recovery_code' : 'totp' },
      request,
    });
    return result;
  }

  /** The first time: a new secret, until a code confirms it (replaced by each start). */
  async startEnrollment(token: string): Promise<MfaEnrollment> {
    const challenge = await this.challenges.take(token, ['enroll']);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: challenge.userId },
      select: { email: true, mfaFactor: { select: { confirmedAt: true } } },
    });
    if (user.mfaFactor?.confirmedAt != null) {
      throw new ConflictException('A second factor is set up already: sign in with it');
    }
    const secret = randomBytes(SECRET_BYTES);
    const sealed = this.box.seal(secret, factorContext(challenge.userId));
    await this.prisma.mfaFactor.upsert({
      where: { userId: challenge.userId },
      create: { userId: challenge.userId, secret: sealed.ciphertext, encKeyId: sealed.keyId },
      update: { secret: sealed.ciphertext, encKeyId: sealed.keyId, lastUsedStep: null },
    });
    return enrollmentOf(secret, user.email);
  }

  /** A code from the new factor confirms it: recovery codes are made, the session starts. */
  async confirmEnrollment(
    token: string,
    code: string,
    request: Request,
    previousToken?: string,
  ): Promise<SignInResult & { recoveryCodes: string[] }> {
    const challenge = await this.challenges.take(token, ['enroll']);
    const factor = await this.prisma.mfaFactor.findUnique({ where: { userId: challenge.userId } });
    if (factor?.confirmedAt !== null) {
      throw new ConflictException('Start the set-up again');
    }
    const step = acceptedStep(this.secretOf(factor), code, factor.lastUsedStep);
    if (step === undefined) {
      await this.refuse(challenge, request);
      throw wrongCode();
    }
    // An account that lost its way into the panel since (panel-access.ts)
    // sets nothing up: no factor, no recovery codes it would never see.
    // Starting the session checks again, under the account's lock.
    const access = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: PANEL_ACCESS_SELECT,
    });
    if (access !== null && !mayUsePanel(access)) throw new ForbiddenException(NO_PANEL_ACCESS);
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.mfaFactor.updateMany({
        where: { userId: challenge.userId, confirmedAt: null, secret: factor.secret },
        data: { confirmedAt: new Date(), lastUsedStep: step },
      });
      if (count === 0) throw new ConflictException('Start the set-up again');
      await this.storeRecoveryCodes(tx, challenge.userId, recoveryCodes);
    });
    const result = await this.startSession(challenge, ['pwd', 'otp'], previousToken);
    await this.notify(challenge.userId, 'enrolled');
    await this.hubAudit.recordQuietly({
      action: 'hub.mfa.enrolled',
      actor: this.actorOf(result),
      request,
    });
    await this.hubAudit.recordQuietly({
      action: 'hub.session.signed_in',
      actor: this.actorOf(result),
      details: { method: 'totp' },
      request,
    });
    this.logger.log(`Second factor set up by user ${challenge.userId}`);
    return { ...result, recoveryCodes };
  }

  /**
   * Recent authentication (docs/adr/0012): the password and a code again,
   * for a new access token that says so (ra). Refused with 403, not 401: the
   * session is fine, the confirmation is not.
   */
  async stepUp(
    user: RequestUser,
    password: string,
    code: string,
    request: Request,
  ): Promise<AuthSession> {
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        securityVersion: true,
        mfaFactor: true,
      },
    });
    if (account === null) throw new NotFoundException('User not found');
    const factor = account.mfaFactor;
    const passwordOk = await checkPassword(account.passwordHash, password);
    const step =
      factor?.confirmedAt == null
        ? undefined
        : acceptedStep(this.secretOf(factor), code, factor.lastUsedStep);
    if (
      !passwordOk ||
      factor === null ||
      step === undefined ||
      !(await this.useStep(user.id, factor.lastUsedStep, step))
    ) {
      await this.hubAudit.recordQuietly({
        action: 'hub.session.sign_in_failed',
        outcome: 'failure',
        actor: { type: 'user', id: user.id, role: user.role },
        details: { stage: 'second_factor' },
        request,
      });
      throw new ForbiddenException('The password or the code is wrong');
    }
    await this.hubAudit.recordQuietly({
      action: 'hub.session.stepped_up',
      actor: { type: 'user', id: user.id, role: account.role },
      request,
    });
    return this.auth.sessionFor(
      { id: account.id, email: account.email, name: account.name, role: account.role },
      account.securityVersion,
      ['pwd', 'otp'],
      Math.floor(Date.now() / 1000),
    );
  }

  async status(userId: string): Promise<{ confirmedAt: string | null; recoveryCodesLeft: number }> {
    const [factor, left] = await Promise.all([
      this.prisma.mfaFactor.findUnique({ where: { userId }, select: { confirmedAt: true } }),
      this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
    return { confirmedAt: factor?.confirmedAt?.toISOString() ?? null, recoveryCodesLeft: left };
  }

  /** New recovery codes; the old ones stop working (after a step-up). */
  async regenerateRecoveryCodes(user: RequestUser, request: Request): Promise<string[]> {
    const codes = newRecoveryCodes();
    await this.prisma.$transaction((tx) => this.storeRecoveryCodes(tx, user.id, codes));
    await this.notify(user.id, 'recovery_codes_regenerated');
    await this.hubAudit.recordQuietly({
      action: 'hub.mfa.recovery_codes_regenerated',
      actor: { type: 'user', id: user.id, role: user.role },
      request,
    });
    return codes;
  }

  /**
   * An administrator resets someone's second factor (a lost phone and no
   * recovery codes): the person sets up a new one at their next sign-in.
   * Every session of theirs ends.
   */
  async reset(
    admin: RequestUser,
    userId: string,
    reason: string,
    request?: Request,
  ): Promise<void> {
    if (admin.id === userId) {
      throw new ForbiddenException('Reset your own second factor with a recovery code instead');
    }
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, removedAt: true },
      });
      if (target === null) throw new NotFoundException('User not found');
      // Nothing to reset, and no address to tell.
      if (target.removedAt !== null) throw new ConflictException(ACCOUNT_REMOVED);
      await lockUser(tx, userId);
      await tx.mfaFactor.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { securityVersion: { increment: 1 } } });
      await revokeSessionsLocked(tx, userId);
    });
    await this.notify(userId, 'reset');
    await this.hubAudit.recordQuietly({
      action: 'hub.mfa.reset',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'user', id: userId },
      details: { reason },
      ...(request === undefined ? {} : { request }),
    });
    this.logger.warn(`Second factor of user ${userId} reset by ${admin.id}`);
  }

  private async startSession(
    challenge: TakenChallenge,
    amr: Amr[],
    previousToken: string | undefined,
    consumed = false,
  ): Promise<SignInResult> {
    if (!consumed && !(await this.challenges.consume(challenge)))
      throw new UnauthorizedException('Sign in again');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: challenge.userId },
      select: { id: true, email: true, name: true, role: true, passwordHash: true },
    });
    const { passwordHash, ...authUser } = user;
    if (previousToken !== undefined) await this.sessions.retire(previousToken, 'sign-in');
    const refresh = await this.sessions.create(user.id, passwordHash, new Date());
    return { session: await this.auth.sessionFor(authUser, refresh.securityVersion, amr), refresh };
  }

  /** Records the step a code used; false when a concurrent request used it first. */
  private async useStep(userId: string, last: bigint | null, step: bigint): Promise<boolean> {
    const { count } = await this.prisma.mfaFactor.updateMany({
      where: { userId, lastUsedStep: last },
      data: { lastUsedStep: step },
    });
    return count === 1;
  }

  /**
   * Spends the challenge and the recovery code together: a request that loses
   * the race for the challenge never costs one of the ten codes, and a wrong
   * code leaves the challenge to the attempts that remain.
   */
  private async spendRecoveryCode(
    challenge: TakenChallenge,
    input: string,
  ): Promise<'spent' | 'wrong' | 'expired'> {
    const normalized = normalizeRecoveryCode(input);
    if (normalized === undefined) return 'wrong';
    // The current pepper, then the previous one during an AUDIT_SECRETS_KEY rotation.
    const hashes = this.peppers.map((pepper) => recoveryCodeHash(pepper, normalized));
    try {
      await this.prisma.$transaction(async (tx) => {
        if (!(await this.challenges.consume(challenge, tx))) throw new NotSpent('expired');
        const { count } = await tx.mfaRecoveryCode.updateMany({
          where: { userId: challenge.userId, codeHash: { in: hashes }, usedAt: null },
          data: { usedAt: new Date() },
        });
        // Thrown to roll the challenge back with it.
        if (count !== 1) throw new NotSpent('wrong');
      });
      return 'spent';
    } catch (error) {
      if (error instanceof NotSpent) return error.outcome;
      throw error;
    }
  }

  private async storeRecoveryCodes(tx: Tx, userId: string, codes: string[]): Promise<void> {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    const pepper = this.peppers[0];
    if (pepper === undefined) throw new Error('No recovery code pepper');
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: recoveryCodeHash(pepper, normalizeRecoveryCode(code) ?? code),
      })),
    });
  }

  private async refuse(challenge: TakenChallenge, request: Request): Promise<void> {
    await this.challenges.failed(challenge);
    await this.hubAudit.recordQuietly({
      action: 'hub.session.sign_in_failed',
      outcome: 'failure',
      actor: { type: 'anonymous' },
      resource: { type: 'user', id: challenge.userId },
      details: { stage: 'second_factor' },
      request,
    });
  }

  private async notify(userId: string, change: MfaChange): Promise<void> {
    if (!this.mail.enabled) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user === null) return;
    await this.prisma.$transaction(async (tx) => {
      await this.mail.enqueue(tx, {
        kind: 'mfa_changed',
        to: user.email,
        userId,
        payload: { change, at: new Date().toISOString() },
      });
    });
    this.mail.notifyQueued();
  }

  private secretOf(factor: { userId: string; secret: Uint8Array }): Uint8Array {
    return this.box.open(factor.secret, factorContext(factor.userId));
  }

  private actorOf(result: SignInResult) {
    return { type: 'user' as const, id: result.session.user.id, role: result.session.user.role };
  }
}
