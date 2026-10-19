import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalServiceError } from '../common/http/external-http.js';
import type { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import { env } from '../env/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BlockedAddressError } from './guarded-fetch.js';
import type { WebhookOutboxService } from './webhook-outbox.service.js';
import { classify, splitUrl, WebhookWorker } from './webhook-worker.service.js';
import type { ClaimedDelivery, WebhookStore } from './webhook.store.js';
import { WEBHOOK_MAX_ATTEMPTS } from './webhooks.constants.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const URL_OF_APP = 'https://app.example.com/api/audit/webhooks';
const mutableEnv = env as { AUDIT_SLACK_WEBHOOK_URL?: string; AUDIT_TEAMS_WEBHOOK_URL?: string };

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    id: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
    appId: APP,
    target: 'app',
    type: 'response_action.requested',
    payload: {
      id: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
      type: 'response_action.requested',
      data: {},
    },
    attempts: 1,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    ...overrides,
  };
}

const urlOf = (input: URL | RequestInfo | undefined) =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : (input ?? '');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(fetch: typeof globalThis.fetch, claimed: ClaimedDelivery[] = [delivery()]) {
  const queue = [...claimed];
  const store = {
    claim: vi.fn(() => Promise.resolve(queue.shift())),
    markDelivered: vi.fn(() => Promise.resolve(true)),
    reschedule: vi.fn(() => Promise.resolve(true)),
    markFailed: vi.fn(() => Promise.resolve(true)),
    markExpired: vi.fn(() => Promise.resolve(true)),
    stats: vi.fn(() => Promise.resolve({ waiting: 0, oldestAgeSeconds: 0 })),
    sweep: vi.fn(() => Promise.resolve({ deleted: 1, expired: 0 })),
  };
  const outbox = { onQueued: vi.fn() };
  const apps = {
    webhookTarget: vi.fn(() =>
      Promise.resolve({ slug: 'my-project', url: URL_OF_APP, keys: [Buffer.alloc(32, 1)] } as
        { slug: string; url: string; keys: Buffer[] } | undefined),
    ),
  };
  const prisma = {
    connectedApp: { findUnique: vi.fn(() => Promise.resolve({ slug: 'my-project' } as unknown)) },
  };
  const worker = new WebhookWorker(
    store as unknown as WebhookStore,
    outbox as unknown as WebhookOutboxService,
    apps as unknown as ConnectedAppsService,
    prisma as unknown as PrismaService,
    fetch,
  );
  return { store, outbox, apps, prisma, worker };
}

describe('WebhookWorker', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    delete mutableEnv.AUDIT_SLACK_WEBHOOK_URL;
    delete mutableEnv.AUDIT_TEAMS_WEBHOOK_URL;
    vi.useRealTimers();
  });

  it("signs a delivery with the application's secrets, sends it to its URL and passes its answer on", async () => {
    const fetch = vi.fn((_input: URL | RequestInfo, _init?: RequestInit) =>
      Promise.resolve(json(200, { data: { status: 'refused' } })),
    );
    const { store, worker } = setup(fetch);
    const listener = vi.fn(() => Promise.resolve());
    worker.onReply('response_action.requested', listener);
    await worker.runOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe(URL_OF_APP);
    const headers = new Headers(init?.headers);
    expect(headers.get('audit-webhook-id')).toBe(delivery().id);
    expect(headers.get('audit-signature')).toMatch(/^v1=[A-Za-z0-9_-]{43}$/);
    expect(headers.get('audit-body-digest')).toMatch(/^sha-256=/);
    expect(init?.method).toBe('POST');
    expect(store.markDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ id: delivery().id }),
      200,
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: delivery().id }),
      'refused',
    );
  });

  it('takes a 2xx without the contract answer as accepted, and survives a failing listener', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const { worker } = setup(fetch);
    const listener = vi.fn(() => Promise.reject(new Error('database down')));
    worker.onReply('response_action.requested', listener);
    await worker.runOnce();
    expect(listener).toHaveBeenCalledWith(expect.anything(), 'accepted');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not record the answer'),
    );
  });

  it('gives up on a 401 and a 404 at once, and retries a 503 and a network failure', async () => {
    for (const [status, outcome] of [
      [401, 'failed'],
      [404, 'failed'],
      [503, 'retry'],
    ] as const) {
      const { store, worker } = setup(vi.fn(() => Promise.resolve(json(status, {}))));
      await worker.runOnce();
      if (outcome === 'failed') {
        expect(store.markFailed).toHaveBeenCalledWith(
          expect.anything(),
          status,
          status === 401 ? 'unauthorized' : 'http_404',
        );
      } else {
        expect(store.reschedule).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(Number),
          503,
          'http_503',
        );
      }
    }
    const offline = setup(vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    await offline.worker.runOnce();
    expect(offline.store.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      null,
      'network',
    );
  });

  it('gives up on a private address, and on the last attempt', async () => {
    const blocked = setup(vi.fn(() => Promise.reject(new BlockedAddressError('app.example.com'))));
    await blocked.worker.runOnce();
    expect(blocked.store.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      null,
      'blocked_address',
    );
    const last = setup(
      vi.fn(() => Promise.resolve(json(503, {}))),
      [delivery({ attempts: WEBHOOK_MAX_ATTEMPTS })],
    );
    await last.worker.runOnce();
    expect(last.store.markFailed).toHaveBeenCalledWith(expect.anything(), 503, 'http_503');
    const exhausted = setup(vi.fn(), [delivery({ attempts: WEBHOOK_MAX_ATTEMPTS + 1 })]);
    await exhausted.worker.runOnce();
    expect(exhausted.store.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      null,
      'attempts_exhausted',
    );
  });

  it('drops a delivery past its validity, or whose destination is gone', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const expired = setup(fetch, [delivery({ expiresAt: new Date(Date.now() - 1000) })]);
    await expired.worker.runOnce();
    expect(expired.store.markExpired).toHaveBeenCalledWith(expect.anything(), 'expired');
    const gone = setup(fetch);
    gone.apps.webhookTarget.mockResolvedValueOnce(undefined);
    await gone.worker.runOnce();
    expect(gone.store.markExpired).toHaveBeenCalledWith(expect.anything(), 'not_configured');
    const noApp = setup(fetch, [delivery({ appId: null })]);
    await noApp.worker.runOnce();
    expect(noApp.store.markExpired).toHaveBeenCalledWith(expect.anything(), 'not_configured');
    const chat = setup(fetch, [delivery({ appId: null, target: 'slack', type: 'alert.created' })]);
    await chat.worker.runOnce();
    expect(chat.store.markExpired).toHaveBeenCalledWith(expect.anything(), 'not_configured');
  });

  it('retries when something of its own fails (the secret cannot be opened)', async () => {
    const { store, apps, worker } = setup(vi.fn());
    apps.webhookTarget.mockRejectedValueOnce(new Error('bad ciphertext'));
    await worker.runOnce();
    expect(store.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      null,
      'internal',
    );
  });

  it('posts chat messages to the configured channel, without logging its URL', async () => {
    mutableEnv.AUDIT_SLACK_WEBHOOK_URL = 'https://chat.example.com/hooks/T0/B0/secret';
    mutableEnv.AUDIT_TEAMS_WEBHOOK_URL = 'https://example.webhook.office.com/workflows/x';
    const fetch = vi.fn((_input: URL | RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response('ok', { status: 200 })),
    );
    const slack = delivery({
      appId: null,
      target: 'slack',
      type: 'alert.created',
      payload: { text: 'hi' },
    });
    const { store, worker } = setup(fetch, [slack, { ...slack, target: 'teams' }]);
    await worker.runOnce();
    expect(fetch.mock.calls.map(([url]) => urlOf(url))).toEqual([
      mutableEnv.AUDIT_SLACK_WEBHOOK_URL,
      mutableEnv.AUDIT_TEAMS_WEBHOOK_URL,
    ]);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"text":"hi"}');
    expect(store.markDelivered).toHaveBeenCalledTimes(2);
    const logged = vi.mocked(Logger.prototype.log).mock.calls.flat().join(' ');
    expect(logged).not.toContain('secret');

    const failing = setup(
      vi.fn(() => Promise.resolve(new Response('no', { status: 500 }))),
      [slack],
    );
    await failing.worker.runOnce();
    expect(failing.store.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      500,
      'http_500',
    );
    const slow = setup(
      vi.fn(() => Promise.reject(new DOMException('slow', 'TimeoutError'))),
      [slack],
    );
    await slow.worker.runOnce();
    expect(slow.store.reschedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      null,
      'timeout',
    );
    const blocked = setup(
      vi.fn(() => Promise.reject(new BlockedAddressError('chat.example.com'))),
      [slack],
    );
    await blocked.worker.runOnce();
    expect(blocked.store.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      null,
      'blocked_address',
    );
  });

  it('names applications by their slug, read once', async () => {
    const fetch = vi.fn(() => Promise.resolve(json(200, { data: { status: 'accepted' } })));
    const { prisma, worker } = setup(fetch, [delivery(), delivery()]);
    await worker.runOnce();
    expect(prisma.connectedApp.findUnique).toHaveBeenCalledTimes(1);
    const unknown = setup(fetch);
    unknown.prisma.connectedApp.findUnique.mockResolvedValueOnce(null);
    await unknown.worker.runOnce();
    expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('of unknown'));
  });

  it('pauses when the database fails, polls on timers, and stops on shutdown', async () => {
    vi.useFakeTimers();
    const { store, outbox, worker } = setup(vi.fn(), []);
    store.claim.mockRejectedValueOnce(new Error('connection refused'));
    store.stats.mockRejectedValueOnce(new Error('timeout'));
    worker.onApplicationBootstrap();
    await worker.idle();
    expect(outbox.onQueued).toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Webhook worker paused'),
    );
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(store.sweep).toHaveBeenCalled();
    store.sweep.mockRejectedValueOnce(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('retention sweep failed'),
    );
    // A wake during a drain runs another drain after it.
    worker.wake();
    worker.wake();
    await worker.idle();
    await worker.onModuleDestroy();
    const claims = store.claim.mock.calls.length;
    worker.wake();
    await worker.runOnce();
    expect(store.claim.mock.calls.length).toBe(claims);
  });
});

describe('classify', () => {
  it('sorts failures into retried and given up on', () => {
    expect(classify(new ExternalServiceError('webhook', 'status', 429))).toMatchObject({
      permanent: false,
    });
    expect(classify(new ExternalServiceError('webhook', 'status', 410))).toMatchObject({
      permanent: true,
    });
    expect(classify(new ExternalServiceError('webhook', 'timeout'))).toMatchObject({
      category: 'timeout',
      permanent: false,
    });
    expect(
      classify(
        new ExternalServiceError('webhook', 'network', undefined, {
          cause: new BlockedAddressError('x'),
        }),
      ),
    ).toMatchObject({ category: 'blocked_address', permanent: true });
    expect(classify(new Error('?'))).toMatchObject({ category: 'network', permanent: false });
  });
});

describe('splitUrl', () => {
  it('keeps the exact path the signature names, and the query apart', () => {
    expect(splitUrl(new URL('https://app.example.com/api/audit/webhooks'))).toEqual({
      baseUrl: 'https://app.example.com/api/audit/',
      path: 'webhooks',
      query: {},
    });
    expect(splitUrl(new URL('https://example.com/hooks/?a=1&b=2'))).toEqual({
      baseUrl: 'https://example.com/hooks/',
      path: '',
      query: { a: '1', b: '2' },
    });
  });
});
