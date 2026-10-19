import { canonicalJson, type JsonValue } from './canonical-json.js';

// What an event's content hash covers (docs/adr/0008): every column Audit Hub
// stores for it, in one canonical document. The verifier rebuilds this
// document from the database columns, never from the original request, so a
// changed column, wherever it is, changes the hash. A field added to the
// event table needs a new version of this document.

export const EVENT_HASH_VERSION = 'event-v1';
export const PERSONAL_DIGEST_VERSION = 'personal-v1';
export const LOCATION_DIGEST_VERSION = 'location-v1';

type Nullable<T> = T | null;

/** An audit_events row as the hash sees it: dates as ISO strings, bigints as decimal strings, bytes as hex. */
export interface EventHashInput {
  id: string;
  appId: string;
  eventId: string;
  sequenceEpoch: Nullable<string>;
  sourceSeq: Nullable<string>;
  catalogVersionId: Nullable<string>;
  schemaVersion: number;
  connectorName: string;
  connectorVersion: string;
  occurredAt: string;
  recordedAt: string;
  category: string;
  action: string;
  outcome: string;
  severity: string;
  riskScore: number;
  reason: Nullable<string>;
  actorType: string;
  actorId: Nullable<string>;
  actorRole: Nullable<string>;
  actorEmailHmac: Nullable<string>;
  actorEmailHmacShared: Nullable<string>;
  impersonatorId: Nullable<string>;
  sessionRef: Nullable<string>;
  resourceType: Nullable<string>;
  resourceId: Nullable<string>;
  parentResourceType: Nullable<string>;
  parentResourceId: Nullable<string>;
  changeBefore: Nullable<JsonValue>;
  changeAfter: Nullable<JsonValue>;
  changedFields: string[];
  requestId: Nullable<string>;
  traceId: Nullable<string>;
  httpMethod: Nullable<string>;
  httpRoute: Nullable<string>;
  httpStatus: Nullable<number>;
  durationMs: Nullable<number>;
  clientType: Nullable<string>;
  clientAppVersion: Nullable<string>;
  clientAppBuild: Nullable<string>;
  clientUpdateId: Nullable<string>;
  clientOs: Nullable<string>;
  clientOsVersion: Nullable<string>;
  clientDeviceModel: Nullable<string>;
  clientLocale: Nullable<string>;
  clientTimeZone: Nullable<string>;
  clientNetworkType: Nullable<string>;
  clientRoute: Nullable<string>;
  clientSdk: Nullable<string>;
  clientDeclared: string[];
  ipScope: Nullable<string>;
  geoCountry: Nullable<string>;
  geoAsn: Nullable<number>;
  uaBrowser: Nullable<string>;
  uaOs: Nullable<string>;
  uaDeviceClass: Nullable<string>;
  details: Nullable<JsonValue>;
  truncatedFields: string[];
  droppedFields: string[];
  flags: string[];
  personalDigest: Nullable<string>;
  locationDigest: Nullable<string>;
}

/** The text an event's content hash is the SHA-256 of. */
export function eventHashDocument(input: EventHashInput): string {
  return canonicalJson({ v: EVENT_HASH_VERSION, ...input });
}

/** An event_personal row as its digest sees it (the salt is hashed in front of it). */
export interface PersonalDigestInput {
  eventPk: string;
  ip: Nullable<string>;
  userAgent: Nullable<string>;
  deviceId: Nullable<string>;
  actorLabel: Nullable<string>;
  resourceLabel: Nullable<string>;
  geoSubdivision: Nullable<string>;
  geoCity: Nullable<string>;
  geoLatitude: Nullable<string>;
  geoLongitude: Nullable<string>;
  geoAccuracyKm: Nullable<number>;
  personalChange: Nullable<JsonValue>;
  /**
   * Columns added after the first rows (the masked phone, the client hints):
   * in the document only when the row has them, so a row without them hashes
   * exactly as it did before they existed.
   */
  actorPhone?: Nullable<string>;
  clientHints?: Nullable<JsonValue>;
}

export function personalDigestDocument(input: PersonalDigestInput): string {
  const { actorPhone, clientHints, ...first } = input;
  return canonicalJson({
    v: PERSONAL_DIGEST_VERSION,
    ...first,
    ...(actorPhone === null || actorPhone === undefined ? {} : { actorPhone }),
    ...(clientHints === null || clientHints === undefined ? {} : { clientHints }),
  });
}

export interface LocationDigestInput {
  eventPk: string;
  latitude: string;
  longitude: string;
  accuracyM: number;
  capturedAt: string;
}

export function locationDigestDocument(input: LocationDigestInput): string {
  return canonicalJson({ v: LOCATION_DIGEST_VERSION, ...input });
}

/** Coordinates as the database's DECIMAL keeps them (fixed decimals), so both sides agree. */
export function decimalText(value: number, decimals: number): string {
  return value.toFixed(decimals);
}
