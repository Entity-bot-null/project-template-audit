import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { sha256Hex } from '../../common/utils/sha256.js';
import type { Prisma } from '../../prisma/generated/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { MfaChallengeResponse } from './dto/mfa.schemas.js';

export type ChallengePurpose = 'verify' | 'enroll';

/** How long the step between the password and the second factor lasts. */
export const CHALLENGE_TTL_SEC = 300;
export const CHALLENGE_MAX_ATTEMPTS = 5;

export interface TakenChallenge {
  id: string;
  userId: string;
  purpose: ChallengePurpose;
}

const invalid = () => new UnauthorizedException('Sign in again: this step expired or was used');

type Writer = Pick<Prisma.TransactionClient, 'mfaChallenge'>;

// The step between the password and the second factor (docs/adr/0012): 32
// random bytes the client holds, only their SHA-256 stored, single use, 5
// minutes, 5 attempts, bound to the account's securityVersion (a new password
// or a reset voids it), and void once the account is disabled.
@Injectable()
export class MfaChallengesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: { id: string; securityVersion: number },
    purpose: ChallengePurpose,
    tx: Writer = this.prisma,
  ): Promise<MfaChallengeResponse> {
    const token = randomBytes(32).toString('base64url');
    await tx.mfaChallenge.create({
      data: {
        userId: user.id,
        purpose,
        tokenHash: sha256Hex(token),
        securityVersion: user.securityVersion,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SEC * 1000),
      },
    });
    return { mfa: purpose, challengeToken: token, expiresIn: CHALLENGE_TTL_SEC };
  }

  /** A live challenge for one of `purposes`; 401 otherwise (the client signs in again). */
  async take(token: string, purposes: readonly ChallengePurpose[]): Promise<TakenChallenge> {
    const row = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: { select: { securityVersion: true, disabledAt: true } } },
    });
    if (
      row?.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      row.attempts >= CHALLENGE_MAX_ATTEMPTS ||
      row.user.securityVersion !== row.securityVersion ||
      row.user.disabledAt !== null ||
      !purposes.includes(row.purpose as ChallengePurpose)
    ) {
      throw invalid();
    }
    return { id: row.id, userId: row.userId, purpose: row.purpose as ChallengePurpose };
  }

  /** A wrong code spends an attempt; the last one ends the challenge. */
  async failed(challenge: TakenChallenge): Promise<void> {
    await this.prisma.mfaChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { attempts: { increment: 1 } },
    });
  }

  /** Spends the challenge; false when another request already did (a race). */
  async consume(challenge: TakenChallenge, tx: Writer = this.prisma): Promise<boolean> {
    const { count } = await tx.mfaChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, attempts: { lt: CHALLENGE_MAX_ATTEMPTS } },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  /** Expired challenges are dead weight: swept with the sessions. */
  async sweep(now: number = Date.now()): Promise<number> {
    const { count } = await this.prisma.mfaChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(now - 3_600_000) } },
    });
    return count;
  }
}
