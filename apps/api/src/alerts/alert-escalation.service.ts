import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { errorSummary } from '../common/logging/error-summary.js';
import { env } from '../env/env.js';
import { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { slackMessage, teamsMessage } from '../webhooks/chat-messages.js';
import { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';

export const ESCALATION_INTERVAL_MS = 60_000;
const BATCH = 50;
const LOCK_KEY = 'alerts-escalation';

type Tx = Prisma.TransactionClient;

interface DueAlert {
  id: string;
  appId: string;
  rule: string;
  severity: string;
  title: string;
  escalations: number;
  maxEscalations: number;
  channels: string[];
}

// Escalation of the alerts nobody acknowledged (escalation_policies, per
// severity): an open alert without an acknowledgement, whose silence is not
// in force, is sent again after the policy's first delay, then at its
// interval, at most its number of times: email to the administrators and the
// application's auditors, and the chat channels, through the same durable
// outboxes as its first notification (retried, never sent twice). Its
// acknowledgement, a move to In review or its closing stops it; reopening it
// starts it over. Each escalation is in the alert's history, also when no
// channel could carry it. One instance at a time (an advisory lock), every
// minute.
@Injectable()
export class AlertEscalationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Escalation');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookOutboxService,
    private readonly mail: MailOutboxService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), ESCALATION_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.warn(`Escalation paused: ${errorSummary(error)}`);
    }
  }

  /** Escalates what is due at `now`; answers how many alerts. */
  async runOnce(now: Date = new Date()): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS "locked"`;
        if (lock?.locked !== true) return 0;
        const due = await tx.$queryRaw<DueAlert[]>`
          SELECT a."id", a."app_id" AS "appId", a."rule", a."severity"::text AS "severity", a."title",
                 a."escalations", p."max_escalations" AS "maxEscalations", p."channels"
          FROM "alerts" a
          JOIN "escalation_policies" p ON p."severity" = a."severity" AND p."enabled"
          WHERE a."status" = 'open' AND a."acknowledged_at" IS NULL
            AND a."escalations" < p."max_escalations"
            AND ${now} >= CASE WHEN a."escalations" = 0
                  THEN a."escalation_base_at" + make_interval(mins => p."first_after_minutes")
                  ELSE a."last_escalated_at" + make_interval(mins => p."repeat_every_minutes") END
            AND NOT EXISTS (
              SELECT 1 FROM "alert_mutes" m
              WHERE m."app_id" = a."app_id" AND (m."rule" IS NULL OR m."rule" = a."rule")
                AND m."until" > ${now} AND m."ended_at" IS NULL)
          ORDER BY a."escalation_base_at", a."id"
          LIMIT ${BATCH}
          FOR UPDATE OF a SKIP LOCKED`;
        for (const alert of due) await this.escalate(tx, alert, now);
        if (due.length > 0) this.logger.log(`Escalated ${String(due.length)} alert(s)`);
        return due.length;
      },
      { timeout: 60_000 },
    );
  }

  private async escalate(tx: Tx, alert: DueAlert, now: Date): Promise<void> {
    const n = alert.escalations + 1;
    const app = await tx.connectedApp.findUniqueOrThrow({
      where: { id: alert.appId },
      select: { slug: true, name: true },
    });
    const sent: string[] = [];
    if (alert.channels.includes('email') && this.mail.enabled) {
      const recipients = await tx.user.findMany({
        where: {
          disabledAt: null,
          OR: [
            { role: 'admin' },
            { role: 'auditor', appAssignments: { some: { appId: alert.appId } } },
          ],
        },
        select: { id: true, email: true },
      });
      for (const recipient of recipients) {
        await this.mail.enqueue(tx, {
          kind: 'security_alert',
          to: recipient.email,
          userId: recipient.id,
          payload: { alertId: alert.id, escalation: String(n) },
          dedupeKey: `security_alert:${alert.id}:escalation:${String(n)}:${recipient.id}`,
        });
      }
      if (recipients.length > 0) sent.push('email');
    }
    if (alert.channels.includes('chat')) {
      const message = {
        appSlug: app.slug,
        appName: app.name,
        rule: alert.rule,
        severity: alert.severity,
        title: `Still unacknowledged (reminder ${String(n)}): ${alert.title}`,
        ...(env.APP_ORIGIN === undefined ? {} : { url: `${env.APP_ORIGIN}/alerts/${alert.id}` }),
      };
      for (const target of this.webhooks.chatTargets) {
        const body = target === 'slack' ? slackMessage(message) : teamsMessage(message);
        await this.webhooks.toChat(target, 'alert.escalated', body, tx);
        sent.push(target);
      }
    }
    const of = `${String(n)} of ${String(alert.maxEscalations)}`;
    await tx.alert.update({
      where: { id: alert.id },
      data: { escalations: n, lastEscalatedAt: now },
    });
    await tx.alertActivity.create({
      data: {
        alertId: alert.id,
        kind: 'escalated',
        note:
          sent.length > 0
            ? `${of}, unacknowledged: ${sent.join(', ')}`
            : `${of}, unacknowledged: no channel to send it through (email off, no chat channel)`,
      },
    });
  }
}
