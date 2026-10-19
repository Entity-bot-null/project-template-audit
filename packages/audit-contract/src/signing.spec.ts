import { describe, expect, it } from 'vitest';
import {
  bodyDigest,
  emailHmac,
  hmacHex,
  newNonce,
  newSecret,
  safeEqual,
  secretKey,
  sha256Base64url,
  signRequest,
  signWebhook,
  signature,
  verifySignature,
} from './node/crypto.js';
import {
  canonicalQuery,
  formatSignatureHeader,
  isFresh,
  NONCE_PATTERN,
  parseSignatureHeader,
  parseTimestamp,
  SIGNATURE_HEADERS,
  type SignedParts,
  stringToSign,
} from './signing.js';

const key = secretKey(Buffer.alloc(32, 7).toString('base64url'));
const other = secretKey(Buffer.alloc(32, 9).toString('base64url'));

const parts: SignedParts = {
  method: 'post',
  path: '/api/ingest/events',
  query: '',
  timestamp: 1_760_443_200,
  nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
  keyId: '0199e0b1-0000-7000-8000-000000000001',
  bodyDigest: bodyDigest({ b: 1, a: 2 }),
};

describe('string to sign', () => {
  it('names every part on its own line, method upper-cased', () => {
    expect(stringToSign(parts).split('\n')).toEqual([
      'AUDIT-HMAC-SHA256-V1',
      'POST',
      '/api/ingest/events',
      '',
      '1760443200',
      'AAAAAAAAAAAAAAAAAAAAAA',
      '0199e0b1-0000-7000-8000-000000000001',
      parts.bodyDigest,
    ]);
  });

  it('digests the canonical JSON, so key order and spacing do not matter', () => {
    expect(bodyDigest({ a: 2, b: 1 })).toBe(parts.bodyDigest);
    expect(bodyDigest(undefined)).toBe(`sha-256=${sha256Base64url('')}`);
    expect(bodyDigest({ a: 3, b: 1 })).not.toBe(parts.bodyDigest);
  });

  it('sorts and encodes the query', () => {
    expect(
      canonicalQuery([
        ['limit', '20'],
        ['cursor', "a b!'()*"],
        ['a', '2'],
        ['a', '1'],
      ]),
    ).toBe('a=1&a=2&cursor=a%20b%21%27%28%29%2A&limit=20');
    expect(canonicalQuery([])).toBe('');
  });
});

describe('signatures', () => {
  it('signs a request that verifies with its key and no other', () => {
    const headers = signRequest({
      keyId: parts.keyId,
      key,
      method: 'POST',
      path: parts.path,
      body: { a: 2, b: 1 },
      now: parts.timestamp * 1000,
      nonce: parts.nonce,
    });
    expect(headers[SIGNATURE_HEADERS.bodyDigest]).toBe(parts.bodyDigest);
    const signatures = parseSignatureHeader(headers[SIGNATURE_HEADERS.signature]);
    expect(signatures).toEqual([signature(key, parts)]);
    expect(verifySignature([key], { ...parts, method: 'POST' }, signatures)).toBe(true);
    expect(verifySignature([other], parts, signatures)).toBe(false);
    expect(verifySignature([key], { ...parts, path: '/api/ingest/catalog' }, signatures)).toBe(
      false,
    );
    expect(verifySignature([key], { ...parts, timestamp: parts.timestamp + 1 }, signatures)).toBe(
      false,
    );
  });

  it('signs webhooks with every key during a rotation', () => {
    const headers = signWebhook({
      keys: [key, other],
      appSlug: 'my-project',
      deliveryId: '0199e0b1-0000-7000-8000-000000000002',
      path: '/api/audit/webhooks',
      body: { type: 'ping' },
    });
    const signatures = parseSignatureHeader(headers[SIGNATURE_HEADERS.signature]);
    expect(signatures).toHaveLength(2);
    const webhookParts: SignedParts = {
      method: 'POST',
      path: '/api/audit/webhooks',
      query: '',
      timestamp: Number(headers[SIGNATURE_HEADERS.timestamp]),
      nonce: headers[SIGNATURE_HEADERS.webhookId]!,
      keyId: 'my-project',
      bodyDigest: headers[SIGNATURE_HEADERS.bodyDigest]!,
    };
    expect(verifySignature([other], webhookParts, signatures)).toBe(true);
    const now = Date.now();
    const timed = signWebhook({
      keys: [key],
      appSlug: 'a',
      deliveryId: 'd',
      path: '/',
      body: {},
      now,
    });
    expect(timed[SIGNATURE_HEADERS.timestamp]).toBe(String(Math.floor(now / 1000)));
  });

  it('parses signature headers defensively', () => {
    const sig = 'A'.repeat(43);
    expect(parseSignatureHeader(`v1=${sig} v2=${sig} v1=short`)).toEqual([sig]);
    expect(parseSignatureHeader(undefined)).toEqual([]);
    expect(parseSignatureHeader('x'.repeat(2000))).toEqual([]);
    expect(parseSignatureHeader(Array.from({ length: 5 }, () => `v1=${sig}`).join(' '))).toEqual(
      [],
    );
    expect(formatSignatureHeader([sig, sig])).toBe(`v1=${sig} v1=${sig}`);
  });

  it('checks the time window and the timestamp format', () => {
    const now = parts.timestamp * 1000;
    expect(isFresh(parts.timestamp - 300, now, 300)).toBe(true);
    expect(isFresh(parts.timestamp + 301, now, 300)).toBe(false);
    expect(isFresh(1.5, now, 300)).toBe(false);
    expect(parseTimestamp('1760443200')).toBe(1_760_443_200);
    expect(parseTimestamp('1e9')).toBeUndefined();
    expect(parseTimestamp(undefined)).toBeUndefined();
  });
});

describe('secrets and pseudonyms', () => {
  it('makes and reads 32-byte base64url secrets', () => {
    const secret = newSecret();
    expect(secretKey(secret)).toHaveLength(32);
    expect(() => secretKey('short')).toThrow(TypeError);
    expect(() => secretKey(`${secret}=`)).toThrow(TypeError);
    expect(newNonce()).toMatch(NONCE_PATTERN);
  });

  it('pseudonymizes emails per key, after normalizing them', () => {
    expect(emailHmac(key, ' John@Example.com ')).toBe(hmacHex(key, 'john@example.com'));
    expect(emailHmac(key, 'john@example.com')).not.toBe(emailHmac(other, 'john@example.com'));
  });

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});
