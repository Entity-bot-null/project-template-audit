import {
  ForbiddenException,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_TOKEN_TTL_SEC, normalizeEmail } from './auth.constants.js';
import type { AccessTokenPayload, AMR_VALUES, AuthSession, AuthUser } from './dto/auth.schemas.js';
import type { MfaChallengeResponse } from './mfa/dto/mfa.schemas.js';
import { MfaChallengesService } from './mfa/mfa-challenges.service.js';
import { mayUsePanel, NO_PANEL_ACCESS, PANEL_ACCESS_SELECT } from './panel-access.js';
import { checkPassword, dummyPasswordHash } from './password.js';
import { type IssuedSession, SessionsService } from './sessions.service.js';

export type Amr = (typeof AMR_VALUES)[number];

export interface SignInResult {
  /** The response body. */
  session: AuthSession;
  /** The refresh token, for the cookie only. */
  refresh: IssuedSession;
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
    private readonly challenges: MfaChallengesService,
    private readonly hubAudit: HubAuditService,
  ) {}

  // The dummy hash is built at boot: built on first use, the first sign-in with
  // an unknown email after every start would pay a hash on top of the verify,
  // a timing signal that the account does not exist. A failure here is retried
  // on first use instead of stopping the boot.
  async onModuleInit(): Promise<void> {
    await dummyPasswordHash().catch(() => undefined);
  }

  // One answer for an unknown email and a wrong password, in the same time
  // (an unknown email is checked against a dummy hash): the response never
  // reveals whether an account exists, nor whether it is disabled (refused
  // like a wrong password; the record says so). The right password of an
  // account that may not use the panel (a member, an auditor or a viewer
  // without an application: panel-access.ts) is told so at once, 403, before
  // any second factor. The password alone starts no session (docs/adr/0012):
  // it opens the second factor's step, to verify it or, the first time, to
  // set it up. The session this browser already had ends when the new one
  // starts (mfa.service.ts).
  async signIn(email: string, password: string, request?: Request): Promise<MfaChallengeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: {
        id: true,
        passwordHash: true,
        securityVersion: true,
        disabledAt: true,
        mfaFactor: { select: { confirmedAt: true } },
        ...PANEL_ACCESS_SELECT,
      },
    });
    const valid = await checkPassword(user?.passwordHash ?? (await dummyPasswordHash()), password);
    if (!user || !valid || user.disabledAt !== null) {
      // Audit Hub's own security event: the brute force rules read them.
      await this.hubAudit.recordQuietly({
        action: 'hub.session.sign_in_failed',
        outcome: 'failure',
        actor: { type: 'anonymous' },
        ...(user ? { resource: { type: 'user', id: user.id } } : {}),
        details: {
          stage: 'password',
          ...(user !== null && valid && user.disabledAt !== null ? { accountDisabled: true } : {}),
        },
        ...(request === undefined ? {} : { request }),
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!mayUsePanel(user)) {
      // Not a guess (the password was right): denied, and the record says why.
      await this.hubAudit.recordQuietly({
        action: 'hub.session.sign_in_failed',
        outcome: 'denied',
        actor: { type: 'anonymous' },
        resource: { type: 'user', id: user.id },
        details: { stage: 'password', noPanelAccess: true },
        ...(request === undefined ? {} : { request }),
      });
      throw new ForbiddenException(NO_PANEL_ACCESS);
    }
    const enrolled = user.mfaFactor?.confirmedAt != null;
    return this.challenges.create(user, enrolled ? 'verify' : 'enroll');
  }

  async refresh(token: string): Promise<SignInResult> {
    const { user, securityVersion, session } = await this.sessions.rotate(token);
    return { session: await this.sessionFor(user, securityVersion, ['mfa']), refresh: session };
  }

  logout(token: string): Promise<void> {
    return this.sessions.retire(token, 'logout');
  }

  // The access token carries the id, the role and the securityVersion, read
  // fresh from the database at sign-in and at every refresh: a role change
  // applies at the next refresh, at most ACCESS_TOKEN_TTL_SEC later; a new
  // password at once (the guard compares the securityVersion). Every session
  // passed a second factor (mfa); `reauthAt` only for the token a step-up
  // mints (docs/adr/0012).
  async sessionFor(
    user: AuthUser,
    securityVersion: number,
    amr: Amr[],
    reauthAt?: number,
  ): Promise<AuthSession> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      sv: securityVersion,
      mfa: true,
      amr,
      ...(reauthAt === undefined ? {} : { ra: reauthAt }),
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user,
    };
  }
}
