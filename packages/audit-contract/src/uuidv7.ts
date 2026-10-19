import { UUIDV7_PATTERN } from './patterns.js';

/**
 * Fills the array with cryptographically strong random bytes and returns it:
 * `crypto.getRandomValues` in Node.js and browsers, `getRandomValues` from
 * expo-crypto in React Native (which has no global crypto).
 */
export type RandomFill = (bytes: Uint8Array) => Uint8Array;

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/**
 * A UUID version 7 (RFC 9562): 48 bits of Unix milliseconds, then 74 random
 * bits. Time-ordered, so ids made later sort later, and unguessable.
 */
export function uuidv7(random: RandomFill, now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RangeError('uuidv7: timestamp out of range');
  }
  const bytes = random(new Uint8Array(16));
  let time = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  let text = '';
  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) text += '-';
    text += HEX[bytes[index] ?? 0] ?? '00';
  }
  return text;
}

export function isUuidv7(value: unknown): value is string {
  return typeof value === 'string' && UUIDV7_PATTERN.test(value);
}

/** The Unix milliseconds a UUIDv7 carries. */
export function uuidv7Time(value: string): number {
  if (!isUuidv7(value)) throw new TypeError('uuidv7Time: not a UUIDv7');
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}
