import { describe, expect, it } from 'vitest';
import { isUuidv7, type RandomFill, uuidv7, uuidv7Time } from './uuidv7.js';

// Random bytes from what every place these specs run has (Node.js, Jest in
// the app, jsdom in the web app): the callers pass a cryptographic source.
const random: RandomFill = (bytes) => bytes.map(() => Math.floor(Math.random() * 256));

const zeros = (bytes: Uint8Array) => bytes.fill(0);
const ones = (bytes: Uint8Array) => bytes.fill(0xff);

describe('uuidv7', () => {
  it('lays out the timestamp, version and variant of RFC 9562', () => {
    // RFC 9562 appendix A.6: 2022-02-22T19:22:22Z = 0x017F22E279B0.
    expect(uuidv7(zeros, 0x017f22e279b0)).toBe('017f22e2-79b0-7000-8000-000000000000');
    expect(uuidv7(ones, 0x017f22e279b0)).toBe('017f22e2-79b0-7fff-bfff-ffffffffffff');
  });

  it('is unique and ordered by time with random bytes', () => {
    const first = uuidv7(random, 1_000);
    const second = uuidv7(random, 2_000);
    expect(isUuidv7(first)).toBe(true);
    expect(first).not.toBe(uuidv7(random, 1_000));
    expect(first < second).toBe(true);
    expect(uuidv7Time(second)).toBe(2_000);
  });

  it('refuses timestamps it cannot represent', () => {
    expect(() => uuidv7(zeros, -1)).toThrow(RangeError);
    expect(() => uuidv7(zeros, 2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(zeros, 1.5)).toThrow(RangeError);
  });

  it('recognizes only version 7 with the RFC variant', () => {
    expect(isUuidv7('017f22e2-79b0-7000-8000-000000000000')).toBe(true);
    expect(isUuidv7('017f22e2-79b0-4000-8000-000000000000')).toBe(false);
    expect(isUuidv7('017f22e2-79b0-7000-c000-000000000000')).toBe(false);
    expect(isUuidv7('017F22E2-79B0-7000-8000-000000000000')).toBe(false);
    expect(isUuidv7(42)).toBe(false);
    expect(() => uuidv7Time('nope')).toThrow(TypeError);
  });
});
