import { describe, expect, it } from 'vitest';
import { integrityKeyring, integrityKeyringFromEnv } from './integrity-keys.js';

const KEY = 'k'.repeat(64);
const PREVIOUS = 'p'.repeat(64);
const FALLBACK = 'f'.repeat(64);

describe('integrityKeyring', () => {
  it('signs with the configured key and verifies with the previous one too', () => {
    const ring = integrityKeyring({ key: KEY, previous: PREVIOUS, fallback: FALLBACK });
    expect(ring.fallback).toBe(false);
    expect(ring.all.map((key) => key.id)).toEqual([
      ring.current.id,
      integrityKeyring({ key: PREVIOUS, previous: undefined, fallback: FALLBACK }).current.id,
    ]);
    expect(ring.current.id).toMatch(/^[0-9a-f]{16}$/);
    expect(ring.current.key).toHaveLength(32);
  });

  it('derives a development key from the fallback, never equal to a configured one', () => {
    const ring = integrityKeyring({ key: undefined, previous: undefined, fallback: FALLBACK });
    expect(ring.fallback).toBe(true);
    expect(ring.all).toHaveLength(1);
    // The same secret as AUDIT_INTEGRITY_KEY still gives another key.
    const configured = integrityKeyring({ key: FALLBACK, previous: undefined, fallback: KEY });
    expect(ring.current.id).not.toBe(configured.current.id);
  });

  it('reads the environment (the unit specs set no AUDIT_INTEGRITY_KEY)', () => {
    expect(integrityKeyringFromEnv().fallback).toBe(true);
  });
});
