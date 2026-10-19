import { type Change, type JsonValue, REDACTED } from './contract/index.js';
import { type Actions, actionSpec } from './catalog/catalog.js';

/** A record's state before or after the change: the explicit select it was read with. */
export type RecordState = Record<string, unknown> | null | undefined;

/**
 * The change an event describes (contract: `change`), from the record as it
 * was read in the transaction before the write and as it is after it. Only
 * the fields the action declares in the catalog travel; a sensitive one as
 * "[REDACTED]", whatever its value; a personal one as it is (Audit Hub keeps
 * it apart, and erases it on request). `changedFields` lists those that
 * differ.
 */
export function changeOf(
  action: string,
  before: RecordState,
  after: RecordState,
  actions?: Actions,
): Change {
  const fields = actionSpec(action, actions)?.change?.fields;
  if (fields === undefined) {
    throw new TypeError(`${action} declares no change fields in the catalog`);
  }
  // Own properties only, on both sides: what is compared is what is sent.
  const own = (state: RecordState, name: string): unknown =>
    state != null && Object.hasOwn(state, name) ? state[name] : undefined;
  const pick = (state: RecordState) => {
    if (state === null || state === undefined) return undefined;
    const picked: Record<string, JsonValue> = {};
    for (const [name, spec] of Object.entries(fields)) {
      const value = toJson(own(state, name));
      if (value === undefined) continue;
      picked[name] = spec.sensitive === true ? REDACTED : value;
    }
    return picked;
  };
  const previous = pick(before);
  const next = pick(after);
  const changedFields = Object.keys(fields).filter((name) => {
    const a = toJson(own(before, name)) ?? null;
    const b = toJson(own(after, name)) ?? null;
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  return {
    ...(previous === undefined ? {} : { before: previous }),
    ...(next === undefined ? {} : { after: next }),
    ...(changedFields.length === 0 ? {} : { changedFields }),
  };
}

/** A database value as JSON: dates as ISO strings, big integers and decimals as text. */
export function toJson(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toJson(item) ?? null);
  if (typeof value === 'object') {
    // Prisma's Decimal and the like: a value with its own JSON form.
    if (!isPlainObject(value)) {
      return 'toJSON' in value && typeof value.toJSON === 'function'
        ? toJson((value.toJSON as () => unknown).call(value))
        : undefined;
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const json = toJson(item);
      if (json !== undefined) out[key] = json;
    }
    return out;
  }
  return undefined;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
