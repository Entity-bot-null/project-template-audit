import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import {
  CLIENT_TYPES,
  type ClientHints,
  clientHintsFromHeaders,
  type ClientInfo,
  DEVICE_ID_PATTERN,
  HTTP_METHODS,
  LIMITS,
  REQUEST_ID_PATTERN,
  ROUTE_PATTERN,
  TRACE_ID_PATTERN,
  toWellFormed,
  VERSION_TOKEN_PATTERN,
} from './contract/index.js';
import { clientIp, correlationIds } from './host.js';

type HttpMethod = (typeof HTTP_METHODS)[number];
type ClientType = (typeof CLIENT_TYPES)[number];

/** What an event takes from the request it happened in. */
export interface AuditScope {
  /** clientIp(req): TRUST_PROXY applied, so a forged X-Forwarded-For changes nothing. */
  ip?: string;
  userAgent?: string;
  /** What a Chromium browser says of itself beyond its user agent (Sec-CH-UA...). */
  clientHints?: ClientHints;
  requestId?: string;
  traceId?: string;
  method?: HttpMethod;
  /** The route template (/api/users/:id), never the URL. */
  route?: string;
  /** The signed-in caller, as the access token says. */
  user?: { id: string; role: string };
  /** From the app's headers: X-App-Version, X-App-Build, X-Device-Id, X-App-Platform. */
  client?: ClientInfo;
}

const storage = new AsyncLocalStorage<AuditScope>();

/** The scope of the request being handled, if any (set by AuditScopeInterceptor). */
export function currentScope(): AuditScope | undefined {
  return storage.getStore();
}

/** Runs `work` with `scope` as the current one: for the specs, and for work done outside a request. */
export function runInScope<T>(scope: AuditScope, work: () => T): T {
  return storage.run(scope, work);
}

/** The scope of a request: what each event records of it, checked against the contract. */
export function scopeOf(req: Request): AuditScope {
  const scope: AuditScope = {};
  const ip = clientIp(req);
  if (isIP(ip) !== 0) scope.ip = ip;
  const userAgent = req.get('user-agent');
  if (userAgent !== undefined && userAgent.length > 0) {
    scope.userAgent = toWellFormed(userAgent).slice(0, LIMITS.userAgent);
  }
  const clientHints = clientHintsFromHeaders((name) => req.get(name));
  if (clientHints !== undefined) scope.clientHints = clientHints;
  const ids = correlationIds();
  if (ids.requestId !== undefined && REQUEST_ID_PATTERN.test(ids.requestId)) {
    scope.requestId = ids.requestId;
  }
  if (ids.traceId !== undefined && TRACE_ID_PATTERN.test(ids.traceId)) scope.traceId = ids.traceId;
  const method = req.method.toUpperCase();
  if ((HTTP_METHODS as readonly string[]).includes(method)) scope.method = method as HttpMethod;
  const route = routeOf(req);
  if (route !== undefined) scope.route = route;
  const user = (req as { user?: unknown }).user;
  if (isUser(user)) scope.user = { id: user.id, role: user.role };
  const client = clientOf(req);
  if (client !== undefined) scope.client = client;
  return scope;
}

function routeOf(req: Request): string | undefined {
  const path = (req as { route?: { path?: unknown } }).route?.path;
  if (typeof path !== 'string') return undefined;
  const route = `${req.baseUrl}${path}`;
  return ROUTE_PATTERN.test(route) ? route : undefined;
}

function isUser(value: unknown): value is { id: string; role: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'role' in value &&
    typeof value.role === 'string'
  );
}

/** The app's own headers (RELEASES.md of the app template); absent: no client section. */
function clientOf(req: Request): ClientInfo | undefined {
  const version = req.get('x-app-version');
  const build = req.get('x-app-build');
  const deviceId = req.get('x-device-id');
  const platform = req.get('x-app-platform');
  const client: Partial<ClientInfo> = {};
  if (version !== undefined && VERSION_TOKEN_PATTERN.test(version)) client.appVersion = version;
  if (build !== undefined && VERSION_TOKEN_PATTERN.test(build)) client.appBuild = build;
  if (deviceId !== undefined && DEVICE_ID_PATTERN.test(deviceId)) client.deviceId = deviceId;
  if (Object.keys(client).length === 0) return undefined;
  const type: ClientType = (CLIENT_TYPES as readonly string[]).includes(platform ?? '')
    ? (platform as ClientType)
    : 'web';
  return { type, ...client };
}

/**
 * Makes each request's scope current while it is handled, so
 * AuditService.record() needs no request argument. Registered for every
 * route by AuditModule; it runs after the guards, so the signed-in user is
 * known. A guard records with an explicit request instead.
 */
@Injectable()
export class AuditScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const scope = scopeOf(context.switchToHttp().getRequest<Request>());
    return new Observable((subscriber) =>
      storage.run(scope, () => next.handle().subscribe(subscriber)),
    );
  }
}
