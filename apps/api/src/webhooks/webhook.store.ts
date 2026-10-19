import { Injectable } from '@nestjs/common';
import type { Prisma, WebhookTarget } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WEBHOOK_LEASE_MS, WEBHOOK_RETENTION_DAYS } from './webhooks.constants.js';

const DAY_MS = 86_400_000;

export interface ClaimedDelivery {
  id: string;
  appId: string | null;
  target: WebhookTarget;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface WebhookOutboxStats {
  waiting: number;
  oldestAgeSeconds: number;
}

type Claim = Pick<ClaimedDelivery, 'id' | 'attempts'>;

// The delivery state of the webhook outbox, as MailStore keeps the mail's
// (ADR 0003 of the template, docs/adr/0013): a claim is one statement with a
// lease and SKIP LOCKED, and every transition after it is fenced by that claim.
@Injectable()
export class WebhookStore {
  constructor(private readonly prisma: PrismaService) {}

  async claim(leaseMs: number = WEBHOOK_LEASE_MS): Promise<ClaimedDelivery | undefined> {
    const rows = await this.prisma.$queryRaw<ClaimedDelivery[]>`
      UPDATE "webhook_deliveries"
      SET "status" = 'sending',
          "attempts" = "attempts" + 1,
          "locked_until" = now() + make_interval(secs => ${leaseMs / 1000}::double precision),
          "updated_at" = now()
      WHERE "id" = (
        SELECT "id" FROM "webhook_deliveries"
        WHERE ("status" = 'pending' AND "next_attempt_at" <= now())
           OR ("status" = 'sending' AND "locked_until" < now())
        ORDER BY "next_attempt_at", "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "app_id" AS "appId", "target", "type", "payload", "attempts",
                "expires_at" AS "expiresAt", "created_at" AS "createdAt"`;
    return rows[0];
  }

  markDelivered(claim: Claim, status: number): Promise<boolean> {
    return this.finish(claim, {
      status: 'delivered',
      deliveredAt: new Date(),
      lockedUntil: null,
      lastStatus: status,
      lastError: null,
    });
  }

  reschedule(claim: Claim, delayMs: number, status: number | null, category: string) {
    return this.finish(claim, {
      status: 'pending',
      nextAttemptAt: new Date(Date.now() + delayMs),
      lockedUntil: null,
      lastStatus: status,
      lastError: category,
    });
  }

  markFailed(claim: Claim, status: number | null, category: string): Promise<boolean> {
    return this.finish(claim, {
      status: 'failed',
      lockedUntil: null,
      lastStatus: status,
      lastError: category,
    });
  }

  markExpired(claim: Claim, reason: string): Promise<boolean> {
    return this.finish(claim, { status: 'expired', lockedUntil: null, lastError: reason });
  }

  async stats(): Promise<WebhookOutboxStats> {
    const { _count, _min } = await this.prisma.webhookDelivery.aggregate({
      where: { status: { in: ['pending', 'sending'] } },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    const oldest = _min.createdAt;
    return {
      waiting: _count._all,
      oldestAgeSeconds: oldest === null ? 0 : Math.max(0, (Date.now() - oldest.getTime()) / 1000),
    };
  }

  /** Finished deliveries go after 30 days; pending ones a day past their validity expire. */
  async sweep(now: number = Date.now()): Promise<{ deleted: number; expired: number }> {
    const { count: expired } = await this.prisma.webhookDelivery.updateMany({
      where: { status: 'pending', expiresAt: { lt: new Date(now - DAY_MS) } },
      data: { status: 'expired', lastError: 'expired' },
    });
    const { count: deleted } = await this.prisma.webhookDelivery.deleteMany({
      where: {
        status: { in: ['delivered', 'expired', 'failed'] },
        createdAt: { lt: new Date(now - WEBHOOK_RETENTION_DAYS * DAY_MS) },
      },
    });
    return { deleted, expired };
  }

  private async finish(claim: Claim, data: Prisma.WebhookDeliveryUpdateManyMutationInput) {
    const { count } = await this.prisma.webhookDelivery.updateMany({
      where: { id: claim.id, status: 'sending', attempts: claim.attempts },
      data,
    });
    return count === 1;
  }
}
