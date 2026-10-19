import { describe, expect, it } from 'vitest';
import {
  bytesEqual,
  checkpointDigest,
  decodeLeaves,
  encodeLeaves,
  GENESIS_HASH,
  hex,
  hmac,
  LEAF_BYTES,
  type SealFields,
  sealHash,
  sha256,
} from './seal-math.js';

const leaf = (n: number) => ({
  eventPk: `0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f7${String(n)}`,
  contentHash: sha256(`event ${String(n)}`),
});

const fields: SealFields = {
  appId: '0199e0b1-0000-7000-8000-000000000001',
  category: 'security',
  sealNo: 1n,
  windowFrom: new Date('2026-10-14T12:00:00.000Z'),
  windowTo: new Date('2026-10-14T12:01:00.000Z'),
  eventCount: 2,
  leavesDigest: sha256('leaves'),
  prevHash: GENESIS_HASH,
};

describe('seal math', () => {
  it('encodes leaves as 48 bytes each and decodes them back', () => {
    const leaves = [leaf(0), leaf(1)];
    const encoded = encodeLeaves(leaves);
    expect(encoded).toHaveLength(2 * LEAF_BYTES);
    expect(decodeLeaves(encoded)).toEqual(leaves);
    expect(decodeLeaves(encodeLeaves([]))).toEqual([]);
  });

  it('refuses leaves that are not whole entries', () => {
    expect(() => decodeLeaves(new Uint8Array(LEAF_BYTES + 1))).toThrow(/whole number/);
  });

  it('chains a seal to every one of its fields and to the previous hash', () => {
    const hash = sealHash(fields);
    expect(hash).toHaveLength(32);
    expect(bytesEqual(sealHash({ ...fields }), hash)).toBe(true);
    const changed: Partial<SealFields>[] = [
      { appId: '0199e0b1-0000-7000-8000-000000000002' },
      { category: 'audit' },
      { sealNo: 2n },
      { windowFrom: new Date('2026-10-14T11:59:59.999Z') },
      { windowTo: new Date('2026-10-14T12:01:00.001Z') },
      { eventCount: 3 },
      { leavesDigest: sha256('other leaves') },
      { prevHash: sha256('another seal') },
    ];
    for (const change of changed) {
      expect(bytesEqual(sealHash({ ...fields, ...change }), hash), Object.keys(change)[0]).toBe(
        false,
      );
    }
  });

  it('digests checkpoints whatever the order of the heads', () => {
    const a = { sealNo: '1', sealHash: hex(sha256('a')) };
    const b = { sealNo: '4', sealHash: hex(sha256('b')) };
    expect(hex(checkpointDigest({ 'x:security': a, 'y:audit': b }))).toBe(
      hex(checkpointDigest({ 'y:audit': b, 'x:security': a })),
    );
    expect(hex(checkpointDigest({ 'x:security': a }))).not.toBe(
      hex(checkpointDigest({ 'x:security': b })),
    );
  });

  it('compares bytes of any length and signs with a key', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    const data = sha256('seal');
    expect(hex(hmac(new Uint8Array(32), data))).not.toBe(
      hex(hmac(new Uint8Array(32).fill(1), data)),
    );
    expect(hex(GENESIS_HASH)).toBe('0'.repeat(64));
  });
});
