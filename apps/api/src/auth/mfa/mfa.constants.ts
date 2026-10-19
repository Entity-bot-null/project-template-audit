/**
 * Provider token, and type, of the recovery codes' peppers: the current one
 * first (it hashes new codes), then the previous one during an
 * AUDIT_SECRETS_KEY rotation (it still checks codes made before).
 */
export const MFA_PEPPERS = Symbol('MFA_PEPPERS');
export type MfaPeppers = readonly Buffer[];

/**
 * Verifying a code and stepping up, per IP: 10 a minute, as sign-in (each
 * challenge also allows 5 codes at most, and challenges come from sign-ins).
 */
export const MFA_RATE_LIMIT = { limit: 10, ttlSec: 60 };
