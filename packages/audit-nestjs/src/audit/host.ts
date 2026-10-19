import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

// TEST DOUBLE of the project's host.ts (install/api/audit/host.ts): what the
// connector uses of the API template, standing in for it inside Audit Hub so
// the connector compiles and its specs run here. A connected project gets
// the real one, which re-exports the template's own pieces; the example
// project's gates check both agree (docs/adr/0010).

/** A transaction of the project's database client. */
export interface AuditTx {
  readonly __auditTx: true;
}

export interface RequestUser {
  id: string;
  /** The template's roles (common/types/request-user.ts). */
  role: 'admin' | 'member';
}

/** Signed in (any role): the template's @Auth(). */
export function Auth(...roles: string[]): ClassDecorator & MethodDecorator {
  return applyDecorators(SetMetadata('test:roles', roles));
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser | undefined =>
    context.switchToHttp().getRequest<{ user?: RequestUser }>().user,
);

export function ZodBody(_schema: z.ZodType): MethodDecorator {
  return applyDecorators();
}

export function ZodQuery(_schema: z.ZodObject): MethodDecorator {
  return applyDecorators();
}

export function ApiData(_schema: z.ZodType): MethodDecorator {
  return applyDecorators();
}

export function ApiErrors(..._statuses: number[]): MethodDecorator {
  return applyDecorators();
}

export function RouteRateLimit(rule: { limit: number; ttlSec: number }): MethodDecorator {
  return applyDecorators(SetMetadata('test:route-limit', rule));
}

/** The client address Express resolved through trust proxy. */
export function clientIp(req: Request): string {
  const ip = req.ip ?? 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** The request's ids, from the template's request context. */
export function correlationIds(): { requestId?: string; traceId?: string } {
  return {};
}
