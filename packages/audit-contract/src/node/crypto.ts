import { createHash, createHmac, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';
import { canonicalJson } from '../canonical-json.js';
import { normalizeEmail } from '../masking.js';
import {
  BODY_DIGEST_PREFIX,
  formatSignatureHeader,
  SIGNATURE_HEADERS,
  type SignedParts,
  stringToSign,
} from '../signing.js';

// The Node.js side of the contract: hashes, HMACs and the signing of requests
// and webhooks. Secrets travel in environment variables as base64url (32
// random bytes); keys are their decoded bytes.

/** 32 random bytes as base64url: a new key, webhook secret or pseudonymization key. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The key bytes of a base64url secret; refuses anything shorter than 32 bytes. */
export function secretKey(secret: string): Buffer {
  const key = Buffer.from(secret, 'base64url');
  if (key.length < 32 || key.toString('base64url') !== secret) {
    throw new TypeError('secret must be at least 32 bytes as base64url');
  }
  return key;
}

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256Base64url(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('base64url');
}

export function hmacHex(key: Uint8Array, text: string): string {
  return createHmac('sha256', key).update(text).digest('hex');
}

/** The pseudonym an email travels as: HMAC of the normalized address, with the app's key. */
export function emailHmac(key: Uint8Array, email: string): string {
  return hmacHex(key, normalizeEmail(email));
}

/** Audit-Body-Digest of a parsed JSON body (undefined: no body). */
export function bodyDigest(body: unknown): string {
  return `${BODY_DIGEST_PREFIX}${sha256Base64url(body === undefined ? '' : canonicalJson(body))}`;
}

export function signature(key: Uint8Array, parts: SignedParts): string {
  return createHmac('sha256', key).update(stringToSign(parts)).digest('base64url');
}

/** 16 random bytes as base64url (22 characters). */
export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}

export interface SignRequestInput {
  keyId: string;
  key: Uint8Array;
  method: string;
  path: string;
  query?: string;
  body?: unknown;
  /** Milliseconds. */
  now?: number;
  nonce?: string;
}

/** The headers of a signed request to Audit Hub. */
export function signRequest(input: SignRequestInput): Record<string, string> {
  const parts: SignedParts = {
    method: input.method,
    path: input.path,
    query: input.query ?? '',
    timestamp: Math.floor((input.now ?? Date.now()) / 1000),
    nonce: input.nonce ?? newNonce(),
    keyId: input.keyId,
    bodyDigest: bodyDigest(input.body),
  };
  return {
    [SIGNATURE_HEADERS.keyId]: parts.keyId,
    [SIGNATURE_HEADERS.timestamp]: String(parts.timestamp),
    [SIGNATURE_HEADERS.nonce]: parts.nonce,
    [SIGNATURE_HEADERS.bodyDigest]: parts.bodyDigest,
    [SIGNATURE_HEADERS.signature]: formatSignatureHeader([signature(input.key, parts)]),
  };
}

export interface SignWebhookInput {
  /** Current key first; the previous one during a rotation. */
  keys: readonly Uint8Array[];
  appSlug: string;
  deliveryId: string;
  path: string;
  body: unknown;
  now?: number;
}

/** The headers of a signed webhook delivery (one signature per key). */
export function signWebhook(input: SignWebhookInput): Record<string, string> {
  const parts: SignedParts = {
    method: 'POST',
    path: input.path,
    query: '',
    timestamp: Math.floor((input.now ?? Date.now()) / 1000),
    nonce: input.deliveryId,
    keyId: input.appSlug,
    bodyDigest: bodyDigest(input.body),
  };
  return {
    [SIGNATURE_HEADERS.webhookId]: input.deliveryId,
    [SIGNATURE_HEADERS.timestamp]: String(parts.timestamp),
    [SIGNATURE_HEADERS.bodyDigest]: parts.bodyDigest,
    [SIGNATURE_HEADERS.signature]: formatSignatureHeader(
      input.keys.map((key) => signature(key, parts)),
    ),
  };
}

/** Constant-time comparison of two base64url strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether any of the signatures matches any of the keys. */
export function verifySignature(
  keys: readonly Uint8Array[],
  parts: SignedParts,
  signatures: readonly string[],
): boolean {
  let valid = false;
  for (const key of keys) {
    const expected = signature(key, parts);
    // Every comparison runs: the time taken never says which one matched.
    for (const candidate of signatures) valid = safeEqual(expected, candidate) || valid;
  }
  return valid;
}

/** The random source of the contract's UUIDv7 on Node.js. */
export const nodeRandomFill = (bytes: Uint8Array): Uint8Array => webcrypto.getRandomValues(bytes);
