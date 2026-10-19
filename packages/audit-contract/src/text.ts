// Text that arrives in events is stored and shown as text, never interpreted.
// Before that it is normalized, so the same text is stored the same way, and
// bounded, so a long value is cut and marked instead of rejected.

import { toWellFormed } from './unicode.js';

// C0 controls but tab, line feed and carriage return; DEL; C1 controls.
// PostgreSQL refuses U+0000 in text and jsonb outright.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface SanitizedText {
  value: string;
  /** The value was longer than the limit and was cut. */
  truncated: boolean;
}

/**
 * NFC, without control characters, lone surrogates replaced by U+FFFD, and at
 * most `maxLength` UTF-16 code units (the unit Zod's max() counts), never
 * splitting a surrogate pair.
 */
export function sanitizeText(input: string, maxLength: number): SanitizedText {
  const value = toWellFormed(input).normalize('NFC').replace(CONTROLS, '');
  if (value.length <= maxLength) return { value, truncated: false };
  let end = maxLength;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { value: value.slice(0, end), truncated: true };
}
