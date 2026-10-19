import { createHmac } from 'node:crypto';
import { Secret } from 'otpauth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptedStep,
  codeAt,
  enrollmentOf,
  newRecoveryCodes,
  normalizeRecoveryCode,
  RECOVERY_CODES,
  recoveryCodeHash,
  TOTP_PERIOD_SEC,
} from './totp.js';

// RFC 6238, appendix B: the SHA-1 seed and its codes (the last six digits).
const SEED = Buffer.from('12345678901234567890');
const AT = 1_111_111_109_000;
const STEP = BigInt(Math.floor(AT / 1000 / TOTP_PERIOD_SEC));
const STEP_MS = TOTP_PERIOD_SEC * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe('TOTP codes', () => {
  it('makes the codes of the RFC 6238 test vectors', () => {
    expect(codeAt(SEED, 59_000)).toBe('287082');
    expect(codeAt(SEED, AT)).toBe('081804');
    expect(codeAt(SEED, 2_000_000_000_000)).toBe('279037');
  });

  it('accepts a right code, and says which time step it belongs to', () => {
    expect(acceptedStep(SEED, '081804', null, AT)).toBe(STEP);
  });

  it('tolerates one step of clock drift either way, never two', () => {
    expect(acceptedStep(SEED, codeAt(SEED, AT - STEP_MS), null, AT)).toBe(STEP - 1n);
    expect(acceptedStep(SEED, codeAt(SEED, AT + STEP_MS), null, AT)).toBe(STEP + 1n);
    expect(acceptedStep(SEED, codeAt(SEED, AT - 2 * STEP_MS), null, AT)).toBeUndefined();
    expect(acceptedStep(SEED, codeAt(SEED, AT + 2 * STEP_MS), null, AT)).toBeUndefined();
  });

  it('takes a code once: never for a step already used, nor an older one', () => {
    expect(acceptedStep(SEED, '081804', STEP, AT)).toBeUndefined();
    expect(acceptedStep(SEED, '081804', STEP + 1n, AT)).toBeUndefined();
    expect(acceptedStep(SEED, '081804', STEP - 1n, AT)).toBe(STEP);
  });

  it('refuses a wrong code, and anything but six digits without checking it', () => {
    const wrong = codeAt(SEED, AT) === '000000' ? '111111' : '000000';
    expect(acceptedStep(SEED, wrong, null, AT)).toBeUndefined();
    for (const malformed of ['', '81804', '0818040', '08180a', ' 081804', '081 804']) {
      expect(acceptedStep(SEED, malformed, null, AT)).toBeUndefined();
    }
  });

  it('works on the current time by default', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    expect(codeAt(SEED)).toBe('081804');
    expect(acceptedStep(SEED, '081804', null)).toBe(STEP);
  });

  it('gives an authenticator app the URI, the base32 secret and the QR of the same secret', () => {
    const enrollment = enrollmentOf(SEED, 'ada@example.test');
    expect(enrollment.secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(Buffer.from(Secret.fromBase32(enrollment.secret).bytes)).toEqual(SEED);
    expect(enrollment.uri).toBe(
      'otpauth://totp/Audit%20Hub:ada%40example.test?issuer=Audit%20Hub' +
        '&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=6&period=30', // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- RFC 6238's published test key
    );
    // A square of modules, without a quiet zone (the SPA draws it), both colours present.
    expect(enrollment.qr.length).toBeGreaterThan(20);
    for (const row of enrollment.qr) {
      expect(row).toMatch(/^[01]+$/);
      expect(row).toHaveLength(enrollment.qr.length);
    }
    const modules = enrollment.qr.join('');
    expect(modules).toContain('1');
    expect(modules).toContain('0');
  });

  it('leaves the secret it is given untouched (a copy goes into the TOTP)', () => {
    const secret = Buffer.from(SEED);
    enrollmentOf(secret, 'ada@example.test');
    codeAt(secret, AT);
    expect(secret).toEqual(SEED);
  });
});

describe('recovery codes', () => {
  it('makes ten distinct codes of ten Crockford base32 characters, shown as xxxxx-xxxxx', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODES);
    expect(new Set(codes).size).toBe(RECOVERY_CODES);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
      expect(normalizeRecoveryCode(code)).toBe(code.replace('-', ''));
    }
    expect(newRecoveryCodes()).not.toEqual(codes);
  });

  it('reads a code as typed: any case, spaces or dashes, o for 0, i and l for 1', () => {
    expect(normalizeRecoveryCode('ABCDE-FGHJK')).toBe('abcdefghjk');
    expect(normalizeRecoveryCode(' abcde fghjk ')).toBe('abcdefghjk');
    expect(normalizeRecoveryCode('a-b-c-d-e-f-g-h-j-k')).toBe('abcdefghjk');
    expect(normalizeRecoveryCode('oOiIlL2345')).toBe('0011112345');
  });

  it('refuses a code of another length, or with a letter outside the alphabet', () => {
    expect(normalizeRecoveryCode('')).toBeUndefined();
    expect(normalizeRecoveryCode('abcde-fghj')).toBeUndefined();
    expect(normalizeRecoveryCode('abcde-fghjkm')).toBeUndefined();
    // u is not in Crockford's base32.
    expect(normalizeRecoveryCode('abcde-fghju')).toBeUndefined();
    expect(normalizeRecoveryCode('abcde_fghjk')).toBeUndefined();
  });

  it('stores an HMAC-SHA256 of the code, keyed by the pepper', () => {
    const pepper = Buffer.alloc(32, 7);
    const hash = recoveryCodeHash(pepper, 'abcdefghjk');
    expect(hash).toBe(createHmac('sha256', pepper).update('abcdefghjk').digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(recoveryCodeHash(Buffer.alloc(32, 8), 'abcdefghjk')).not.toBe(hash);
    expect(recoveryCodeHash(pepper, 'abcdefghjm')).not.toBe(hash);
  });
});
