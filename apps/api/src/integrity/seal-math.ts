import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from 'audit-contract';

// The arithmetic of integrity seals (docs/adr/0008): pure functions, shared by
// the sealer, the verifier and the offline export. A seal covers one stream
// (application, category) and one time window; its leaves are the window's
// events in (recorded_at, id) order, each as its 16-byte id and its 32-byte
// content hash.

export const SEAL_VERSION = 'seal-v1';
export const CHECKPOINT_VERSION = 'checkpoint-v1';
export const LEAF_BYTES = 48;
export const GENESIS_HASH = new Uint8Array(32);

export interface Leaf {
  eventPk: string;
  contentHash: Uint8Array;
}

const uuidBytes = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex');

const uuidText = (bytes: Buffer) => {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The leaves of a seal, concatenated: what integrity_seal_leaves stores. */
export function encodeLeaves(leaves: readonly Leaf[]): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.alloc(leaves.length * LEAF_BYTES);
  leaves.forEach((leaf, index) => {
    uuidBytes(leaf.eventPk).copy(buffer, index * LEAF_BYTES);
    Buffer.from(leaf.contentHash).copy(buffer, index * LEAF_BYTES + 16);
  });
  return new Uint8Array(buffer);
}

export function decodeLeaves(encoded: Uint8Array): Leaf[] {
  const buffer = Buffer.from(encoded);
  if (buffer.length % LEAF_BYTES !== 0) throw new Error('Leaves are not a whole number of entries');
  const leaves: Leaf[] = [];
  for (let offset = 0; offset < buffer.length; offset += LEAF_BYTES) {
    leaves.push({
      eventPk: uuidText(buffer.subarray(offset, offset + 16)),
      contentHash: new Uint8Array(buffer.subarray(offset + 16, offset + LEAF_BYTES)),
    });
  }
  return leaves;
}

export const sha256 = (data: Uint8Array | string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHash('sha256').update(data).digest());

export const hmac = (key: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHmac('sha256', key).update(data).digest());

export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SealFields {
  appId: string;
  category: string;
  sealNo: bigint;
  windowFrom: Date;
  windowTo: Date;
  eventCount: number;
  leavesDigest: Uint8Array;
  prevHash: Uint8Array;
}

/** SHA-256 over the seal's fields and the previous seal's hash: the chain. */
export function sealHash(fields: SealFields): Uint8Array<ArrayBuffer> {
  return sha256(
    canonicalJson({
      v: SEAL_VERSION,
      appId: fields.appId,
      category: fields.category,
      sealNo: fields.sealNo.toString(),
      windowFrom: fields.windowFrom.toISOString(),
      windowTo: fields.windowTo.toISOString(),
      eventCount: fields.eventCount,
      leavesDigest: hex(fields.leavesDigest),
      prevHash: hex(fields.prevHash),
    }),
  );
}

/** The heads of every stream, as a daily checkpoint signs them. */
export function checkpointDigest(
  heads: Record<string, { sealNo: string; sealHash: string }>,
): Uint8Array<ArrayBuffer> {
  return sha256(canonicalJson({ v: CHECKPOINT_VERSION, heads }));
}
