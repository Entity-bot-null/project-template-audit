import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiResponse } from '@nestjs/swagger';
import { SIGNATURE_HEADERS } from 'audit-contract';
import type { Request, Response } from 'express';
import { errorResponse } from '../common/openapi/api.decorators.js';

const RECENT_AUTH_KEY = 'recentAuthMaxAgeSec';
/** Default: the password and a code confirmed in the last 5 minutes. */
export const RECENT_AUTH_MAX_AGE_SEC = 300;
/** The Audit-Error value the web app turns into the step-up dialog. */
export const REAUTHENTICATION_REQUIRED = 'reauthentication_required';

/**
 * Recent authentication for a sensitive action (docs/adr/0012): the access
 * token must come from a step-up (POST /api/account/step-up) at most
 * `maxAgeSec` ago. Else 403 with `Audit-Error: reauthentication_required`.
 * Goes on a handler of an @Auth() controller: its guard runs after them.
 */
export function RequireRecentAuth(maxAgeSec: number = RECENT_AUTH_MAX_AGE_SEC) {
  return applyDecorators(
    SetMetadata(RECENT_AUTH_KEY, maxAgeSec),
    UseGuards(RecentAuthGuard),
    ApiResponse(errorResponse(403)),
  );
}

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const maxAge = this.reflector.getAllAndOverride<number | undefined>(RECENT_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (maxAge === undefined) return true;
    const http = context.switchToHttp();
    const reauthAt = http.getRequest<Request>().user?.reauthAt;
    const now = Math.floor(Date.now() / 1000);
    if (reauthAt !== undefined && now - reauthAt <= maxAge && reauthAt <= now + 60) return true;
    http.getResponse<Response>().setHeader(SIGNATURE_HEADERS.error, REAUTHENTICATION_REQUIRED);
    throw new ForbiddenException('Confirm your password and a code first');
  }
}
