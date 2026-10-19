import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { signRequest } from 'audit-contract/node';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectedAppsService,
  VerificationKey,
} from '../connected-apps/connected-apps.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { signedAppOf } from './app-signature.decorator.js';
import { AppSignatureGuard, FAILED_SIGNATURES_PER_MINUTE } from './app-signature.guard.js';

const KEY_ID = '0199e0b1-0000-7000-8000-0000000000b1';
const KEY = Buffer.alloc(32, 5);
const BODY = { contractVersion: 1, events: [1] };

function setup(
  options: { key?: VerificationKey | undefined; nonceCount?: number; blocked?: boolean } = {},
) {
  const key: VerificationKey | undefined =
    'key' in options
      ? options.key
      : { appId: 'app-1', slug: 'my-project', status: 'active', rateLimitPerMinute: 120, key: KEY };
  const apps = { verificationKey: vi.fn(() => Promise.resolve(key)) };
  const prisma = {
    ingestNonce: { createMany: vi.fn(() => Promise.resolve({ count: options.nonceCount ?? 1 })) },
  };
  const limits = {
    increment: vi.fn(() =>
      Promise.resolve({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: options.blocked === true,
        timeToBlockExpire: 30,
      }),
    ),
  };
  const guard = new AppSignatureGuard(
    apps as unknown as ConnectedAppsService,
    prisma as unknown as PrismaService,
    limits,
  );
  return { guard, apps, prisma, limits };
}

function context(
  headers: Record<string, string>,
  options: { method?: string; url?: string; body?: unknown } = {},
) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const responseHeaders = new Map<string, string>();
  const req = {
    method: options.method ?? 'POST',
    originalUrl: options.url ?? '/api/ingest/events',
    body: 'body' in options ? options.body : BODY,
    ip: '203.0.113.9',
    get: (name: string) => lower[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => responseHeaders.set(name.toLowerCase(), value),
    hasHeader: (name: string) => responseHeaders.has(name.toLowerCase()),
  } as unknown as Response;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, req, responseHeaders };
}

const headers = (
  overrides: { now?: number; body?: unknown; path?: string; method?: string; query?: string } = {},
) =>
  signRequest({
    keyId: KEY_ID,
    key: KEY,
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/api/ingest/events',
    query: overrides.query ?? '',
    body: 'body' in overrides ? overrides.body : BODY,
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  });

describe('AppSignatureGuard', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('lets a correctly signed request through and names its application', async () => {
    const { guard } = setup();
    const { ctx, req } = context(headers());
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.connectedApp).toEqual({ appId: 'app-1', slug: 'my-project', keyId: KEY_ID });
    expect(signedAppOf(req)).toEqual(req.connectedApp);
  });

  it('verifies GET requests by their query, with an empty body', async () => {
    const { guard } = setup();
    const signed = headers({
      method: 'GET',
      path: '/api/connector/subjects/u1/activity',
      query: 'cursor=a&limit=5',
      body: undefined,
    });
    const { ctx } = context(signed, {
      method: 'GET',
      url: '/api/connector/subjects/u1/activity?limit=5&cursor=a',
      body: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('refuses malformed, unknown, tampered and mis-signed requests with 401', async () => {
    for (const [request, key] of [
      [context({}), undefined],
      [context(headers()), 'missing'],
      [context(headers(), { body: { contractVersion: 2 } }), undefined],
      [context({ ...headers(), 'audit-signature': `v1=${'A'.repeat(43)}` }), undefined],
      [context(headers(), { url: '/api/ingest/catalog' }), undefined],
    ] as const) {
      const { guard } = key === 'missing' ? setup({ key: undefined }) : setup();
      await expect(guard.canActivate(request.ctx)).rejects.toThrow(UnauthorizedException);
      expect(request.responseHeaders.get('audit-error')).toBe('unauthorized');
    }
  });

  it('says so when the clock is off', async () => {
    const { guard } = setup();
    const { ctx, responseHeaders } = context(headers({ now: Date.now() - 10 * 60_000 }));
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(responseHeaders.get('audit-error')).toBe('timestamp_skew');
  });

  it('refuses a suspended application with 403 and a replayed nonce with 401', async () => {
    const suspended = setup({
      key: {
        appId: 'app-1',
        slug: 'my-project',
        status: 'suspended',
        rateLimitPerMinute: 120,
        key: KEY,
      },
    });
    const first = context(headers());
    await expect(suspended.guard.canActivate(first.ctx)).rejects.toThrow(ForbiddenException);
    expect(first.responseHeaders.get('audit-error')).toBe('app_suspended');
    const replayed = setup({ nonceCount: 0 });
    await expect(replayed.guard.canActivate(context(headers()).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a correctly signed request of a retired application with 403, storing no nonce', async () => {
    const { guard, prisma, limits } = setup({
      key: {
        appId: 'app-1',
        slug: 'my-project',
        status: 'retired',
        rateLimitPerMinute: 120,
        key: KEY,
      },
    });
    const { ctx, req, responseHeaders } = context(headers());
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(responseHeaders.get('audit-error')).toBe('app_suspended');
    expect(prisma.ingestNonce.createMany).not.toHaveBeenCalled();
    expect(limits.increment).not.toHaveBeenCalled();
    expect(req.connectedApp).toBeUndefined();
  });

  it('answers 429 with Retry-After past the quota, and to an IP that keeps failing', async () => {
    const { guard } = setup({ blocked: true });
    const ok = context(headers());
    await expect(guard.canActivate(ok.ctx)).rejects.toThrow(HttpException);
    expect(ok.responseHeaders.get('retry-after')).toBe('30');
    const failing = context({});
    await expect(guard.canActivate(failing.ctx)).rejects.toThrow('Too many requests, retry later');
    expect(FAILED_SIGNATURES_PER_MINUTE).toBe(30);
  });

  it('refuses to name an application on a route without the guard', () => {
    expect(() => signedAppOf({} as Request)).toThrow('@SignedApp()');
  });
});
