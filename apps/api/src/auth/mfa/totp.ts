import { createHmac, randomInt } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { encode } from 'uqr';

// Second factors (docs/adr/0012): TOTP (RFC 6238, SHA-1, 6 digits, 30 s, one
// step of tolerance either way) with otpauth, the enrollment QR with uqr
// (rows of modules the SPA draws as SVG), and recovery codes.

export const TOTP_ISSUER = 'Audit Hub';
export const TOTP_PERIOD_SEC = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
export const SECRET_BYTES = 20;

function totpOf(secret: Uint8Array, label = ''): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SEC,
    secret: new Secret({ buffer: new Uint8Array(secret).buffer }),
  });
}

/** What an authenticator app needs: the otpauth:// URI, its base32 secret, and its QR. */
export function enrollmentOf(secret: Uint8Array, label: string) {
  const totp = totpOf(secret, label);
  const uri = totp.toString();
  const { data } = encode(uri, { ecc: 'M', border: 0 });
  return {
    secret: totp.secret.base32,
    uri,
    /** One string per row, "1" for a dark module. */
    qr: data.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')),
  };
}

/**
 * The time step a code belongs to, when it is right for `secret` now and
 * newer than `lastUsedStep` (a code works once); undefined otherwise.
 */
export function acceptedStep(
  secret: Uint8Array,
  code: string,
  lastUsedStep: bigint | null,
  now: number = Date.now(),
): bigint | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const delta = totpOf(secret).validate({ token: code, timestamp: now, window: TOTP_WINDOW });
  if (delta === null) return undefined;
  const step = BigInt(TOTP.counter({ period: TOTP_PERIOD_SEC, timestamp: now }) + delta);
  if (lastUsedStep !== null && step <= lastUsedStep) return undefined;
  return step;
}

/** A code for `secret` at `now`: the seed and the tests sign in with it. */
export function codeAt(secret: Uint8Array, now: number = Date.now()): string {
  return totpOf(secret).generate({ timestamp: now });
}

// --- Recovery codes ------------------------------------------------------------
// Ten codes of ten characters of Crockford's base32 (about 50 bits each),
// shown once as xxxxx-xxxxx. Only HMAC(pepper, code) is stored.

const RECOVERY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const RECOVERY_CODES = 10;
const RECOVERY_LENGTH = 10;
/** RECOVERY_LENGTH characters of RECOVERY_ALPHABET (Crockford's base32, lower case). */
const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{10}$/;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODES }, () => {
    let code = '';
    for (let index = 0; index < RECOVERY_LENGTH; index += 1) {
      code += RECOVERY_ALPHABET.charAt(randomInt(RECOVERY_ALPHABET.length));
    }
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** As typed: any case, with or without the dash and spaces; o is 0, i and l are 1. */
export function normalizeRecoveryCode(input: string): string | undefined {
  const code = input.toLowerCase().replace(/[\s-]/g, '').replaceAll('o', '0').replace(/[il]/g, '1');
  return RECOVERY_CODE.test(code) ? code : undefined;
}

export function recoveryCodeHash(pepper: Uint8Array, normalized: string): string {
  return createHmac('sha256', pepper).update(normalized).digest('hex');
}
