import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConsoleLogger,
  Logger,
  type LoggerService,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditConfig } from './audit-env.js';
import { CONTRACT_VERSION, PROMPT_TTL_MS, WEBHOOK_PATH } from './audit.constants.js';
import type { AuditHandlers, ResponseActionResult, SecurityPrompt } from './audit.ports.js';
import { AuditService } from './audit.service.js';
import {
  FakePushSender,
  MemoryStore,
  TEST_CONFIG,
  TEST_PUSH_CONFIG,
  TEST_TX,
} from './audit.testing.js';
import { PushService } from './push.service.js';
import {
  nodeRandomFill,
  secretKey,
  SIGNATURE_HEADERS,
  SIGNATURE_WINDOW_SEC,
  signWebhook,
  uuidv7,
} from './contract/index.js';
import type { AuditTx } from './host.js';
import { WebhooksService } from './webhooks.service.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
let now = NOW;
const clock = () => now;

const CURRENT_SECRET = TEST_CONFIG.webhookSecrets[0] ?? '';
const NEXT_SECRET = Buffer.alloc(32, 7).toString('base64url');
const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64url');

/** Nest's logger, recorded. */
class LogCapture implements LoggerService {
  readonly lines: { level: 'log' | 'warn' | 'error'; message: string }[] = [];
  log(message: string): void {
    this.lines.push({ level: 'log', message });
  }
  warn(message: string): void {
    this.lines.push({ level: 'warn', message });
  }
  error(message: string): void {
    this.lines.push({ level: 'error', message });
  }
  of(level: 'log' | 'warn' | 'error'): string[] {
    return this.lines.filter((line) => line.level === level).map((line) => line.message);
  }
}

/** Something thrown that is not an Error. */
const notAnError = { toString: () => 'plain failure' } as unknown as Error;

interface Envelope {
  id: string;
  type: string;
  createdAt: string;
  contractVersion: number;
  data: unknown;
}

function envelope(type: string, data: unknown): Envelope {
  return {
    id: randomUUID(),
    type,
    createdAt: new Date(now).toISOString(),
    contractVersion: CONTRACT_VERSION,
    data,
  };
}

interface DeliveryOptions {
  /** The Audit-Webhook-Id signed and sent; the body's id by default. */
  deliveryId?: string;
  secrets?: string[];
  appSlug?: string;
  signedAt?: number;
  /** What was signed, when it is not the body. */
  signedBody?: unknown;
  /** Headers replaced or, as undefined, left out. */
  headers?: Record<string, string | undefined>;
  url?: string;
}

/** A delivery as Audit Hub signs it, as Express hands it over. */
function delivery(body: unknown, options: DeliveryOptions = {}): Request {
  const deliveryId =
    options.deliveryId ??
    (typeof body === 'object' && body !== null && 'id' in body ? String(body.id) : randomUUID());
  const signed = signWebhook({
    keys: (options.secrets ?? [CURRENT_SECRET]).map((secret) => secretKey(secret)),
    appSlug: options.appSlug ?? TEST_CONFIG.app,
    deliveryId,
    path: WEBHOOK_PATH,
    body: 'signedBody' in options ? options.signedBody : body,
    now: options.signedAt ?? now,
  });
  const headers: Record<string, string | undefined> = { ...signed, ...options.headers };
  return {
    body,
    originalUrl: options.url ?? WEBHOOK_PATH,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function setup(
  handlers: AuditHandlers = {},
  config: AuditConfig | null = TEST_CONFIG,
  sender: FakePushSender | null = null,
) {
  const store = new MemoryStore();
  store.now = clock;
  const audit = new AuditService(config, store, clock);
  const push = new PushService(config, store, sender, handlers);
  const service = new WebhooksService(config, store, handlers, clock, audit, push);
  return { store, audit, service };
}

const alertData = () => ({
  alertId: randomUUID(),
  rule: 'auth.credential_stuffing',
  severity: 'high' as const,
  subject: 'user-1',
  summary: '40 failed sign-ins from 12 addresses in 5 minutes',
  firstEventId: uuidv7(nodeRandomFill, now),
});

const suspiciousData = (subject = 'user-1') => ({
  subject,
  eventId: uuidv7(nodeRandomFill, now),
  occurredAt: new Date(now - 60_000).toISOString(),
  signals: ['new_device', 'impossible_travel'],
  context: { country: 'MX', city: 'Monterrey', clientType: 'ios', deviceModel: 'iPhone 16' },
});

const actionData = (overrides: Record<string, unknown> = {}) => ({
  actionId: randomUUID(),
  action: 'revoke_sessions',
  subject: 'user-1',
  reason: 'Credential stuffing against this account',
  requestedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 10 * 60_000).toISOString(),
  ...overrides,
});

let logs: LogCapture;

beforeEach(() => {
  now = NOW;
  logs = new LogCapture();
  Logger.overrideLogger(logs);
});

afterEach(() => {
  Logger.overrideLogger(new ConsoleLogger());
});

describe('WebhooksService', () => {
  it.each([
    ['while the connector is off', null],
    ['without a webhook secret', { ...TEST_CONFIG, webhookSecrets: [] }],
  ])('answers 404 %s', async (_case, config) => {
    const { service } = setup({}, config);

    await expect(service.receive(delivery(envelope('ping', {})))).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('verifying the signature', () => {
    const cases: [string, (body: Envelope) => Request][] = [
      [
        'no delivery id',
        (body) => delivery(body, { headers: { [SIGNATURE_HEADERS.webhookId]: undefined } }),
      ],
      ['a delivery id that is not a UUID', (body) => delivery(body, { deliveryId: 'delivery-1' })],
      [
        'no timestamp',
        (body) => delivery(body, { headers: { [SIGNATURE_HEADERS.timestamp]: undefined } }),
      ],
      [
        'a timestamp that is not one',
        (body) => delivery(body, { headers: { [SIGNATURE_HEADERS.timestamp]: '2026-10-15' } }),
      ],
      [
        'a stale timestamp',
        (body) => delivery(body, { signedAt: now - (SIGNATURE_WINDOW_SEC + 1) * 1000 }),
      ],
      [
        'a timestamp ahead of the window',
        (body) => delivery(body, { signedAt: now + (SIGNATURE_WINDOW_SEC + 1) * 1000 }),
      ],
      [
        'no body digest',
        (body) => delivery(body, { headers: { [SIGNATURE_HEADERS.bodyDigest]: undefined } }),
      ],
      [
        'no signature',
        (body) => delivery(body, { headers: { [SIGNATURE_HEADERS.signature]: undefined } }),
      ],
      [
        'a signature of another scheme',
        (body) =>
          delivery(body, { headers: { [SIGNATURE_HEADERS.signature]: `v2=${'a'.repeat(43)}` } }),
      ],
      [
        'a digest of another body',
        (body) => delivery(body, { signedBody: { ...body, type: 'alert.created' } }),
      ],
      ['a signature with another key', (body) => delivery(body, { secrets: [OTHER_SECRET] })],
      ['a signature for another application', (body) => delivery(body, { appSlug: 'blog' })],
      ['a signature for another path', (body) => delivery(body, { url: '/api/other' })],
      [
        "a delivery id that is not the body's",
        (body) => delivery(body, { deliveryId: randomUUID() }),
      ],
    ];

    it.each(cases)('answers 401 for %s', async (_case, request) => {
      const { store, service } = setup();

      await expect(service.receive(request(envelope('ping', {})))).rejects.toThrow(
        new UnauthorizedException('Invalid webhook signature'),
      );
      expect(store.receipts.size).toBe(0);
    });

    it('takes the path without its query', async () => {
      const { service } = setup();

      await expect(
        service.receive(delivery(envelope('ping', {}), { url: `${WEBHOOK_PATH}?attempt=2` })),
      ).resolves.toBe('accepted');
    });

    it.each([
      ['the previous secret', [CURRENT_SECRET]],
      ['both secrets', [NEXT_SECRET, CURRENT_SECRET]],
      ['the new secret', [NEXT_SECRET]],
    ])('accepts a delivery signed with %s during a rotation', async (_case, secrets) => {
      const { service } = setup(
        {},
        { ...TEST_CONFIG, webhookSecrets: [NEXT_SECRET, CURRENT_SECRET] },
      );

      await expect(service.receive(delivery(envelope('ping', {}), { secrets }))).resolves.toBe(
        'accepted',
      );
    });
  });

  it('answers 400 for a body that is not a webhook', async () => {
    const { store, service } = setup();

    await expect(
      service.receive(delivery({ hello: 'world' }, { deliveryId: randomUUID() })),
    ).rejects.toThrow(BadRequestException);
    expect(store.receipts.size).toBe(0);
  });

  it.each([
    ['an unknown type', envelope('report.ready', { reportId: 'r-1' })],
    ['a known type with data it does not understand', envelope('alert.created', { alert: 1 })],
  ])('answers unsupported for %s', async (_case, body) => {
    const { store, service } = setup();

    await expect(service.receive(delivery(body))).resolves.toBe('unsupported');
    expect(store.receipts.size).toBe(0);
    expect(logs.of('warn')).toEqual([`Webhook ${body.type} not understood: answered unsupported`]);
  });

  it('accepts a ping and remembers the delivery', async () => {
    const { store, service } = setup();
    const body = envelope('ping', {});

    await expect(service.receive(delivery(body))).resolves.toBe('accepted');
    expect([...store.receipts]).toEqual([[body.id, 'ping']]);
  });

  describe('alert.created', () => {
    it('hands the alert to onAlert once, whatever the redeliveries', async () => {
      const alerts: unknown[] = [];
      const { service } = setup({
        onAlert: (alert) => {
          alerts.push(alert);
          return Promise.resolve();
        },
      });
      const data = alertData();
      const body = envelope('alert.created', data);

      await expect(service.receive(delivery(body))).resolves.toBe('accepted');
      now += 30_000;
      await expect(service.receive(delivery(body))).resolves.toBe('accepted');

      expect(alerts).toEqual([data]);
    });

    it('is accepted without onAlert', async () => {
      const { store, service } = setup();
      const body = envelope('alert.created', alertData());

      await expect(service.receive(delivery(body))).resolves.toBe('accepted');
      expect(store.receipts.get(body.id)).toBe('alert.created');
    });
  });

  describe('security.sign_in_suspicious', () => {
    it('stores a "Was it you?" prompt and calls onSecurityPrompt with it', async () => {
      const prompted: SecurityPrompt[] = [];
      const { store, service } = setup({
        onSecurityPrompt: (prompt) => {
          prompted.push(prompt);
          return Promise.resolve();
        },
      });
      const data = suspiciousData();
      const body = envelope('security.sign_in_suspicious', data);

      await expect(service.receive(delivery(body))).resolves.toBe('accepted');

      expect(store.prompts).toEqual([
        {
          id: expect.any(String) as string,
          userId: 'user-1',
          webhookId: body.id,
          hubEventId: data.eventId,
          signals: data.signals,
          context: data.context,
          expiresAt: new Date(now + PROMPT_TTL_MS),
          answer: null,
          answeredAt: null,
          createdAt: new Date(now),
        },
      ]);
      expect(prompted).toEqual([store.prompts[0]]);
    });

    it("pushes the stored prompt to the user's phones, with the screen it opens", async () => {
      const sender = new FakePushSender();
      const { store, service } = setup({}, TEST_PUSH_CONFIG, sender);
      store.pushTokens.set('ExponentPushToken[phone-1]', { userId: 'user-1', platform: 'ios' });
      store.pushTokens.set('ExponentPushToken[other]', { userId: 'user-2', platform: 'ios' });

      await service.receive(delivery(envelope('security.sign_in_suspicious', suspiciousData())));

      const [prompt] = store.prompts;
      expect(sender.sent).toEqual([
        {
          tokens: ['ExponentPushToken[phone-1]'],
          message: {
            title: 'Was it you?',
            body: 'Someone signed in to your account. Open the app to answer.',
            url: `/security/prompts/${prompt?.id ?? ''}`,
          },
        },
      ]);
    });

    it('keeps the prompt and accepts the delivery when the push fails', async () => {
      const sender = new FakePushSender(() => {
        throw new Error('push service down');
      });
      const { store, service } = setup({}, TEST_PUSH_CONFIG, sender);
      store.pushTokens.set('ExponentPushToken[phone-1]', { userId: 'user-1', platform: 'ios' });

      await expect(
        service.receive(delivery(envelope('security.sign_in_suspicious', suspiciousData()))),
      ).resolves.toBe('accepted');
      expect(store.prompts).toHaveLength(1);
      expect(sender.sent).toHaveLength(1);
    });

    it('stores a prompt without onSecurityPrompt', async () => {
      const { store, service } = setup();

      await service.receive(delivery(envelope('security.sign_in_suspicious', suspiciousData())));

      expect(store.prompts).toHaveLength(1);
    });

    it('stores no prompt for a user the project does not know', async () => {
      const prompted: SecurityPrompt[] = [];
      const { store, service } = setup({
        onSecurityPrompt: (prompt) => {
          prompted.push(prompt);
          return Promise.resolve();
        },
      });

      await expect(
        service.receive(delivery(envelope('security.sign_in_suspicious', suspiciousData('ghost')))),
      ).resolves.toBe('accepted');

      expect(store.prompts).toEqual([]);
      expect(prompted).toEqual([]);
    });

    it.each([
      ['an error', new Error('push service down'), 'push service down'],
      ['something else', notAnError, 'plain failure'],
    ])(
      'logs a hook failing with %s after the commit, the delivery handled',
      async (_case, failure, logged) => {
        const { store, service } = setup({ onSecurityPrompt: () => Promise.reject(failure) });
        const body = envelope('security.sign_in_suspicious', suspiciousData());

        await expect(service.receive(delivery(body))).resolves.toBe('accepted');

        expect(store.prompts).toHaveLength(1);
        expect(store.receipts.has(body.id)).toBe(true);
        expect(logs.of('error')).toEqual([`Webhook ${body.id} follow-up failed: ${logged}`]);
      },
    );
  });

  describe('response_action.requested', () => {
    /** The project's handler of revoke_sessions, answering `result`. */
    function revoking(result: ResponseActionResult) {
      const calls: { tx: AuditTx; subject: string }[] = [];
      const handlers: AuditHandlers = {
        responseActions: {
          revoke_sessions: (tx, subject) => {
            calls.push({ tx, subject });
            return Promise.resolve(result);
          },
        },
      };
      return { calls, handlers };
    }

    it.each([
      ['succeeded', 'accepted', 'success'],
      ['failed', 'refused', 'failure'],
      ['refused', 'refused', 'failure'],
    ] as const)(
      'runs the handler and records its outcome (%s)',
      async (result, status, outcome) => {
        const { calls, handlers } = revoking(result);
        const { store, audit, service } = setup(handlers);
        const data = actionData();

        await expect(
          service.receive(delivery(envelope('response_action.requested', data))),
        ).resolves.toBe(status);

        expect(calls).toEqual([{ tx: TEST_TX, subject: 'user-1' }]);
        expect(store.rows.map((row) => row.draft)).toEqual([
          expect.objectContaining({
            action: 'audit.response_action.executed',
            catalogVersion: audit.catalogVersion,
            outcome,
            actor: { type: 'service', id: 'audit-hub' },
            resource: { type: 'user', id: 'user-1' },
            details: { actionId: data.actionId, action: 'revoke_sessions', result },
          }),
        ]);
        expect(logs.of('log')).toEqual([
          `Response action revoke_sessions ${data.actionId}: ${result}`,
        ]);
      },
    );

    it.each([
      ['not enabled in the configuration', revoking('succeeded').handlers, []],
      ['without a handler', { responseActions: {} }, ['revoke_sessions']],
      ['without any handler', {}, ['revoke_sessions']],
      [
        'with a handler of another action only',
        { responseActions: { disable_account: () => Promise.resolve('succeeded' as const) } },
        ['revoke_sessions', 'disable_account'],
      ],
    ] satisfies [string, AuditHandlers, AuditConfig['responseActions']][])(
      'answers unsupported for an action %s, and records it',
      async (_case, handlers, responseActions) => {
        const { store, service } = setup(handlers, { ...TEST_CONFIG, responseActions });
        const data = actionData();

        await expect(
          service.receive(delivery(envelope('response_action.requested', data))),
        ).resolves.toBe('unsupported');

        expect(store.rows.map((row) => row.draft)).toEqual([
          expect.objectContaining({
            outcome: 'failure',
            details: { actionId: data.actionId, action: 'revoke_sessions', result: 'unsupported' },
          }),
        ]);
      },
    );

    it('refuses an expired request without running it', async () => {
      const { calls, handlers } = revoking('succeeded');
      const { store, service } = setup(handlers);
      const data = actionData({ expiresAt: new Date(now).toISOString() });

      await expect(
        service.receive(delivery(envelope('response_action.requested', data))),
      ).resolves.toBe('refused');

      expect(calls).toEqual([]);
      expect(store.rows[0]?.draft.details).toEqual({
        actionId: data.actionId,
        action: 'revoke_sessions',
        result: 'refused',
      });
    });

    it('rolls the delivery back when the handler throws, so a redelivery runs it', async () => {
      let attempts = 0;
      const { store, service } = setup({
        responseActions: {
          revoke_sessions: () => {
            attempts += 1;
            return attempts === 1
              ? Promise.reject(new Error('deadlock detected'))
              : Promise.resolve('succeeded');
          },
        },
      });
      const body = envelope('response_action.requested', actionData());

      await expect(service.receive(delivery(body))).rejects.toThrow('deadlock detected');
      expect(store.receipts.size).toBe(0);
      expect(store.rows).toEqual([]);

      now += 30_000;
      await expect(service.receive(delivery(body))).resolves.toBe('accepted');
      expect(attempts).toBe(2);
      expect(store.receipts.get(body.id)).toBe('response_action.requested');
      expect(store.rows.map((row) => row.draft.details)).toEqual([
        expect.objectContaining({ result: 'succeeded' }),
      ]);
    });
  });
});
