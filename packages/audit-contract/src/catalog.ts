import { z } from 'zod';
import { canonicalJson, canonicalJsonBytes } from './canonical-json.js';
import { CATEGORIES, type Category, OUTCOMES, SEVERITIES } from './event.js';
import {
  ACTION_PATTERN,
  COUNTRY_PATTERN,
  ENUM_VALUE_PATTERN,
  FIELD_NAME_PATTERN,
  ID_PATTERN,
  RESOURCE_TYPE_PATTERN,
  UUIDV7_PATTERN,
  VERSION_TOKEN_PATTERN,
} from './patterns.js';
import { LIMITS } from './version.js';

// The catalog an application publishes: every action it records, with its
// category, default severity and the shape of its details (ADR 0005). Field
// specs are flat and closed (no regex, no $ref, no nesting): Audit Hub
// compiles them to validators, and a compromised publisher cannot hand it a
// pattern that blocks ingestion.

/** The semantic tags rules understand, whatever an application names its actions. */
export const TAGS = [
  'auth.sign_in',
  'auth.sign_in_failed',
  'auth.sign_out',
  'auth.session_reuse',
  'auth.credential_changed',
  'auth.recovery',
  'iam.privilege_changed',
  'iam.account_created',
  'iam.account_disabled',
  'data.bulk_export',
  'data.bulk_delete',
  'data.read_other_user',
  'http.rejected',
  'security.prompt_answered',
  'response.executed',
  'privacy.erasure_requested',
] as const;
export type Tag = (typeof TAGS)[number];

/** What Audit Hub may ask an application to do to one of its users (ADR 0013). */
export const RESPONSE_ACTIONS = [
  'revoke_sessions',
  'require_password_change',
  'disable_account',
] as const;
export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];

export const ACTION_SOURCES = ['server', 'client', 'both'] as const;

/**
 * Minimum retention in days per category: enforced by the database
 * (audit_retention_min_days) and by catalog publication (an action never
 * moves to a category kept for less time).
 */
export const MIN_RETENTION_DAYS: Readonly<Record<Category | 'audit_access', number>> = {
  security: 730,
  audit: 365,
  access: 180,
  system: 30,
  audit_access: 730,
};

const flags = {
  required: z.boolean().optional(),
  /** Moved to the satellite table, with its shorter retention. */
  personal: z.boolean().optional(),
  /** Must arrive as "[REDACTED]": never leaves the application in clear. */
  sensitive: z.boolean().optional(),
};

export const FieldSpecSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('string'),
    maxLength: z.int().min(1).max(1024).optional(),
    ...flags,
  }),
  z.strictObject({
    type: z.literal('integer'),
    min: z.int().optional(),
    max: z.int().optional(),
    ...flags,
  }),
  z.strictObject({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    ...flags,
  }),
  z.strictObject({ type: z.literal('boolean'), ...flags }),
  z.strictObject({
    type: z.literal('enum'),
    values: z.array(z.string().regex(ENUM_VALUE_PATTERN)).min(1).max(64),
    ...flags,
  }),
  z.strictObject({ type: z.literal('uuid'), ...flags }),
  z.strictObject({ type: z.literal('datetime'), ...flags }),
  z.strictObject({ type: z.literal('id'), ...flags }),
  z.strictObject({ type: z.literal('ip'), ...flags }),
  z.strictObject({ type: z.literal('country'), ...flags }),
  z.strictObject({
    type: z.literal('string[]'),
    maxItems: z.int().min(1).max(32).optional(),
    maxLength: z.int().min(1).max(1024).optional(),
    ...flags,
  }),
]);
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

export const FieldsSchema = z
  .record(z.string().regex(FIELD_NAME_PATTERN), FieldSpecSchema)
  .refine((fields) => Object.keys(fields).length <= LIMITS.catalogFields, {
    message: `at most ${String(LIMITS.catalogFields)} fields`,
  });
export type Fields = z.infer<typeof FieldsSchema>;

export const ActionSpecSchema = z.strictObject({
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  description: z.string().min(1).max(LIMITS.description),
  /** Who may emit it: devices only through their backend, and only client or both. */
  source: z.enum(ACTION_SOURCES),
  /** Outcomes the action can have; absent means any. */
  outcomes: z.array(z.enum(OUTCOMES)).min(1).max(3).optional(),
  tags: z.array(z.enum(TAGS)).max(8).optional(),
  resourceType: z.string().regex(RESOURCE_TYPE_PATTERN).optional(),
  /** Shown to the user in "My account's security". */
  userVisible: z.boolean().optional(),
  details: z.strictObject({ fields: FieldsSchema }).optional(),
  change: z.strictObject({ fields: FieldsSchema }).optional(),
});
export type ActionSpec = z.infer<typeof ActionSpecSchema>;

export const CatalogDocumentSchema = z
  .strictObject({
    catalogFormat: z.literal(1),
    app: z.strictObject({
      name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
      version: z.string().regex(VERSION_TOKEN_PATTERN),
    }),
    responseActions: z.array(z.enum(RESPONSE_ACTIONS)).max(RESPONSE_ACTIONS.length).optional(),
    actions: z.record(z.string().regex(ACTION_PATTERN), ActionSpecSchema),
  })
  .refine((catalog) => Object.keys(catalog.actions).length <= LIMITS.catalogActions, {
    message: `at most ${String(LIMITS.catalogActions)} actions`,
    path: ['actions'],
  })
  .refine((catalog) => canonicalJsonBytes(catalog) <= LIMITS.catalogBytes, {
    message: `at most ${String(LIMITS.catalogBytes)} bytes`,
  });
export type CatalogDocument = z.infer<typeof CatalogDocumentSchema>;

/** SHA-256 of a string, as lowercase hex (node:crypto on the server). */
export type Sha256Hex = (text: string) => string;

/** The catalog's version: the first 16 hex characters of the SHA-256 of its canonical JSON. */
export function catalogVersionOf(catalog: CatalogDocument, sha256Hex: Sha256Hex): string {
  return sha256Hex(canonicalJson(catalog)).slice(0, 16);
}

/**
 * Changes between two published versions that would lower retention: an
 * action moved to a category kept for less time. Publishing is refused when
 * this is not empty.
 */
export function retentionDowngrades(
  previous: CatalogDocument,
  next: CatalogDocument,
): { action: string; from: Category; to: Category }[] {
  const downgrades: { action: string; from: Category; to: Category }[] = [];
  for (const [action, spec] of Object.entries(next.actions)) {
    const before = previous.actions[action];
    if (before === undefined) continue;
    if (MIN_RETENTION_DAYS[spec.category] < MIN_RETENTION_DAYS[before.category]) {
      downgrades.push({ action, from: before.category, to: spec.category });
    }
  }
  return downgrades;
}

/** The validator of one field spec (strings without the cut: the caller cuts first). */
export function fieldValidator(spec: FieldSpec): z.ZodType {
  switch (spec.type) {
    case 'string':
      return z.string().max(spec.maxLength ?? 256);
    case 'integer': {
      let schema = z.int();
      if (spec.min !== undefined) schema = schema.min(spec.min);
      if (spec.max !== undefined) schema = schema.max(spec.max);
      return schema;
    }
    case 'number': {
      let schema = z.number();
      if (spec.min !== undefined) schema = schema.min(spec.min);
      if (spec.max !== undefined) schema = schema.max(spec.max);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'enum':
      return z.enum(spec.values as [string, ...string[]]);
    case 'uuid':
      return z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    case 'datetime':
      return z.iso.datetime();
    case 'id':
      return z.string().regex(ID_PATTERN);
    case 'ip':
      return z.union([z.ipv4(), z.ipv6()]);
    case 'country':
      return z.string().regex(COUNTRY_PATTERN);
    case 'string[]':
      return z.array(z.string().max(spec.maxLength ?? 256)).max(spec.maxItems ?? 32);
  }
}

/**
 * A validator for an object described by field specs: every declared field
 * with its type, required ones required, nothing undeclared. A sensitive
 * field also accepts the redaction marker (and only that, when it is a string).
 */
export function compileFields(fields: Fields): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, spec] of Object.entries(fields)) {
    const validator = spec.sensitive === true ? z.literal('[REDACTED]') : fieldValidator(spec);
    shape[name] = spec.required === true ? validator : validator.optional();
  }
  return z.strictObject(shape);
}

/** Paths of an action's personal and sensitive fields: details.<name>, change.<name>. */
export function markedPaths(
  spec: ActionSpec,
  mark: 'personal' | 'sensitive',
): { details: string[]; change: string[] } {
  const pick = (fields: Fields | undefined) =>
    Object.entries(fields ?? {})
      .filter(([, field]) => field[mark] === true)
      .map(([name]) => name);
  return { details: pick(spec.details?.fields), change: pick(spec.change?.fields) };
}

/** True when the value is a UUIDv7 (for the detail fields that carry event ids). */
export const isEventId = (value: unknown): boolean =>
  typeof value === 'string' && UUIDV7_PATTERN.test(value);
