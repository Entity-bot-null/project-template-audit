import { createHash, randomBytes } from 'node:crypto';
import {
  type ActionSpec,
  type AuditEvent,
  decimalText,
  type EventHashInput,
  eventHashDocument,
  type FieldSpec,
  fieldValidator,
  type Fields,
  type HubCategory,
  type JsonValue,
  locationDecimals,
  locationDigestDocument,
  MIN_RETENTION_DAYS,
  PERSONAL_PLACEHOLDER,
  personalDigestDocument,
  REDACTED,
  type RejectionReason,
  sanitizeText,
  uuidv7,
} from 'audit-contract';
import { nodeRandomFill } from 'audit-contract/node';
import { canonicalIp, type IpScope, ipScope } from '../enrichment/ip.js';
import { riskScore } from './risk.js';

// From a normalized event and its catalog action to the rows Audit Hub
// stores: the event, its satellite rows (personal data, device location) and
// the hashes that bind them (docs/adr/0007, docs/adr/0008). Pure: no
// database, so every rule here is unit-tested.

const DAY_MS = 86_400_000;

export interface Envelope {
  appId: string;
  sequenceEpoch: string;
  connectorName: string;
  connectorVersion: string;
  catalogVersionId: string;
}

export interface Enrichment {
  geoCountry?: string;
  geoAsn?: number;
  geoSubdivision?: string;
  geoCity?: string;
  geoLatitude?: number;
  geoLongitude?: number;
  geoAccuracyKm?: number;
  uaBrowser?: string;
  uaOs?: string;
  uaDeviceClass?: string;
  /** Risk points from enrichment (hosting IP, …). */
  riskSignals?: number[];
}

export interface EventRow {
  id: string;
  appId: string;
  eventId: string;
  /** Null for Audit Hub's own events (no connector, no catalog). */
  sequenceEpoch: string | null;
  sourceSeq: bigint | null;
  catalogVersionId: string | null;
  schemaVersion: number;
  connectorName: string;
  connectorVersion: string;
  occurredAt: Date;
  recordedAt: Date;
  /** audit_access only for Audit Hub's own events (hub-audit/). */
  category: HubCategory;
  action: string;
  outcome: AuditEvent['outcome'];
  severity: NonNullable<AuditEvent['severity']>;
  riskScore: number;
  reason: string | null;
  actorType: AuditEvent['actor']['type'];
  actorId: string | null;
  actorRole: string | null;
  actorEmailHmac: string | null;
  actorEmailHmacShared: string | null;
  impersonatorId: string | null;
  sessionRef: string | null;
  resourceType: string | null;
  resourceId: string | null;
  parentResourceType: string | null;
  parentResourceId: string | null;
  changeBefore: JsonValue | null;
  changeAfter: JsonValue | null;
  changedFields: string[];
  requestId: string | null;
  traceId: string | null;
  httpMethod: string | null;
  httpRoute: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  clientType: NonNullable<AuditEvent['client']>['type'] | null;
  clientAppVersion: string | null;
  clientAppBuild: string | null;
  clientUpdateId: string | null;
  clientOs: string | null;
  clientOsVersion: string | null;
  clientDeviceModel: string | null;
  clientLocale: string | null;
  clientTimeZone: string | null;
  clientNetworkType: string | null;
  clientRoute: string | null;
  clientSdk: string | null;
  clientDeclared: string[];
  ipScope: IpScope | null;
  geoCountry: string | null;
  geoAsn: number | null;
  uaBrowser: string | null;
  uaOs: string | null;
  uaDeviceClass: string | null;
  details: JsonValue | null;
  truncatedFields: string[];
  droppedFields: string[];
  flags: string[];
  personalDigest: Uint8Array<ArrayBuffer> | null;
  locationDigest: Uint8Array<ArrayBuffer> | null;
  contentHash: Uint8Array<ArrayBuffer>;
}

export interface PersonalRow {
  eventPk: string;
  appId: string;
  recordedAt: Date;
  salt: Uint8Array<ArrayBuffer>;
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  actorLabel: string | null;
  resourceLabel: string | null;
  geoSubdivision: string | null;
  geoCity: string | null;
  geoLatitude: string | null;
  geoLongitude: string | null;
  geoAccuracyKm: number | null;
  personalChange: JsonValue | null;
  /** Masked at the origin (•••• 1234). */
  actorPhone: string | null;
  clientHints: JsonValue | null;
}

export interface LocationRow {
  eventPk: string;
  appId: string;
  recordedAt: Date;
  salt: Uint8Array<ArrayBuffer>;
  latitude: string;
  longitude: string;
  /** Two for an approximate position, five for a precise one (locationDecimals). */
  coordinateDecimals: number;
  accuracyM: number;
  capturedAt: Date;
}

export type BuiltRows =
  | {
      status: 'ok';
      event: EventRow;
      personal: PersonalRow | null;
      location: LocationRow | null;
      truncatedFields: string[];
      droppedFields: string[];
    }
  | { status: 'rejected'; reason: RejectionReason; paths: string[] };

export interface BuildInput {
  event: AuditEvent;
  spec: ActionSpec;
  envelope: Envelope;
  recordedAt: Date;
  truncatedFields: string[];
  droppedFields: string[];
  flags: string[];
  enrichment?: Enrichment;
}

type JsonRecord = Record<string, JsonValue>;

interface FieldContext {
  truncated: string[];
  dropped: string[];
  flags: Set<string>;
}

interface AppliedFields {
  kept: JsonRecord | undefined;
  personal: JsonRecord;
  missingRequired: string[];
  invalidRequired: string[];
}

/** One field cut to its maxLength, then validated; sensitive ones must be redacted. */
function applyField(
  name: string,
  value: unknown,
  spec: FieldSpec,
  path: string,
  context: FieldContext,
): { ok: true; value: JsonValue } | { ok: false } {
  if (spec.sensitive === true) {
    if (value !== REDACTED) context.flags.add('sensitive_unmasked');
    return { ok: true, value: REDACTED };
  }
  let candidate = value;
  if (typeof candidate === 'string' && (spec.type === 'string' || spec.type === 'id')) {
    const text = sanitizeText(candidate, spec.type === 'string' ? (spec.maxLength ?? 256) : 128);
    if (text.truncated) context.truncated.push(`${path}.${name}`);
    candidate = text.value;
  }
  const parsed = fieldValidator(spec).safeParse(candidate);
  return parsed.success ? { ok: true, value: parsed.data as JsonValue } : { ok: false };
}

/** An object checked against the catalog's field specs, its personal values set apart. */
function applyFields(
  value: JsonRecord | undefined,
  fields: Fields | undefined,
  path: string,
  context: FieldContext,
): AppliedFields {
  const result: AppliedFields = {
    kept: undefined,
    personal: {},
    missingRequired: [],
    invalidRequired: [],
  };
  if (fields === undefined) {
    if (value !== undefined) context.dropped.push(path);
    return result;
  }
  const kept: JsonRecord = {};
  for (const [name, item] of Object.entries(value ?? {})) {
    const spec = fields[name];
    if (spec === undefined) {
      context.dropped.push(`${path}.${name}`);
      continue;
    }
    const applied = applyField(name, item, spec, path, context);
    if (!applied.ok) {
      if (spec.required === true) result.invalidRequired.push(`${path}.${name}`);
      else context.dropped.push(`${path}.${name}`);
      continue;
    }
    if (spec.personal === true) {
      result.personal[name] = applied.value;
      kept[name] = { ...PERSONAL_PLACEHOLDER };
    } else {
      kept[name] = applied.value;
    }
  }
  if (value !== undefined) {
    for (const [name, spec] of Object.entries(fields)) {
      if (
        spec.required === true &&
        !(name in kept) &&
        !result.invalidRequired.includes(`${path}.${name}`)
      ) {
        result.missingRequired.push(`${path}.${name}`);
      }
    }
  }
  result.kept = value === undefined ? undefined : kept;
  return result;
}

/** SHA-256 in its own ArrayBuffer: what Prisma's Bytes fields take. */
const sha256 = (...parts: (Uint8Array | string)[]): Uint8Array<ArrayBuffer> => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};

const hex = (value: Uint8Array | null) =>
  value === null ? null : Buffer.from(value).toString('hex');
const salt = () => new Uint8Array(randomBytes(16));

/** The document an event's content hash covers, from the row Audit Hub writes (and reads back). */
export function hashInputOf(row: EventRow): EventHashInput {
  return {
    id: row.id,
    appId: row.appId,
    eventId: row.eventId,
    sequenceEpoch: row.sequenceEpoch,
    sourceSeq: row.sourceSeq === null ? null : row.sourceSeq.toString(),
    catalogVersionId: row.catalogVersionId,
    schemaVersion: row.schemaVersion,
    connectorName: row.connectorName,
    connectorVersion: row.connectorVersion,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    category: row.category,
    action: row.action,
    outcome: row.outcome,
    severity: row.severity,
    riskScore: row.riskScore,
    reason: row.reason,
    actorType: row.actorType,
    actorId: row.actorId,
    actorRole: row.actorRole,
    actorEmailHmac: row.actorEmailHmac,
    actorEmailHmacShared: row.actorEmailHmacShared,
    impersonatorId: row.impersonatorId,
    sessionRef: row.sessionRef,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    parentResourceType: row.parentResourceType,
    parentResourceId: row.parentResourceId,
    changeBefore: row.changeBefore,
    changeAfter: row.changeAfter,
    changedFields: row.changedFields,
    requestId: row.requestId,
    traceId: row.traceId,
    httpMethod: row.httpMethod,
    httpRoute: row.httpRoute,
    httpStatus: row.httpStatus,
    durationMs: row.durationMs,
    clientType: row.clientType,
    clientAppVersion: row.clientAppVersion,
    clientAppBuild: row.clientAppBuild,
    clientUpdateId: row.clientUpdateId,
    clientOs: row.clientOs,
    clientOsVersion: row.clientOsVersion,
    clientDeviceModel: row.clientDeviceModel,
    clientLocale: row.clientLocale,
    clientTimeZone: row.clientTimeZone,
    clientNetworkType: row.clientNetworkType,
    clientRoute: row.clientRoute,
    clientSdk: row.clientSdk,
    clientDeclared: row.clientDeclared,
    ipScope: row.ipScope,
    geoCountry: row.geoCountry,
    geoAsn: row.geoAsn,
    uaBrowser: row.uaBrowser,
    uaOs: row.uaOs,
    uaDeviceClass: row.uaDeviceClass,
    details: row.details,
    truncatedFields: row.truncatedFields,
    droppedFields: row.droppedFields,
    flags: row.flags,
    personalDigest: hex(row.personalDigest),
    locationDigest: hex(row.locationDigest),
  };
}

export function contentHashOf(row: EventRow): Uint8Array<ArrayBuffer> {
  return sha256(eventHashDocument(hashInputOf(row)));
}

export function personalDigestOf(row: PersonalRow): Uint8Array<ArrayBuffer> {
  return sha256(
    row.salt,
    personalDigestDocument({
      eventPk: row.eventPk,
      ip: row.ip,
      userAgent: row.userAgent,
      deviceId: row.deviceId,
      actorLabel: row.actorLabel,
      resourceLabel: row.resourceLabel,
      geoSubdivision: row.geoSubdivision,
      geoCity: row.geoCity,
      geoLatitude: row.geoLatitude,
      geoLongitude: row.geoLongitude,
      geoAccuracyKm: row.geoAccuracyKm,
      personalChange: row.personalChange,
      actorPhone: row.actorPhone,
      clientHints: row.clientHints,
    }),
  );
}

export function locationDigestOf(row: LocationRow): Uint8Array<ArrayBuffer> {
  return sha256(
    row.salt,
    locationDigestDocument({
      eventPk: row.eventPk,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyM: row.accuracyM,
      capturedAt: row.capturedAt.toISOString(),
    }),
  );
}

export function buildRows(input: BuildInput): BuiltRows {
  const { event, spec, envelope, recordedAt } = input;
  const context: FieldContext = {
    truncated: [...input.truncatedFields],
    dropped: [...input.droppedFields],
    flags: new Set(input.flags),
  };

  if (spec.category !== event.category) {
    return { status: 'rejected', reason: 'category_mismatch', paths: ['category'] };
  }
  if (spec.outcomes !== undefined && !spec.outcomes.includes(event.outcome)) {
    return { status: 'rejected', reason: 'outcome_not_allowed', paths: ['outcome'] };
  }
  // A device-declared event (relayed by the application's backend) for an
  // action only the server may record: refused, a device cannot sign anyone in.
  if (spec.source === 'server' && (event.clientDeclared ?? []).includes('client')) {
    return { status: 'rejected', reason: 'source_not_allowed', paths: ['action'] };
  }
  const occurredAt = new Date(event.occurredAt);
  if (occurredAt.getTime() < recordedAt.getTime() - MIN_RETENTION_DAYS[event.category] * DAY_MS) {
    return { status: 'rejected', reason: 'occurred_at_too_old', paths: ['occurredAt'] };
  }

  const details = applyFields(event.details, spec.details?.fields, 'details', context);
  if (details.invalidRequired.length + details.missingRequired.length > 0) {
    return {
      status: 'rejected',
      reason: 'details_invalid',
      paths: [...details.invalidRequired, ...details.missingRequired],
    };
  }
  const before = applyChangeFields(event.change?.before, spec, 'change.before', context);
  const after = applyChangeFields(event.change?.after, spec, 'change.after', context);

  const id = uuidv7(nodeRandomFill, recordedAt.getTime());
  const personalChange: JsonRecord = {};
  if (Object.keys(details.personal).length > 0) personalChange.details = details.personal;
  if (Object.keys(before.personal).length > 0) personalChange.before = before.personal;
  if (Object.keys(after.personal).length > 0) personalChange.after = after.personal;

  const ip = event.network?.ip === undefined ? undefined : canonicalIp(event.network.ip);
  const scope = ip === undefined ? null : ipScope(ip);
  const enrichment = input.enrichment ?? {};

  let personal: PersonalRow | null = null;
  const hasPersonal =
    event.actor.label !== undefined ||
    event.resource?.label !== undefined ||
    ip !== undefined ||
    event.network?.userAgent !== undefined ||
    event.client?.deviceId !== undefined ||
    event.actor.phoneLabel !== undefined ||
    event.network?.clientHints !== undefined ||
    enrichment.geoCity !== undefined ||
    Object.keys(personalChange).length > 0;
  if (hasPersonal) {
    personal = {
      eventPk: id,
      appId: envelope.appId,
      recordedAt,
      salt: salt(),
      ip: ip ?? null,
      userAgent: event.network?.userAgent ?? null,
      deviceId: event.client?.deviceId ?? null,
      actorLabel: event.actor.label ?? null,
      resourceLabel: event.resource?.label ?? null,
      geoSubdivision: enrichment.geoSubdivision ?? null,
      geoCity: enrichment.geoCity ?? null,
      geoLatitude:
        enrichment.geoLatitude === undefined ? null : decimalText(enrichment.geoLatitude, 3),
      geoLongitude:
        enrichment.geoLongitude === undefined ? null : decimalText(enrichment.geoLongitude, 3),
      geoAccuracyKm: enrichment.geoAccuracyKm ?? null,
      personalChange: Object.keys(personalChange).length > 0 ? personalChange : null,
      actorPhone: event.actor.phoneLabel ?? null,
      clientHints: (event.network?.clientHints as JsonValue | undefined) ?? null,
    };
  }

  let location: LocationRow | null = null;
  if (event.location !== undefined) {
    // Normalized already (normalize.ts): its decimals follow its accuracy.
    const decimals = locationDecimals(event.location.accuracyM);
    location = {
      eventPk: id,
      appId: envelope.appId,
      recordedAt,
      salt: salt(),
      latitude: decimalText(event.location.latitude, decimals),
      longitude: decimalText(event.location.longitude, decimals),
      coordinateDecimals: decimals,
      accuracyM: event.location.accuracyM,
      capturedAt: new Date(event.location.capturedAt),
    };
  }

  const severity = event.severity ?? spec.severity;
  const clientDeclared = event.clientDeclared ?? [];
  const row: EventRow = {
    id,
    appId: envelope.appId,
    eventId: event.eventId,
    sequenceEpoch: envelope.sequenceEpoch,
    sourceSeq: BigInt(event.sourceSeq),
    catalogVersionId: envelope.catalogVersionId,
    schemaVersion: event.schemaVersion,
    connectorName: envelope.connectorName,
    connectorVersion: envelope.connectorVersion,
    occurredAt,
    recordedAt,
    category: event.category,
    action: event.action,
    outcome: event.outcome,
    severity,
    riskScore: riskScore({
      severity,
      outcome: event.outcome,
      ipScope: scope,
      clientDeclared,
      ...(enrichment.riskSignals === undefined ? {} : { signals: enrichment.riskSignals }),
    }),
    reason: event.reason ?? null,
    actorType: event.actor.type,
    actorId: 'id' in event.actor && event.actor.id !== undefined ? event.actor.id : null,
    actorRole: event.actor.role ?? null,
    actorEmailHmac: event.actor.emailHmac ?? null,
    actorEmailHmacShared: event.actor.emailHmacShared ?? null,
    impersonatorId: event.actor.impersonatorId ?? null,
    sessionRef: event.actor.sessionRef ?? null,
    resourceType: event.resource?.type ?? null,
    resourceId: event.resource?.id ?? null,
    parentResourceType: event.resource?.parent?.type ?? null,
    parentResourceId: event.resource?.parent?.id ?? null,
    changeBefore: before.kept ?? null,
    changeAfter: after.kept ?? null,
    changedFields: event.change?.changedFields ?? [],
    requestId: event.request?.requestId ?? null,
    traceId: event.request?.traceId ?? null,
    httpMethod: event.request?.method ?? null,
    httpRoute: event.request?.route ?? null,
    httpStatus: event.request?.status ?? null,
    durationMs: event.request?.durationMs ?? null,
    clientType: event.client?.type ?? null,
    clientAppVersion: event.client?.appVersion ?? null,
    clientAppBuild: event.client?.appBuild ?? null,
    clientUpdateId: event.client?.updateId ?? null,
    clientOs: event.client?.os ?? null,
    clientOsVersion: event.client?.osVersion ?? null,
    clientDeviceModel: event.client?.deviceModel ?? null,
    clientLocale: event.client?.locale ?? null,
    clientTimeZone: event.client?.timeZone ?? null,
    clientNetworkType: event.client?.networkType ?? null,
    clientRoute: event.client?.route ?? null,
    clientSdk:
      event.client?.sdk === undefined
        ? null
        : `${event.client.sdk.name}@${event.client.sdk.version}`,
    clientDeclared,
    ipScope: scope,
    geoCountry: enrichment.geoCountry ?? null,
    geoAsn: enrichment.geoAsn ?? null,
    uaBrowser: enrichment.uaBrowser ?? null,
    uaOs: enrichment.uaOs ?? null,
    uaDeviceClass: enrichment.uaDeviceClass ?? null,
    details: details.kept ?? null,
    truncatedFields: [...new Set(context.truncated)].sort(),
    droppedFields: [...new Set(context.dropped)].sort(),
    flags: [...context.flags].sort(),
    personalDigest: personal === null ? null : personalDigestOf(personal),
    locationDigest: location === null ? null : locationDigestOf(location),
    contentHash: new Uint8Array(0),
  };
  row.contentHash = contentHashOf(row);
  return {
    status: 'ok',
    event: row,
    personal,
    location,
    truncatedFields: row.truncatedFields,
    droppedFields: row.droppedFields,
  };
}

/** before or after against the action's change fields. */
function applyChangeFields(
  value: Record<string, unknown> | undefined,
  spec: ActionSpec,
  path: string,
  context: FieldContext,
): AppliedFields {
  const applied = applyFields(value as JsonRecord | undefined, spec.change?.fields, path, context);
  // A required change field is a documentation hint, never a reason to refuse the event.
  for (const missing of [...applied.missingRequired, ...applied.invalidRequired])
    context.dropped.push(missing);
  return applied;
}
