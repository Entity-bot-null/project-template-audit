import { z } from 'zod';
import { canonicalJsonBytes, jsonDepth } from './canonical-json.js';
import {
  ACTOR_TYPES,
  AuditEventSchema,
  type AuditEvent,
  CATEGORIES,
  ChangeSchema,
  ClientHintsSchema,
  CLIENT_DECLARED_SECTIONS,
  ClientSchema,
  HUB_CATEGORIES,
  IdSchema,
  LocationSchema,
  NetworkSchema,
  OUTCOMES,
  RequestSchema,
  ResourceSchema,
  SEVERITIES,
  TimestampSchema,
  Uuidv7Schema,
  ActionSchema,
} from './event.js';
import type { RejectionReason } from './ingest.js';
import { locationAccuracy, locationDecimals, roundCoordinate } from './masking.js';
import {
  CATALOG_VERSION_PATTERN,
  CODE_PATTERN,
  HEX64_PATTERN,
  PHONE_LABEL_PATTERN,
  ROLE_PATTERN,
} from './patterns.js';
import { sanitizeText } from './text.js';
import { isUuidv7 } from './uuidv7.js';
import { LIMITS, SUPPORTED_CONTRACT_VERSIONS } from './version.js';

// How Audit Hub reads an incoming event (brief, failure 2 of the old module:
// events lost in silence when a field did not validate). Strict where the
// event's identity is at stake, lenient everywhere else:
//   - identity (schemaVersion, eventId, sourceSeq, occurredAt, catalogVersion,
//     category, action, outcome, actor.type, a user's actor.id): invalid
//     rejects the event, with a reason;
//   - any other field: invalid is dropped and its path listed;
//   - free text over its limit: cut and its path listed.
// Every string is normalized (text.ts) on the way. The catalog-dependent
// checks (action known, details spec, sensitive and personal paths) are
// Audit Hub's, after this.

/** Longest string kept inside details, before and after; the catalog may set less. */
export const MAX_FREE_TEXT = 1024;
/** How far in the future occurredAt may be (clock skew) before it is replaced. */
export const MAX_FUTURE_MS = 5 * 60 * 1000;

export type Normalized =
  | {
      status: 'ok';
      event: AuditEvent;
      truncatedFields: string[];
      droppedFields: string[];
      /** occurred_at_adjusted when occurredAt was in the future. */
      flags: string[];
    }
  | {
      status: 'rejected';
      reason: RejectionReason;
      paths: string[];
      eventId?: string;
      sourceSeq?: number;
    };

interface Context {
  truncated: string[];
  dropped: string[];
}

const IdentitySchema = z.object({
  schemaVersion: z.int(),
  eventId: Uuidv7Schema,
  sourceSeq: z.int().min(1),
  occurredAt: TimestampSchema,
  catalogVersion: z.string().regex(CATALOG_VERSION_PATTERN),
  category: z.enum(HUB_CATEGORIES),
  action: ActionSchema,
  outcome: z.enum(OUTCOMES),
  actor: z.object({ type: z.enum(ACTOR_TYPES) }),
});

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeAuditEvent(raw: unknown, now: number = Date.now()): Normalized {
  if (!isRecord(raw)) return { status: 'rejected', reason: 'schema_invalid', paths: ['$'] };
  const ids = {
    ...(isUuidv7(raw.eventId) ? { eventId: raw.eventId } : {}),
    ...(typeof raw.sourceSeq === 'number' &&
    Number.isSafeInteger(raw.sourceSeq) &&
    raw.sourceSeq >= 1
      ? { sourceSeq: raw.sourceSeq }
      : {}),
  };
  const reject = (reason: RejectionReason, paths: string[]): Normalized => ({
    status: 'rejected',
    reason,
    paths,
    ...ids,
  });

  let size: number;
  try {
    size = canonicalJsonBytes(raw);
  } catch {
    // A number JSON could not keep (1e400 parses to Infinity), a lone surrogate.
    return reject('schema_invalid', ['$']);
  }
  if (size > LIMITS.eventBytes) return reject('too_large', ['$']);

  const identity = IdentitySchema.safeParse(raw);
  if (!identity.success) {
    return reject(
      'schema_invalid',
      identity.error.issues.map((issue) => issue.path.join('.')),
    );
  }
  const head = identity.data;
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(head.schemaVersion)) {
    return reject('contract_version_unsupported', ['schemaVersion']);
  }
  if (!(CATEGORIES as readonly string[]).includes(head.category)) {
    return reject('category_reserved', ['category']);
  }

  const context: Context = { truncated: [], dropped: [] };
  const flags: string[] = [];
  let occurredAt = new Date(head.occurredAt).toISOString();
  if (Date.parse(occurredAt) > now + MAX_FUTURE_MS) {
    occurredAt = new Date(now).toISOString();
    flags.push('occurred_at_adjusted');
  }

  const actor = normalizeActor(raw.actor as JsonRecord, head.actor.type, context);
  if (actor === undefined) return reject('schema_invalid', ['actor.id']);

  const event: JsonRecord = {
    schemaVersion: head.schemaVersion,
    eventId: head.eventId,
    sourceSeq: head.sourceSeq,
    occurredAt,
    catalogVersion: head.catalogVersion,
    category: head.category,
    action: head.action,
    outcome: head.outcome,
    actor,
  };
  const optional = (key: string, value: unknown) => {
    if (value !== undefined) event[key] = value;
  };
  optional('severity', enumOrDrop(raw.severity, SEVERITIES, 'severity', context));
  optional('reason', patternOrDrop(raw.reason, CODE_PATTERN, 'reason', context));
  optional(
    'resource',
    normalizeObject(raw.resource, ResourceSchema, 'resource', { label: LIMITS.label }, context),
  );
  optional('change', normalizeChange(raw.change, context));
  optional('request', normalizeObject(raw.request, RequestSchema, 'request', {}, context));
  optional('network', normalizeNetwork(raw.network, context));
  optional(
    'client',
    normalizeObject(
      raw.client,
      ClientSchema,
      'client',
      { os: LIMITS.os, osVersion: LIMITS.osVersion, deviceModel: LIMITS.deviceModel },
      context,
    ),
  );
  optional('location', normalizeLocation(raw.location, context));
  optional('clientDeclared', normalizeClientDeclared(raw.clientDeclared, context));
  optional('details', normalizeJsonObject(raw.details, 'details', LIMITS.detailsBytes, context));

  for (const key of Object.keys(raw)) {
    if (!(key in event) && !KNOWN_KEYS.has(key)) context.dropped.push(key);
  }

  // Safety net: what was assembled from valid parts is valid as a whole.
  const parsed = AuditEventSchema.safeParse(event);
  if (!parsed.success) {
    return reject(
      'schema_invalid',
      parsed.error.issues.map((issue) => issue.path.join('.')),
    );
  }
  return {
    status: 'ok',
    event: parsed.data,
    truncatedFields: context.truncated,
    droppedFields: context.dropped,
    flags,
  };
}

const KNOWN_KEYS = new Set(Object.keys(AuditEventSchema.shape));

const ACTOR_TEXT_FIELDS: Record<string, z.ZodType> = {
  role: z.string().regex(ROLE_PATTERN),
  // Masked at the origin, or dropped: a phone in clear never gets in.
  phoneLabel: z.string().regex(PHONE_LABEL_PATTERN),
  emailHmac: z.string().regex(HEX64_PATTERN),
  emailHmacShared: z.string().regex(HEX64_PATTERN),
  impersonatorId: IdSchema,
  sessionRef: z.string().regex(HEX64_PATTERN),
};

function normalizeActor(
  raw: JsonRecord,
  type: (typeof ACTOR_TYPES)[number],
  context: Context,
): JsonRecord | undefined {
  const actor: JsonRecord = { type };
  const id = IdSchema.safeParse(raw.id);
  if (type === 'user' && !id.success) return undefined;
  if (raw.id !== undefined) {
    if (type !== 'anonymous' && id.success) actor.id = id.data;
    else context.dropped.push('actor.id');
  }
  if (raw.label !== undefined) {
    if (typeof raw.label === 'string') {
      const label = sanitizeText(raw.label, LIMITS.label);
      if (label.truncated) context.truncated.push('actor.label');
      if (label.value.length > 0) actor.label = label.value;
      else context.dropped.push('actor.label');
    } else {
      context.dropped.push('actor.label');
    }
  }
  for (const [key, schema] of Object.entries(ACTOR_TEXT_FIELDS)) {
    if (raw[key] === undefined) continue;
    const value = schema.safeParse(raw[key]);
    if (value.success) actor[key] = value.data;
    else context.dropped.push(`actor.${key}`);
  }
  for (const key of Object.keys(raw)) {
    if (!['type', 'id', 'label', ...Object.keys(ACTOR_TEXT_FIELDS)].includes(key)) {
      context.dropped.push(`actor.${key}`);
    }
  }
  return actor;
}

function enumOrDrop<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
  context: Context,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  context.dropped.push(path);
  return undefined;
}

function patternOrDrop(
  value: unknown,
  pattern: RegExp,
  path: string,
  context: Context,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && pattern.test(value)) return value;
  context.dropped.push(path);
  return undefined;
}

/**
 * A section validated field by field: unknown and invalid fields are
 * dropped, long free text cut. The section itself is dropped when what is
 * left is still invalid (a required field missing).
 */
function normalizeObject(
  value: unknown,
  schema: z.ZodObject,
  path: string,
  textLimits: Record<string, number>,
  context: Context,
): JsonRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    context.dropped.push(path);
    return undefined;
  }
  // The schema's own fields only: a key such as "constructor" or "__proto__"
  // names something every object inherits, never a field. What is kept is
  // built from entries, never written under a name the input chose.
  const fields = schema.shape as Record<string, z.ZodType>;
  const kept: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`;
    const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (field === undefined) {
      context.dropped.push(fieldPath);
      continue;
    }
    let candidate = item;
    const limit = Object.hasOwn(textLimits, key) ? textLimits[key] : undefined;
    if (typeof candidate === 'string' && limit !== undefined) {
      const text = sanitizeText(candidate, limit);
      if (text.truncated) context.truncated.push(fieldPath);
      candidate = text.value;
    }
    const parsed = field.safeParse(candidate);
    if (parsed.success) kept.push([key, parsed.data]);
    else context.dropped.push(fieldPath);
  }
  const whole = schema.safeParse(Object.fromEntries(kept));
  if (!whole.success) {
    context.dropped.push(path);
    return undefined;
  }
  return whole.data;
}

/** The network section; its client hints field by field (a bad one is dropped alone). */
function normalizeNetwork(value: unknown, context: Context): JsonRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    context.dropped.push('network');
    return undefined;
  }
  const { clientHints, ...rest } = value;
  const network = normalizeObject(
    rest,
    NetworkSchema,
    'network',
    { userAgent: LIMITS.userAgent },
    context,
  );
  const hints = normalizeObject(
    clientHints,
    ClientHintsSchema,
    'network.clientHints',
    {
      platform: LIMITS.hintPlatform,
      platformVersion: LIMITS.hintVersion,
      model: LIMITS.deviceModel,
    },
    context,
  );
  if (hints === undefined || Object.keys(hints).length === 0) return network;
  return { ...(network ?? {}), clientHints: hints };
}

function normalizeLocation(value: unknown, context: Context): JsonRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    context.dropped.push('location');
    return undefined;
  }
  // Its precision follows its accuracy (locationDecimals): five decimals for
  // a precise position, two for any other, whatever the sender did.
  const accuracy = typeof value.accuracyM === 'number' ? value.accuracyM : undefined;
  const decimals = locationDecimals(accuracy);
  const candidate = {
    latitude:
      typeof value.latitude === 'number'
        ? roundCoordinate(value.latitude, decimals)
        : value.latitude,
    longitude:
      typeof value.longitude === 'number'
        ? roundCoordinate(value.longitude, decimals)
        : value.longitude,
    accuracyM: accuracy === undefined ? value.accuracyM : locationAccuracy(accuracy),
    capturedAt: value.capturedAt,
  };
  const parsed = LocationSchema.safeParse(candidate);
  if (!parsed.success) {
    context.dropped.push('location');
    return undefined;
  }
  return parsed.data;
}

function normalizeClientDeclared(value: unknown, context: Context): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    context.dropped.push('clientDeclared');
    return undefined;
  }
  const sections = new Set<string>();
  for (const item of value) {
    if (
      typeof item === 'string' &&
      (CLIENT_DECLARED_SECTIONS as readonly string[]).includes(item)
    ) {
      sections.add(item);
    } else {
      context.dropped.push('clientDeclared');
    }
  }
  return sections.size > 0 ? [...sections] : undefined;
}

function normalizeChange(value: unknown, context: Context): JsonRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    context.dropped.push('change');
    return undefined;
  }
  const change: JsonRecord = {};
  for (const side of ['before', 'after'] as const) {
    const normalized = normalizeJsonObject(
      value[side],
      `change.${side}`,
      LIMITS.changeBytes,
      context,
    );
    if (normalized !== undefined) change[side] = normalized;
  }
  if (value.changedFields !== undefined) {
    const fields = ChangeSchema.shape.changedFields.safeParse(value.changedFields);
    if (fields.success) change.changedFields = fields.data;
    else context.dropped.push('change.changedFields');
  }
  for (const key of Object.keys(value)) {
    if (!['before', 'after', 'changedFields'].includes(key)) context.dropped.push(`change.${key}`);
  }
  return Object.keys(change).length > 0 ? change : undefined;
}

/** A JSON object with its strings normalized and cut, within its size and depth limits. */
function normalizeJsonObject(
  value: unknown,
  path: string,
  maxBytes: number,
  context: Context,
): JsonRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || jsonDepth(value) > LIMITS.jsonDepth) {
    context.dropped.push(path);
    return undefined;
  }
  const cleaned = cleanJson(value, path, context) as JsonRecord;
  if (canonicalJsonBytes(cleaned) > maxBytes) {
    context.dropped.push(path);
    return undefined;
  }
  return cleaned;
}

function cleanJson(value: unknown, path: string, context: Context): unknown {
  if (typeof value === 'string') {
    const text = sanitizeText(value, MAX_FREE_TEXT);
    if (text.truncated) context.truncated.push(path);
    return text.value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cleanJson(item, `${path}[${String(index)}]`, context));
  }
  if (isRecord(value)) {
    const result: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) {
      const name = sanitizeText(key, 128).value;
      if (name.length === 0) {
        context.dropped.push(`${path}.?`);
        continue;
      }
      result[name] = cleanJson(item, `${path}.${name}`, context);
    }
    return result;
  }
  return value;
}
