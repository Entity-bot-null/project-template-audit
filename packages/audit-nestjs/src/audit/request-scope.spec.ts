import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { defer, firstValueFrom, Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  type AuditScope,
  AuditScopeInterceptor,
  currentScope,
  runInScope,
  scopeOf,
} from './request-scope.js';

interface FakeRequestInput {
  ip?: string;
  method?: string;
  headers?: Record<string, string>;
  route?: { path?: unknown };
  baseUrl?: string;
  user?: unknown;
}

/** What scopeOf reads of an Express request. */
function fakeRequest(input: FakeRequestInput = {}): Request {
  const headers = new Map(
    Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ip: input.ip,
    method: input.method ?? 'GET',
    baseUrl: input.baseUrl ?? '',
    route: input.route,
    user: input.user,
    get: (name: string) => headers.get(name.toLowerCase()),
  } as unknown as Request;
}

describe('scopeOf', () => {
  it('is nearly empty for a bare request', () => {
    expect(scopeOf(fakeRequest())).toEqual({ method: 'GET' });
  });

  it('takes everything an event records of a request', () => {
    const scope = scopeOf(
      fakeRequest({
        ip: '203.0.113.7',
        method: 'post',
        baseUrl: '/api',
        route: { path: '/orders/:id' },
        user: { id: 'user-1', role: 'admin', email: 'ana@example.com' },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'X-App-Version': '2.1.0',
          'X-App-Build': '421',
          'X-Device-Id': '6f1c2d3e-aaaa-bbbb',
          'X-App-Platform': 'ios',
        },
      }),
    );
    expect(scope).toEqual({
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      method: 'POST',
      route: '/api/orders/:id',
      user: { id: 'user-1', role: 'admin' },
      client: {
        type: 'ios',
        appVersion: '2.1.0',
        appBuild: '421',
        deviceId: '6f1c2d3e-aaaa-bbbb',
      },
    });
  });

  it('keeps a valid address, IPv4-mapped ones unmapped, and drops anything else', () => {
    expect(scopeOf(fakeRequest({ ip: '::ffff:198.51.100.4' })).ip).toBe('198.51.100.4');
    expect(scopeOf(fakeRequest({ ip: '2001:db8::1' })).ip).toBe('2001:db8::1');
    expect(scopeOf(fakeRequest({ ip: 'not-an-ip' })).ip).toBeUndefined();
    expect(scopeOf(fakeRequest({ ip: '' })).ip).toBeUndefined();
    expect('ip' in scopeOf(fakeRequest())).toBe(false);
  });

  it('cuts the user agent to the contract limit and makes it well-formed', () => {
    const long = 'a'.repeat(600);
    expect(scopeOf(fakeRequest({ headers: { 'user-agent': long } })).userAgent).toBe(
      'a'.repeat(512),
    );
    expect(scopeOf(fakeRequest({ headers: { 'user-agent': 'bot \uD800' } })).userAgent).toBe(
      'bot �',
    );
    expect('userAgent' in scopeOf(fakeRequest({ headers: { 'user-agent': '' } }))).toBe(false);
  });

  it("takes a Chromium browser's client hints, and none from any other", () => {
    const scope = scopeOf(
      fakeRequest({
        headers: {
          'sec-ch-ua': '"Microsoft Edge";v="155", "Chromium";v="155", "Not.A/Brand";v="99"',
          'sec-ch-ua-platform': '"Windows"',
          'sec-ch-ua-platform-version': '"15.0.0"',
          'sec-ch-ua-mobile': '?0',
        },
      }),
    );
    expect(scope.clientHints).toEqual({
      brands: [
        { brand: 'Microsoft Edge', version: '155' },
        { brand: 'Chromium', version: '155' },
      ],
      platform: 'Windows',
      platformVersion: '15.0.0',
      mobile: false,
    });
    expect('clientHints' in scopeOf(fakeRequest({ headers: { 'user-agent': 'curl/8' } }))).toBe(
      false,
    );
  });

  it('has no request or trace id outside the request context', () => {
    // The project's correlationIds() reads them from its request context;
    // host.ts's test double has none.
    const scope = scopeOf(fakeRequest());
    expect(scope.requestId).toBeUndefined();
    expect(scope.traceId).toBeUndefined();
  });

  it('keeps a method of the contract only', () => {
    expect(scopeOf(fakeRequest({ method: 'delete' })).method).toBe('DELETE');
    expect(scopeOf(fakeRequest({ method: 'PROPFIND' })).method).toBeUndefined();
  });

  it('takes the route template, refusing what is not one', () => {
    expect(scopeOf(fakeRequest({ route: { path: '/health' } })).route).toBe('/health');
    expect(scopeOf(fakeRequest({ route: { path: '/users/:id' }, baseUrl: '/api' })).route).toBe(
      '/api/users/:id',
    );
    expect(scopeOf(fakeRequest({ route: { path: '/files/*splat' } })).route).toBeUndefined();
    expect(scopeOf(fakeRequest({ route: { path: '/a b' } })).route).toBeUndefined();
    expect(scopeOf(fakeRequest({ route: { path: /^\/users/ } })).route).toBeUndefined();
    expect(scopeOf(fakeRequest({ route: {} })).route).toBeUndefined();
  });

  it('takes the signed-in user only when it has a string id and role', () => {
    const userOf = (user: unknown) => scopeOf(fakeRequest({ user })).user;
    expect(userOf({ id: 'user-1', role: 'member' })).toEqual({ id: 'user-1', role: 'member' });
    expect(userOf(undefined)).toBeUndefined();
    expect(userOf(null)).toBeUndefined();
    expect(userOf('user-1')).toBeUndefined();
    expect(userOf({ role: 'member' })).toBeUndefined();
    expect(userOf({ id: 1, role: 'member' })).toBeUndefined();
    expect(userOf({ id: 'user-1' })).toBeUndefined();
    expect(userOf({ id: 'user-1', role: 2 })).toBeUndefined();
  });

  it('reads the app headers, web by default, dropping invalid ones', () => {
    const clientOf = (headers: Record<string, string>) => scopeOf(fakeRequest({ headers })).client;
    expect(clientOf({})).toBeUndefined();
    expect(clientOf({ 'x-app-platform': 'android' })).toBeUndefined();
    expect(clientOf({ 'x-app-version': '1.0.0' })).toEqual({ type: 'web', appVersion: '1.0.0' });
    expect(clientOf({ 'x-app-build': '77', 'x-app-platform': 'android' })).toEqual({
      type: 'android',
      appBuild: '77',
    });
    expect(clientOf({ 'x-device-id': 'device-0001', 'x-app-platform': 'symbian' })).toEqual({
      type: 'web',
      deviceId: 'device-0001',
    });
    expect(
      clientOf({
        'x-app-version': '1.0 beta',
        'x-app-build': 'b'.repeat(33),
        'x-device-id': 'short',
      }),
    ).toBeUndefined();
    expect(
      clientOf({ 'x-app-version': '3.0.0', 'x-app-build': 'bad build', 'x-device-id': 'bad id!!' }),
    ).toEqual({ type: 'web', appVersion: '3.0.0' });
  });
});

describe('currentScope and runInScope', () => {
  const scope: AuditScope = { ip: '203.0.113.7', method: 'GET' };

  it('has no scope outside a request', () => {
    expect(currentScope()).toBeUndefined();
  });

  it('makes a scope current while the work runs, async work included', async () => {
    expect(runInScope(scope, () => currentScope())).toBe(scope);
    await expect(
      runInScope(scope, async () => {
        await Promise.resolve();
        return currentScope();
      }),
    ).resolves.toBe(scope);
    expect(currentScope()).toBeUndefined();
  });

  it('nests: the inner scope wins until its work ends', () => {
    const inner: AuditScope = { method: 'POST' };
    const seen = runInScope(scope, () => [
      currentScope(),
      runInScope(inner, () => currentScope()),
      currentScope(),
    ]);
    expect(seen).toEqual([scope, inner, scope]);
  });
});

function fakeContext(type: string, req: Request): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** A handler that answers the scope current when it runs, after an await. */
const scopeHandler: CallHandler = {
  handle: () =>
    defer(async () => {
      await Promise.resolve();
      return currentScope();
    }),
};

describe('AuditScopeInterceptor', () => {
  const interceptor = new AuditScopeInterceptor();
  const req = fakeRequest({
    ip: '203.0.113.7',
    method: 'patch',
    baseUrl: '/api',
    route: { path: '/users/:id' },
    user: { id: 'user-1', role: 'admin' },
  });

  it('makes the request scope current while an HTTP handler runs', async () => {
    const seen = await firstValueFrom(
      interceptor.intercept(fakeContext('http', req), scopeHandler),
    );
    expect(seen).toEqual({
      ip: '203.0.113.7',
      method: 'PATCH',
      route: '/api/users/:id',
      user: { id: 'user-1', role: 'admin' },
    });
    expect(currentScope()).toBeUndefined();
  });

  it('passes every value and the completion through', async () => {
    const values: unknown[] = [];
    const handler: CallHandler = { handle: () => of(1, 2, 3) };
    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(fakeContext('http', req), handler).subscribe({
        next: (value) => values.push(value),
        error: reject,
        complete: resolve,
      });
    });
    expect(values).toEqual([1, 2, 3]);
  });

  it('passes errors through', async () => {
    const handler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(new Error('handler failed'));
        }),
    };
    await expect(
      firstValueFrom(interceptor.intercept(fakeContext('http', req), handler)),
    ).rejects.toThrow('handler failed');
  });

  it('leaves other contexts alone', async () => {
    const handled = of('rpc');
    const handler: CallHandler = { handle: () => handled };
    expect(interceptor.intercept(fakeContext('rpc', req), handler)).toBe(handled);
    await expect(
      firstValueFrom(interceptor.intercept(fakeContext('ws', req), scopeHandler)),
    ).resolves.toBeUndefined();
  });
});
