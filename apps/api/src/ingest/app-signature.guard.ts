import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BODY_DIGEST_PREFIX,
  canonicalQuery,
  isFresh,
  NONCE_PATTERN,
  parseSignatureHeader,
  parseTimestamp,
  SIGNATURE_HEADERS,
  SIGNATURE_WINDOW_SEC,
} from 'audit-contract';
import { bodyDigest, safeEqual, verifySignature } from 'audit-contract/node';
import type { Request, Response } from 'express';
import { clientIp, pathOf } from '../common/logging/request-context.middleware.js';
import { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../infrastructure/rate-limit/rate-limit.store.js';
import {
  type IngestEndpoint,
  type IngestRequestOutcome,
  recordIngestRequest,
} from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Failed signatures one IP may send per minute before it gets 429s instead of 401s. */
export const FAILED_SIGNATURES_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

/** Which metric a path's requests count under. */
function endpointOf(path: string): IngestEndpoint {
  if (path.endsWith('/catalog')) return 'catalog';
  if (path.endsWith('/heartbeat')) return 'heartbeat';
  if (path.startsWith('/api/connector/')) return 'connector';
  return 'events';
}

// Machine-to-machine requests from connected applications (docs/adr/0006):
// HMAC-SHA256 over the method, path, query, timestamp, nonce, key id and the
// digest of the body's canonical JSON. Cheap checks first, state last: the
// nonce is stored only once the signature is valid, so nobody can fill the
// table without a key. Every refusal is counted, and the answer says why only
// when that reveals nothing (the clock skew).
//
// The global per-IP limit of the template still applies (it runs first); on
// top of it, failed signatures are limited per IP, and accepted requests per
// application, in the template's rate-limit store.
@Injectable()
export class AppSignatureGuard implements CanActivate {
  private readonly logger = new Logger('AppSignature');

  constructor(
    private readonly apps: ConnectedAppsService,
    private readonly prisma: PrismaService,
    @Inject(RATE_LIMIT_STORE) private readonly limits: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = pathOf(req);
    const endpoint = endpointOf(path);
    const now = Date.now();

    const keyId = req.get(SIGNATURE_HEADERS.keyId) ?? '';
    const timestamp = parseTimestamp(req.get(SIGNATURE_HEADERS.timestamp));
    const nonce = req.get(SIGNATURE_HEADERS.nonce) ?? '';
    const digest = req.get(SIGNATURE_HEADERS.bodyDigest) ?? '';
    const signatures = parseSignatureHeader(req.get(SIGNATURE_HEADERS.signature));
    if (
      !UUID.test(keyId) ||
      timestamp === undefined ||
      !NONCE_PATTERN.test(nonce) ||
      !digest.startsWith(BODY_DIGEST_PREFIX) ||
      signatures.length === 0
    ) {
      return this.refuse(req, res, 'unknown', endpoint, 'unauthorized');
    }
    if (!isFresh(timestamp, now, SIGNATURE_WINDOW_SEC)) {
      res.setHeader(SIGNATURE_HEADERS.error, 'timestamp_skew');
      return this.refuse(req, res, 'unknown', endpoint, 'timestamp_skew');
    }

    const key = await this.apps.verificationKey(keyId, new Date(now));
    if (key === undefined) return this.refuse(req, res, 'unknown', endpoint, 'unauthorized');
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    if (!safeEqual(bodyDigest(hasBody ? (req.body as unknown) : undefined), digest)) {
      return this.refuse(req, res, key.slug, endpoint, 'unauthorized');
    }
    const query = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    const parts = {
      method: req.method,
      path,
      query: canonicalQuery(query),
      timestamp,
      nonce,
      keyId,
      bodyDigest: digest,
    };
    if (!verifySignature([key.key], parts, signatures)) {
      return this.refuse(req, res, key.slug, endpoint, 'unauthorized');
    }
    // Suspended, or retired (its keys are gone with its log anyway).
    if (key.status !== 'active') {
      res.setHeader(SIGNATURE_HEADERS.error, 'app_suspended');
      recordIngestRequest(key.slug, endpoint, 'suspended');
      throw new ForbiddenException('Application suspended');
    }

    const { count } = await this.prisma.ingestNonce.createMany({
      data: [{ keyId, nonce, expiresAt: new Date(now + 2 * SIGNATURE_WINDOW_SEC * 1000) }],
      skipDuplicates: true,
    });
    if (count === 0) {
      this.logger.warn(`Replayed request refused (key ${keyId}, application ${key.slug})`);
      return this.refuse(req, res, key.slug, endpoint, 'replayed');
    }

    const quota = await this.limits.increment(
      `app:${key.appId}`,
      MINUTE_MS,
      key.rateLimitPerMinute,
      0,
      'ingest',
    );
    if (quota.isBlocked) {
      recordIngestRequest(key.slug, endpoint, 'rate_limited');
      res.setHeader('Retry-After', String(Math.max(1, quota.timeToBlockExpire)));
      throw new HttpException('Too many requests, retry later', HttpStatus.TOO_MANY_REQUESTS);
    }

    req.connectedApp = { appId: key.appId, slug: key.slug, keyId };
    recordIngestRequest(key.slug, endpoint, 'ok');
    return true;
  }

  /** 401, or 429 once this IP has failed too often (it stops costing HMACs and lookups). */
  private async refuse(
    req: Request,
    res: Response,
    app: string,
    endpoint: IngestEndpoint,
    outcome: IngestRequestOutcome,
  ): Promise<never> {
    const failures = await this.limits.increment(
      `failed:${clientIp(req)}`,
      MINUTE_MS,
      FAILED_SIGNATURES_PER_MINUTE,
      0,
      'ingest-auth',
    );
    if (failures.isBlocked) {
      recordIngestRequest(app, endpoint, 'rate_limited');
      res.setHeader('Retry-After', String(Math.max(1, failures.timeToBlockExpire)));
      throw new HttpException('Too many requests, retry later', HttpStatus.TOO_MANY_REQUESTS);
    }
    recordIngestRequest(app, endpoint, outcome);
    if (!res.hasHeader(SIGNATURE_HEADERS.error))
      res.setHeader(SIGNATURE_HEADERS.error, 'unauthorized');
    throw new UnauthorizedException('Invalid request signature');
  }
}
