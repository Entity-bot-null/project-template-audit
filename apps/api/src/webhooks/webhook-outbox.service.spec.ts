import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { slackMessage, teamsMessage } from './chat-messages.js';
import { WebhookOutboxService } from './webhook-outbox.service.js';
import { WEBHOOK_TTL_MS, webhookRetryDelayMs } from './webhooks.constants.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';

function setup(
  app: unknown = {
    webhookUrl: 'https://app.example.com/api/audit/webhooks',
    webhookSecret: new Uint8Array(8),
  },
) {
  const prisma = {
    connectedApp: { findFirst: vi.fn(() => Promise.resolve(app)) },
    webhookDelivery: {
      create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
    },
  };
  return { prisma, outbox: new WebhookOutboxService(prisma as unknown as PrismaService) };
}

describe('WebhookOutboxService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues a webhook to an application, its envelope id being the delivery id', async () => {
    const { prisma, outbox } = setup();
    const woken = vi.fn();
    outbox.onQueued(woken);
    const id = await outbox.toApp({ appId: APP, type: 'ping', data: {} });
    const data = prisma.webhookDelivery.create.mock.calls[0]?.[0].data ?? {};
    expect(data).toMatchObject({
      id,
      appId: APP,
      target: 'app',
      type: 'ping',
      payload: { id, type: 'ping', contractVersion: 1, data: {} },
    });
    expect((data.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(WEBHOOK_TTL_MS - 1000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(woken).toHaveBeenCalled();
  });

  it('queues nothing for an application without a webhook URL or secret', async () => {
    for (const app of [
      null,
      { webhookUrl: null, webhookSecret: null },
      { webhookUrl: 'https://x', webhookSecret: null },
    ]) {
      const { prisma, outbox } = setup(app);
      await expect(outbox.toApp({ appId: APP, type: 'ping', data: {} })).resolves.toBeUndefined();
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    }
  });

  it('queues chat messages without an application, and knows no chat channel unless configured', async () => {
    const { prisma, outbox } = setup();
    expect(outbox.chatTargets).toEqual([]);
    await outbox.toChat('slack', 'alert.created', { text: 'hi' });
    expect(prisma.webhookDelivery.create.mock.calls[0]?.[0].data).toMatchObject({
      appId: null,
      target: 'slack',
      payload: { text: 'hi' },
    });
  });
});

describe('webhookRetryDelayMs', () => {
  it('doubles from 30 s to an hour, with jitter', () => {
    expect(webhookRetryDelayMs(1, () => 0)).toBe(15_000);
    expect(webhookRetryDelayMs(1, () => 1)).toBe(30_000);
    expect(webhookRetryDelayMs(3, () => 1)).toBe(120_000);
    expect(webhookRetryDelayMs(30, () => 1)).toBe(3_600_000);
    expect(webhookRetryDelayMs(0, () => 1)).toBe(30_000);
  });
});

describe('chat messages', () => {
  const alert = {
    appSlug: 'my-project',
    appName: 'My <project> & co',
    rule: 'brute_force_ip',
    severity: 'high',
    title: '20 failed sign-ins from one address',
    url: 'https://audit.example.com/alerts/1',
  };

  it('writes a Slack message with the link, escaping Slack markup', () => {
    expect(slackMessage(alert).text).toBe(
      '[HIGH] My &lt;project&gt; &amp; co (my-project): 20 failed sign-ins from one address\nRule: brute_force_ip\n<https://audit.example.com/alerts/1|Open the alert in Audit Hub>',
    );
    const { url: _url, ...noLink } = alert;
    expect(slackMessage(noLink).text).not.toContain('Open the alert');
  });

  it('writes a Teams Adaptive Card with the link as an action', () => {
    const message = teamsMessage(alert) as {
      attachments: { content: { body: unknown[]; actions?: { url: string }[] } }[];
    };
    const card = message.attachments[0]?.content;
    expect(card?.actions?.[0]?.url).toBe(alert.url);
    expect(JSON.stringify(card?.body)).toContain('[HIGH] 20 failed sign-ins from one address');
    const { url: _url, ...noLink } = alert;
    expect(
      (teamsMessage(noLink) as { attachments: { content: { actions?: unknown } }[] }).attachments[0]
        ?.content.actions,
    ).toBeUndefined();
  });
});
