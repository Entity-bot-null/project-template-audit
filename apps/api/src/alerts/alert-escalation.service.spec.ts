import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import { AlertEscalationService } from './alert-escalation.service.js';

const ALERT = '0199e0b1-0000-7000-8000-0000000000a9';
const APP = '0199e0b1-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-10-20T10:00:00.000Z');

const due = (overrides: Record<string, unknown> = {}) => ({
  id: ALERT,
  appId: APP,
  rule: 'credential_stuffing',
  severity: 'critical',
  title: 'Sign-ins of 12 accounts failing from one address in 15 minutes',
  escalations: 0,
  maxEscalations: 3,
  channels: ['email', 'chat'],
  ...overrides,
});

function setup(rows: unknown[] = [due()], locked = true) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValueOnce([{ locked }]).mockResolvedValueOnce(rows),
    connectedApp: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ slug: 'shop', name: 'Shop' })),
    },
    user: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 'u1', email: 'admin@example.com' },
          { id: 'u2', email: 'auditor@example.com' },
        ]),
      ),
    },
    alert: { update: vi.fn((_args: unknown) => Promise.resolve({})) },
    alertActivity: {
      create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const webhooks = {
    chatTargets: ['slack'] as ('slack' | 'teams')[],
    toChat: vi.fn((..._args: unknown[]) => Promise.resolve('d1')),
  };
  const mail = {
    enabled: true,
    enqueue: vi.fn((..._args: unknown[]) => Promise.resolve('queued')),
  };
  const service = new AlertEscalationService(
    prisma as unknown as PrismaService,
    webhooks as unknown as WebhookOutboxService,
    mail as unknown as MailOutboxService,
  );
  return { tx, webhooks, mail, service };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('AlertEscalationService', () => {
  it('sends a due alert again by email and chat, counts it and says so in its history', async () => {
    const { tx, webhooks, mail, service } = setup();
    await expect(service.runOnce(NOW)).resolves.toBe(1);
    expect(mail.enqueue).toHaveBeenCalledTimes(2);
    expect(mail.enqueue.mock.calls[0]?.[1]).toMatchObject({
      kind: 'security_alert',
      payload: { alertId: ALERT, escalation: '1' },
      dedupeKey: `security_alert:${ALERT}:escalation:1:u1`,
    });
    expect(webhooks.toChat).toHaveBeenCalledWith(
      'slack',
      'alert.escalated',
      expect.objectContaining({
        text: expect.stringContaining('Still unacknowledged (reminder 1)') as unknown,
      }),
      tx,
    );
    expect(tx.alert.update).toHaveBeenCalledWith({
      where: { id: ALERT },
      data: { escalations: 1, lastEscalatedAt: NOW },
    });
    expect(tx.alertActivity.create).toHaveBeenCalledWith({
      data: { alertId: ALERT, kind: 'escalated', note: '1 of 3, unacknowledged: email, slack' },
    });
  });

  it("asks the database for what is due: open, unacknowledged, not silenced, under the policy's limit", async () => {
    const { tx, service } = setup([]);
    await service.runOnce(NOW);
    const sql = (tx.$queryRaw.mock.calls[1]?.[0] as string[]).join('?');
    expect(sql).toContain(`a."status" = 'open' AND a."acknowledged_at" IS NULL`);
    expect(sql).toContain(`a."escalations" < p."max_escalations"`);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('FOR UPDATE OF a SKIP LOCKED');
  });

  it('records an escalation no channel could carry, rather than pretend it went out', async () => {
    const { tx, webhooks, mail, service } = setup([due({ escalations: 2, channels: ['email'] })]);
    mail.enabled = false;
    webhooks.chatTargets = [];
    await service.runOnce(NOW);
    expect(mail.enqueue).not.toHaveBeenCalled();
    expect(tx.alertActivity.create).toHaveBeenCalledWith({
      data: {
        alertId: ALERT,
        kind: 'escalated',
        note: '3 of 3, unacknowledged: no channel to send it through (email off, no chat channel)',
      },
    });
  });

  it('does nothing while another instance escalates', async () => {
    const { tx, service } = setup([due()], false);
    await expect(service.runOnce(NOW)).resolves.toBe(0);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
