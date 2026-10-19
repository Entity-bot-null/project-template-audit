import { describe, expect, it } from 'vitest';
import {
  decimalText,
  type EventHashInput,
  eventHashDocument,
  locationDigestDocument,
  personalDigestDocument,
} from './event-hash.js';

const row: EventHashInput = {
  id: 'a',
  appId: 'b',
  eventId: 'c',
  sequenceEpoch: null,
  sourceSeq: '1',
  catalogVersionId: null,
  schemaVersion: 1,
  connectorName: 'audit-nestjs',
  connectorVersion: '0.1.0',
  occurredAt: '2026-10-14T12:00:00.000Z',
  recordedAt: '2026-10-14T12:00:01.000Z',
  category: 'security',
  action: 'auth.session.signed_in',
  outcome: 'success',
  severity: 'info',
  riskScore: 5,
  reason: null,
  actorType: 'user',
  actorId: 'u',
  actorRole: null,
  actorEmailHmac: null,
  actorEmailHmacShared: null,
  impersonatorId: null,
  sessionRef: null,
  resourceType: null,
  resourceId: null,
  parentResourceType: null,
  parentResourceId: null,
  changeBefore: { b: 1, a: 2 },
  changeAfter: null,
  changedFields: [],
  requestId: null,
  traceId: null,
  httpMethod: null,
  httpRoute: null,
  httpStatus: 200,
  durationMs: null,
  clientType: null,
  clientAppVersion: null,
  clientAppBuild: null,
  clientUpdateId: null,
  clientOs: null,
  clientOsVersion: null,
  clientDeviceModel: null,
  clientLocale: null,
  clientTimeZone: null,
  clientNetworkType: null,
  clientRoute: null,
  clientSdk: null,
  clientDeclared: [],
  ipScope: 'public',
  geoCountry: null,
  geoAsn: null,
  uaBrowser: null,
  uaOs: null,
  uaDeviceClass: null,
  details: null,
  truncatedFields: [],
  droppedFields: [],
  flags: [],
  personalDigest: null,
  locationDigest: null,
};

describe('hash documents', () => {
  it('cover every column, canonically, under a version', () => {
    const text = eventHashDocument(row);
    expect(text.startsWith('{"action":"auth.session.signed_in"')).toBe(true);
    expect(text).toContain('"changeBefore":{"a":2,"b":1}');
    expect(text).toContain('"v":"event-v1"');
    expect(eventHashDocument({ ...row, riskScore: 6 })).not.toBe(text);
  });

  it('describe satellite rows with fixed decimals', () => {
    expect(
      locationDigestDocument({
        eventPk: 'a',
        latitude: decimalText(19.4, 2),
        longitude: decimalText(-99.13, 2),
        accuracyM: 1000,
        capturedAt: '2026-10-14T12:00:00.000Z',
      }),
    ).toContain('"latitude":"19.40"');
    const personal = personalDigestDocument({
      eventPk: 'a',
      ip: '203.0.113.7',
      userAgent: null,
      deviceId: null,
      actorLabel: 'j***',
      resourceLabel: null,
      geoSubdivision: null,
      geoCity: null,
      geoLatitude: null,
      geoLongitude: null,
      geoAccuracyKm: null,
      personalChange: null,
    });
    expect(personal).toContain('"v":"personal-v1"');
    // The columns added later are in the document only when the row has them:
    // a row without them hashes exactly as before they existed.
    const base = {
      eventPk: 'a',
      ip: '203.0.113.7',
      userAgent: null,
      deviceId: null,
      actorLabel: 'Ann Example',
      resourceLabel: null,
      geoSubdivision: null,
      geoCity: null,
      geoLatitude: null,
      geoLongitude: null,
      geoAccuracyKm: null,
      personalChange: null,
    };
    expect(personalDigestDocument({ ...base, actorPhone: null, clientHints: null })).toBe(
      personalDigestDocument(base),
    );
    const withPhone = personalDigestDocument({
      ...base,
      actorPhone: '•••• 5678',
      clientHints: { platform: 'Windows' },
    });
    expect(withPhone).toContain('"actorPhone":"•••• 5678"');
    expect(withPhone).toContain('"clientHints":{"platform":"Windows"}');
    expect(
      locationDigestDocument({
        eventPk: 'a',
        latitude: decimalText(19.432_61, 5),
        longitude: decimalText(-99.1, 5),
        accuracyM: 5,
        capturedAt: '2026-10-14T12:00:00.000Z',
      }),
    ).toContain('"latitude":"19.43261","longitude":"-99.10000"');
  });
});
