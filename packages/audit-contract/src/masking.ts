// Minimization at the origin (brief, section 12): what leaves the application
// is already masked. Audit Hub never needs the clear value to search: emails
// travel as an HMAC (src/node/pseudonym.ts), labels as masks.

/** The marker a sensitive value is replaced with before it is queued. */
export const REDACTED = '[REDACTED]';

/** What a personal value becomes in the event once it moved to the satellite table. */
export const PERSONAL_PLACEHOLDER = Object.freeze({ $personal: true });

/** Trimmed and lowercased, as the template stores addresses (normalizeEmail). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** j***@e***.com: enough to recognize an account, not to write to it. */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return maskWord(normalized);
  const domain = normalized.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const suffix = dot > 0 ? domain.slice(dot) : '';
  return `${maskWord(normalized.slice(0, at))}@${maskWord(host)}${suffix}`;
}

/** J*** D***: the initials of a name. */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map(maskWord)
    .join(' ');
}

function maskWord(word: string): string {
  const first = Array.from(word)[0];
  return first === undefined ? '' : `${first}***`;
}

/** •••• 1234: enough to recognize a phone, not to call it. Undefined without four digits. */
export function maskPhone(phone: string): string | undefined {
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length < 4 ? undefined : `•••• ${digits.slice(-4)}`;
}

/** An approximate position's decimals: about 1.1 km of latitude. */
export const COARSE_DECIMALS = 2;
/** A precise position's decimals (consent to the precise position): about 1.1 m. */
export const PRECISE_DECIMALS = 5;
/** Accuracy from which a position counts as approximate. */
export const COARSE_ACCURACY_M = 1000;

/**
 * A position's precision follows its accuracy: a precise one (better than
 * COARSE_ACCURACY_M, which the device reports only when the person allowed
 * the precise position) keeps five decimals; any other is rounded to two, on
 * the device and again when Audit Hub receives it.
 */
export function locationDecimals(accuracyMeters: number | null | undefined): number {
  return accuracyMeters !== null &&
    accuracyMeters !== undefined &&
    accuracyMeters < COARSE_ACCURACY_M
    ? PRECISE_DECIMALS
    : COARSE_DECIMALS;
}

export function roundCoordinate(value: number, decimals: number = COARSE_DECIMALS): number {
  const factor = 10 ** decimals;
  // + 0: never -0, which canonical JSON would write as 0 anyway.
  return Math.round(value * factor) / factor + 0;
}

/** The accuracy a rounded position can claim: never better than 1 km. */
export function coarseAccuracy(accuracyMeters: number | null | undefined): number {
  const value = accuracyMeters ?? COARSE_ACCURACY_M;
  return Math.min(100_000, Math.max(COARSE_ACCURACY_M, Math.round(value)));
}

/** A position's accuracy as stored: a precise one as reported (1 m at best), an approximate one coarse. */
export function locationAccuracy(accuracyMeters: number | null | undefined): number {
  return locationDecimals(accuracyMeters) === PRECISE_DECIMALS
    ? Math.max(1, Math.round(accuracyMeters ?? COARSE_ACCURACY_M))
    : coarseAccuracy(accuracyMeters);
}
