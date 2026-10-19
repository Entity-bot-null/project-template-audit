// JSON Canonicalization Scheme (RFC 8785) for the JSON values the contract
// carries: what request signatures and content hashes cover, so the same
// value gives the same bytes on every side, whatever the key order or the
// spacing it travelled with.
//
// ECMAScript's JSON.stringify already serializes numbers and strings the way
// RFC 8785 requires (section 3.2.2); what remains is sorting object keys by
// UTF-16 code units, and refusing what JSON cannot represent exactly.

import { isWellFormed } from './unicode.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  override readonly name = 'CanonicalJsonError';
}

export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: not a finite number`);
      return JSON.stringify(value);
    case 'string':
      if (!isWellFormed(value)) throw new CanonicalJsonError(`${path}: lone surrogate`);
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? serializeArray(value, path) : serializeObject(value, path);
    default:
      throw new CanonicalJsonError(`${path}: ${typeof value} is not JSON`);
  }
}

function serializeArray(items: readonly unknown[], path: string): string {
  return `[${items.map((item, index) => serialize(item, `${path}[${String(index)}]`)).join(',')}]`;
}

function serializeObject(object: object, path: string): string {
  const prototype: unknown = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(`${path}: only plain objects are JSON`);
  }
  const entries = Object.entries(object).filter(([, item]) => item !== undefined);
  // Default sort: UTF-16 code units, which is what RFC 8785 asks for.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const members = entries.map(([key, item]) => {
    if (!isWellFormed(key)) throw new CanonicalJsonError(`${path}: key with a lone surrogate`);
    return `${JSON.stringify(key)}:${serialize(item, `${path}.${key}`)}`;
  });
  return `{${members.join(',')}}`;
}

/** UTF-8 size of the canonical form: the size limits of the contract use it. */
export function canonicalJsonBytes(value: unknown): number {
  return utf8Length(canonicalJson(value));
}

/** Nesting depth: 0 for a scalar, 1 for an object of scalars. */
export function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  let deepest = 0;
  for (const child of children) deepest = Math.max(deepest, jsonDepth(child));
  return deepest + 1;
}

/** UTF-8 length of a well-formed string, without TextEncoder (React Native). */
export function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}
