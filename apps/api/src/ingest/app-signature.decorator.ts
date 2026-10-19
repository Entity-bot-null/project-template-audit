import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import { errorResponse } from '../common/openapi/api.decorators.js';
import { AppSignatureGuard } from './app-signature.guard.js';
import type { AuthenticatedApp } from './ingest.types.js';

/** The OpenAPI security scheme of signed machine-to-machine routes (openapi.ts). */
export const APP_SIGNATURE_SCHEME = 'auditSignature';

// Machine-to-machine routes: no user, a request signed with an application's
// key instead (docs/adr/0006). Documents the scheme, its headers and the 401.
export function AppSignature() {
  return applyDecorators(
    UseGuards(AppSignatureGuard),
    ApiSecurity(APP_SIGNATURE_SCHEME),
    ApiHeader({ name: 'Audit-Key-Id', required: true, description: "The key's public id (UUID)" }),
    ApiHeader({
      name: 'Audit-Timestamp',
      required: true,
      description: 'Unix seconds, within ±300 s',
    }),
    ApiHeader({
      name: 'Audit-Nonce',
      required: true,
      description: '16 random bytes, base64url; single use',
    }),
    ApiHeader({
      name: 'Audit-Body-Digest',
      required: true,
      description: 'sha-256=<base64url> of the canonical JSON (RFC 8785) of the body',
    }),
    ApiHeader({
      name: 'Audit-Signature',
      required: true,
      description: 'v1=<base64url HMAC-SHA256> over the canonical string (contract.md)',
    }),
    ApiResponse(errorResponse(401)),
  );
}

/** The application that signed the request (set by AppSignatureGuard). */
export function signedAppOf(request: Request): AuthenticatedApp {
  const app = request.connectedApp;
  // Unreachable behind @AppSignature(): the guard sets it or refuses.
  if (app === undefined) throw new Error('@SignedApp() used on a route without @AppSignature()');
  return app;
}

/** The application that signed the request. */
export const SignedApp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedApp =>
    signedAppOf(context.switchToHttp().getRequest<Request>()),
);
