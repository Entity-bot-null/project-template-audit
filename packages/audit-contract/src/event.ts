import { z } from 'zod';
import { canonicalJsonBytes, jsonDepth } from './canonical-json.js';
import {
  ACTION_PATTERN,
  CATALOG_VERSION_PATTERN,
  CLIENT_ROUTE_PATTERN,
  CODE_PATTERN,
  DEVICE_ID_PATTERN,
  HEX64_PATTERN,
  ID_PATTERN,
  LOCALE_PATTERN,
  PHONE_LABEL_PATTERN,
  REQUEST_ID_PATTERN,
  RESOURCE_TYPE_PATTERN,
  ROLE_PATTERN,
  ROUTE_PATTERN,
  SDK_NAME_PATTERN,
  SEMVER_PATTERN,
  TIME_ZONE_PATTERN,
  TRACE_ID_PATTERN,
  UUIDV7_PATTERN,
  VERSION_TOKEN_PATTERN,
} from './patterns.js';
import { CONTRACT_VERSION, LIMITS } from './version.js';

// The audit event, version 1 (docs/design/audit-hub/contract.md). These
// schemas are strict: they describe exactly what a connector sends, and the
// JSON Schema in schema/v1/ is generated from them. Audit Hub reads incoming
// events more leniently (normalize.ts), field by field.

/** What applications send. `audit_access` is Audit Hub's own (its use by people). */
export const CATEGORIES = ['security', 'audit', 'access', 'system'] as const;
export const HUB_CATEGORIES = [...CATEGORIES, 'audit_access'] as const;
export const OUTCOMES = ['success', 'failure', 'denied'] as const;
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export const ACTOR_TYPES = ['user', 'service', 'system', 'anonymous'] as const;
export const CLIENT_TYPES = ['web', 'ios', 'android', 'api', 'job'] as const;
export const NETWORK_TYPES = [
  'wifi',
  'cellular',
  'ethernet',
  'vpn',
  'none',
  'other',
  'unknown',
] as const;
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
/** Sections of an event the application's server did not observe itself. */
export const CLIENT_DECLARED_SECTIONS = [
  'occurredAt',
  'client',
  'location',
  'details',
  'resource',
  'change',
] as const;

export type Category = (typeof CATEGORIES)[number];
export type HubCategory = (typeof HUB_CATEGORIES)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type ClientType = (typeof CLIENT_TYPES)[number];
export type ClientDeclaredSection = (typeof CLIENT_DECLARED_SECTIONS)[number];

export const Uuidv7Schema = z.string().regex(UUIDV7_PATTERN);
export const IdSchema = z.string().regex(ID_PATTERN);
export const Hex64Schema = z.string().regex(HEX64_PATTERN);
export const ActionSchema = z.string().regex(ACTION_PATTERN);
export const TimestampSchema = z.iso.datetime();
const label = z.string().min(1).max(LIMITS.label);

/** A JSON object bounded in size and depth: details, before, after. */
export const boundedObject = (maxBytes: number) =>
  z
    .record(z.string().max(128), z.json())
    .refine((value) => canonicalJsonBytes(value) <= maxBytes, {
      message: `at most ${String(maxBytes)} bytes`,
    })
    .refine((value) => jsonDepth(value) <= LIMITS.jsonDepth, {
      message: `at most ${String(LIMITS.jsonDepth)} levels deep`,
    });

const actorFields = {
  /** Role in the application at the time of the event. */
  role: z.string().regex(ROLE_PATTERN).optional(),
  /**
   * Who it is, in words: the person's name, or their email masked at the
   * origin (j***@e***.com) when the application has no name. Personal: Audit
   * Hub keeps it in the satellite table.
   */
  label: label.optional(),
  /** The person's phone, masked at the origin: its last four digits only (•••• 1234). Personal, like the label. */
  phoneLabel: z.string().regex(PHONE_LABEL_PATTERN).optional(),
  /** HMAC-SHA256 of the normalized email with the application's pseudonymization key. */
  emailHmac: Hex64Schema.optional(),
  /** Only when the application enabled cross-application correlation. */
  emailHmacShared: Hex64Schema.optional(),
  impersonatorId: IdSchema.optional(),
  /** HMAC of the session family id: never the id itself. */
  sessionRef: Hex64Schema.optional(),
};

export const ActorSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('user'), id: IdSchema, ...actorFields }),
  z.strictObject({ type: z.literal('service'), id: IdSchema.optional(), ...actorFields }),
  z.strictObject({ type: z.literal('system'), id: IdSchema.optional(), ...actorFields }),
  z.strictObject({ type: z.literal('anonymous'), ...actorFields }),
]);

const resourceType = z.string().regex(RESOURCE_TYPE_PATTERN);

export const ResourceSchema = z.strictObject({
  type: resourceType,
  id: IdSchema.optional(),
  label: label.optional(),
  parent: z.strictObject({ type: resourceType, id: IdSchema }).optional(),
});

export const ChangeSchema = z.strictObject({
  /** The explicit select, read in the transaction before the write. Sensitive values are "[REDACTED]". */
  before: boundedObject(LIMITS.changeBytes).optional(),
  after: boundedObject(LIMITS.changeBytes).optional(),
  changedFields: z
    .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,127}$/))
    .max(LIMITS.changedFields)
    .optional(),
});

export const RequestSchema = z.strictObject({
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  traceId: z.string().regex(TRACE_ID_PATTERN).optional(),
  method: z.enum(HTTP_METHODS).optional(),
  /** The route template (/api/users/:id), never the URL. */
  route: z.string().regex(ROUTE_PATTERN).optional(),
  /** The status actually sent. */
  status: z.int().min(100).max(599).optional(),
  durationMs: z.int().min(0).max(3_600_000).optional(),
});

/**
 * What a Chromium browser says of itself in its client hints (the Sec-CH-UA
 * headers; clientHintsFromHeaders), where its user agent no longer tells:
 * its real brand (Brave and Edge say Chrome), Windows 11 (which says 10), a
 * phone's model. Firefox and Safari send none.
 */
export const ClientHintsSchema = z.strictObject({
  /** Sec-CH-UA-Full-Version-List, else Sec-CH-UA, without the GREASE brand. */
  brands: z
    .array(
      z.strictObject({
        brand: z.string().min(1).max(LIMITS.hintBrand),
        version: z.string().min(1).max(LIMITS.hintVersion),
      }),
    )
    .min(1)
    .max(LIMITS.hintBrands)
    .optional(),
  /** Sec-CH-UA-Platform: Windows, macOS, Linux, Android, Chrome OS. */
  platform: z.string().min(1).max(LIMITS.hintPlatform).optional(),
  /** Sec-CH-UA-Platform-Version: 13.0.0 and up on Windows 11. */
  platformVersion: z.string().min(1).max(LIMITS.hintVersion).optional(),
  /** Sec-CH-UA-Model: a phone's or a tablet's model. */
  model: z.string().min(1).max(LIMITS.deviceModel).optional(),
  /** Sec-CH-UA-Mobile. */
  mobile: z.boolean().optional(),
});

export const NetworkSchema = z.strictObject({
  /** clientIp(req) of the application's API (TRUST_PROXY applied). */
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  userAgent: z.string().max(LIMITS.userAgent).optional(),
  clientHints: ClientHintsSchema.optional(),
});

const versionToken = z.string().regex(VERSION_TOKEN_PATTERN);

export const ClientSchema = z.strictObject({
  type: z.enum(CLIENT_TYPES),
  appVersion: versionToken.optional(),
  appBuild: versionToken.optional(),
  updateId: z.uuid().optional(),
  os: z.string().min(1).max(LIMITS.os).optional(),
  osVersion: z.string().min(1).max(LIMITS.osVersion).optional(),
  deviceModel: z.string().min(1).max(LIMITS.deviceModel).optional(),
  /** Per-installation random id: never an advertising id, IDFV or Android ID. */
  deviceId: z.string().regex(DEVICE_ID_PATTERN).optional(),
  locale: z.string().regex(LOCALE_PATTERN).optional(),
  timeZone: z.string().regex(TIME_ZONE_PATTERN).optional(),
  networkType: z.enum(NETWORK_TYPES).optional(),
  /** Screen route pattern, never a path with ids. */
  route: z.string().regex(CLIENT_ROUTE_PATTERN).optional(),
  sdk: z
    .strictObject({
      name: z.string().regex(SDK_NAME_PATTERN),
      version: z.string().regex(SEMVER_PATTERN),
    })
    .optional(),
});

/**
 * Only with the user's location consent. An approximate position (accuracy
 * of 1 km or more) is rounded to two decimals on the device; a precise one,
 * only with consent to the precise position, keeps five (about a metre). Audit
 * Hub rounds again by the same rule (locationDecimals).
 */
export const LocationSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.int().min(1).max(100_000),
  capturedAt: TimestampSchema,
});

const clientDeclared = z
  .array(z.enum(CLIENT_DECLARED_SECTIONS))
  .max(CLIENT_DECLARED_SECTIONS.length)
  .refine((sections) => new Set(sections).size === sections.length, {
    message: 'sections must be unique',
  });

const eventFields = {
  schemaVersion: z.literal(CONTRACT_VERSION),
  /** Idempotency key, generated once at the origin. */
  eventId: Uuidv7Schema,
  occurredAt: TimestampSchema,
  /** First 16 hex characters of the catalog's SHA-256 the event was written against. */
  catalogVersion: z.string().regex(CATALOG_VERSION_PATTERN),
  category: z.enum(CATEGORIES),
  /** domain.entity.verb, declared in the catalog. */
  action: ActionSchema,
  outcome: z.enum(OUTCOMES),
  /** Absent: the catalog's default. */
  severity: z.enum(SEVERITIES).optional(),
  /** A code for failure or denied: invalid_credentials, rate_limited, … */
  reason: z.string().regex(CODE_PATTERN).optional(),
  actor: ActorSchema,
  resource: ResourceSchema.optional(),
  change: ChangeSchema.optional(),
  request: RequestSchema.optional(),
  network: NetworkSchema.optional(),
  client: ClientSchema.optional(),
  location: LocationSchema.optional(),
  clientDeclared: clientDeclared.optional(),
  /** Validated against the action's details spec in the catalog. */
  details: boundedObject(LIMITS.detailsBytes).optional(),
};

/** An event as the connector's queue holds it, before it gets its sequence number. */
export const AuditEventDraftSchema = z.strictObject(eventFields);

/** An event as it travels to Audit Hub. */
export const AuditEventSchema = z.strictObject({
  ...eventFields,
  /** Gapless per sequence epoch, assigned by the connector's queue in commit order. */
  sourceSeq: z.int().min(1),
});

/** What a device sends to its own backend; the backend completes the rest. */
export const ClientEventSchema = z.strictObject({
  eventId: Uuidv7Schema,
  occurredAt: TimestampSchema,
  action: ActionSchema,
  outcome: z.enum(OUTCOMES),
  reason: z.string().regex(CODE_PATTERN).optional(),
  resource: ResourceSchema.optional(),
  client: ClientSchema,
  location: LocationSchema.optional(),
  details: boundedObject(LIMITS.detailsBytes).optional(),
});

export const ClientEventBatchSchema = z.strictObject({
  events: z.array(ClientEventSchema).min(1).max(LIMITS.clientBatchEvents),
  /**
   * Events this device dropped since its last batch: queued for a user who
   * signed out before they could be sent, so never sent as the next user.
   * The API adds them up and its heartbeat reports them.
   */
  discardedAtSignOut: z.int().min(0).max(LIMITS.clientQueueEvents).optional(),
});

export const ClientEventResultSchema = z.strictObject({
  eventId: z.string(),
  status: z.enum(['accepted', 'duplicate', 'rejected']),
  reason: z.string().regex(CODE_PATTERN).optional(),
});

export const ClientEventBatchResultSchema = z.strictObject({
  results: z.array(ClientEventResultSchema),
});

export type Actor = z.infer<typeof ActorSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type RequestInfo = z.infer<typeof RequestSchema>;
export type NetworkInfo = z.infer<typeof NetworkSchema>;
export type ClientHints = z.infer<typeof ClientHintsSchema>;
export type ClientInfo = z.infer<typeof ClientSchema>;
export type LocationInfo = z.infer<typeof LocationSchema>;
export type AuditEventDraft = z.infer<typeof AuditEventDraftSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type ClientEventBatch = z.infer<typeof ClientEventBatchSchema>;
export type ClientEventResult = z.infer<typeof ClientEventResultSchema>;
export type ClientEventBatchResult = z.infer<typeof ClientEventBatchResultSchema>;
