import { describe, expect, it } from 'vitest';
import {
  deriveSecretKey,
  derivedKey,
  SecretBox,
  SecretBoxError,
  secretBoxFromConfig,
} from './secret-box.js';

const CURRENT = 'c'.repeat(64);
const PREVIOUS = 'p'.repeat(64);
const JWT = 'j'.repeat(64);

describe('SecretBox', () => {
  const { box } = secretBoxFromConfig({ secret: CURRENT, previous: undefined, fallback: JWT });

  it('seals and opens a secret in its context', () => {
    const sealed = box.seal(Buffer.from('secret'), 'app_keys:1');
    expect(sealed.keyId).toBe(box.currentKeyId);
    expect(Buffer.from(sealed.ciphertext).includes('secret')).toBe(false);
    expect(box.open(sealed.ciphertext, 'app_keys:1').toString()).toBe('secret');
  });

  it('refuses a ciphertext moved to another context, tampered with or malformed', () => {
    const { ciphertext } = box.seal(Buffer.from('secret'), 'app_keys:1');
    expect(() => box.open(ciphertext, 'app_keys:2')).toThrow(SecretBoxError);
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => box.open(tampered, 'app_keys:1')).toThrow('does not authenticate');
    expect(() => box.open(Buffer.from([9, 1, 2]), 'app_keys:1')).toThrow('Malformed');
    const otherKey = Buffer.from(ciphertext);
    otherKey.write('0000000000000000', 1, 'latin1');
    expect(() => box.open(otherKey, 'app_keys:1')).toThrow('No configured key');
  });

  it('decrypts with the previous key during a rotation, and says what is stale', () => {
    const old = secretBoxFromConfig({ secret: PREVIOUS, previous: undefined, fallback: JWT }).box;
    const sealed = old.seal(Buffer.from('kept'), 'ctx');
    const rotated = secretBoxFromConfig({ secret: CURRENT, previous: PREVIOUS, fallback: JWT }).box;
    expect(rotated.open(sealed.ciphertext, 'ctx').toString()).toBe('kept');
    expect(rotated.isStale(sealed.ciphertext)).toBe(true);
    expect(rotated.isStale(rotated.seal(Buffer.from('new'), 'ctx').ciphertext)).toBe(false);
  });

  it('falls back to a key derived from the JWT secret outside production', () => {
    const { box: fallbackBox, fallback } = secretBoxFromConfig({
      secret: undefined,
      previous: undefined,
      fallback: JWT,
    });
    expect(fallback).toBe(true);
    expect(fallbackBox.currentKeyId).not.toBe(box.currentKeyId);
    expect(() => new SecretBox([])).toThrow(SecretBoxError);
  });

  it('derives stable, distinct keys per purpose', () => {
    expect(deriveSecretKey(CURRENT, 'a').id).toBe(deriveSecretKey(CURRENT, 'a').id);
    expect(deriveSecretKey(CURRENT, 'a').id).not.toBe(deriveSecretKey(CURRENT, 'b').id);
    const config = { secret: undefined, previous: undefined, fallback: JWT };
    expect(derivedKey(config, 'pepper')).toHaveLength(32);
  });
});
