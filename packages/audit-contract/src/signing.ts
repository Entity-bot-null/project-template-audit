// Request signing between applications and Audit Hub (ADR 0006): HMAC-SHA256
// over a canonical string that names the method, the path, the query, a
// timestamp, a single-use nonce, the key and the digest of the body's
// canonical JSON. The same scheme signs webhooks the other way, with the
// delivery id in the nonce's place and the application's slug as the key id.
// The cryptography itself is in src/node/ (Node.js only).

/** Header names, lowercase as Node.js reads them. */
export const SIGNATURE_HEADERS = {
  keyId: 'audit-key-id',
  timestamp: 'audit-timestamp',
  nonce: 'audit-nonce',
  bodyDigest: 'audit-body-digest',
  signature: 'audit-signature',
  webhookId: 'audit-webhook-id',
  /** On a refused request: why, when saying so reveals nothing. */
  error: 'audit-error',
} as const;

export const SIGNATURE_SCHEME = 'AUDIT-HMAC-SHA256-V1';
export const BODY_DIGEST_PREFIX = 'sha-256=';
const SIGNATURE_VERSION = 'v1=';
/** More than two signatures (a rotation) is never legitimate. */
const MAX_SIGNATURES = 4;

export const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SignedParts {
  method: string;
  /** Path only, no host and no query: /api/ingest/events. */
  path: string;
  /** canonicalQuery() of the query string; empty when there is none. */
  query: string;
  /** Unix seconds. */
  timestamp: number;
  /** The nonce, or a webhook's delivery id. */
  nonce: string;
  /** The key's id, or the application's slug for a webhook. */
  keyId: string;
  /** The Audit-Body-Digest header's value. */
  bodyDigest: string;
}

export function stringToSign(parts: SignedParts): string {
  return [
    SIGNATURE_SCHEME,
    parts.method.toUpperCase(),
    parts.path,
    parts.query,
    String(parts.timestamp),
    parts.nonce,
    parts.keyId,
    parts.bodyDigest,
  ].join('\n');
}

// RFC 3986 unreserved characters stay; encodeURIComponent leaves !'()* too.
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Query parameters sorted by name, then value, each encoded (RFC 3986). */
export function canonicalQuery(params: Iterable<readonly [string, string]>): string {
  return Array.from(params, ([name, value]) => `${encode(name)}=${encode(value)}`)
    .sort()
    .join('&');
}

/** The signatures an Audit-Signature header carries ("v1=<sig>", space separated). */
export function parseSignatureHeader(value: string | undefined): string[] {
  if (value === undefined || value.length > 1024) return [];
  const signatures = value
    .split(' ')
    .filter((part) => part.startsWith(SIGNATURE_VERSION))
    .map((part) => part.slice(SIGNATURE_VERSION.length))
    .filter((signature) => BASE64URL_SHA256_PATTERN.test(signature));
  return signatures.length > MAX_SIGNATURES ? [] : signatures;
}

export function formatSignatureHeader(signatures: readonly string[]): string {
  return signatures.map((signature) => `${SIGNATURE_VERSION}${signature}`).join(' ');
}

/** Whether a timestamp (Unix seconds) is inside the window around `now` (ms). */
export function isFresh(timestamp: number, now: number, windowSec: number): boolean {
  return Number.isSafeInteger(timestamp) && Math.abs(now / 1000 - timestamp) <= windowSec;
}

/** Audit-Timestamp parsed strictly: digits only. */
export function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,12}$/.test(value)) return undefined;
  return Number(value);
}
