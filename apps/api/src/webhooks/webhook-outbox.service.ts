import { Injectable } from '@nestjs/common';
import { CONTRACT_VERSION, uuidv7, type WebhookType } from 'audit-contract';
import { nodeRandomFill } from 'audit-contract/node';
import { env } from '../env/env.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WEBHOOK_TTL_MS } from './webhooks.constants.js';

export type ChatTarget = 'slack' | 'teams';

export interface AppWebhook {
  appId: string;
  type: WebhookType;
  data: Record<string, unknown>;
  /** Default 24 h. */
  ttlMs?: number;
}

type Writer = Pick<Prisma.TransactionClient, 'webhookDelivery'>;

// Queues webhooks (docs/adr/0013): written in the transaction that calls for
// them, so an alert or a response action never exists without its delivery,
// and none is sent for one that was rolled back. The worker signs and sends.
@Injectable()
export class WebhookOutboxService {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly prisma: PrismaService) {}

  /** Chat channels configured (AUDIT_SLACK_WEBHOOK_URL, AUDIT_TEAMS_WEBHOOK_URL). */
  get chatTargets(): ChatTarget[] {
    const targets: ChatTarget[] = [];
    if (env.AUDIT_SLACK_WEBHOOK_URL !== undefined) targets.push('slack');
    if (env.AUDIT_TEAMS_WEBHOOK_URL !== undefined) targets.push('teams');
    return targets;
  }

  /** The worker listens: a queued delivery wakes it after the caller's commit. */
  onQueued(listener: () => void): void {
    this.listeners.add(listener);
  }

  /**
   * A webhook to an application, when it has a webhook URL; the delivery's id
   * is the envelope's id (Audit-Webhook-Id). Answers the id, or undefined
   * when the application receives no webhooks.
   */
  async toApp(input: AppWebhook, tx: Writer = this.prisma): Promise<string | undefined> {
    const app = await this.prisma.connectedApp.findFirst({
      where: { id: input.appId, system: false },
      select: { webhookUrl: true, webhookSecret: true },
    });
    if (app?.webhookUrl == null || app.webhookSecret === null) return undefined;
    const id = uuidv7(nodeRandomFill);
    const now = new Date();
    await tx.webhookDelivery.create({
      data: {
        id,
        appId: input.appId,
        target: 'app',
        type: input.type,
        payload: {
          id,
          type: input.type,
          createdAt: now.toISOString(),
          contractVersion: CONTRACT_VERSION,
          data: input.data,
        } as Prisma.InputJsonObject,
        expiresAt: new Date(now.getTime() + (input.ttlMs ?? WEBHOOK_TTL_MS)),
      },
    });
    this.notify();
    return id;
  }

  /**
   * A message to a chat channel, as its incoming webhook expects it
   * (chat-messages.ts). Not an application's delivery: no app_id
   * (webhook_deliveries_check).
   */
  async toChat(
    target: ChatTarget,
    type: string,
    body: object,
    tx: Writer = this.prisma,
  ): Promise<string> {
    const id = uuidv7(nodeRandomFill);
    await tx.webhookDelivery.create({
      data: {
        id,
        appId: null,
        target,
        type,
        payload: body,
        expiresAt: new Date(Date.now() + WEBHOOK_TTL_MS),
      },
    });
    this.notify();
    return id;
  }

  private notify(): void {
    // After the caller's transaction commits, in the usual case: the worker
    // finds nothing yet otherwise, and its poll picks the delivery up.
    setImmediate(() => {
      for (const listener of this.listeners) listener();
    });
  }
}
