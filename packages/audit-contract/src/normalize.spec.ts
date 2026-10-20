import { describe, expect, it } from 'vitest';
import { MAX_FREE_TEXT, normalizeAuditEvent, type Normalized } from './normalize.js';
import { auditEvent, EVENT_ID } from './testing/fixtures.js';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

function ok(result: Normalized) {
  if (result.status !== 'ok')
    throw new Error(`rejected: ${result.reason} ${result.paths.join(',')}`);
  return result;
}

function rejected(result: Normalized) {
  if (result.status !== 'rejected') throw new Error('accepted');
  return result;
}

describe('normalizeAuditEvent', () => {
  it('keeps a valid event as it is', () => {
    const result = ok(normalizeAuditEvent(auditEvent(), NOW));
    expect(result.event).toEqual(auditEvent());
    expect(result).toMatchObject({ truncatedFields: [], droppedFields: [], flags: [] });
  });

  it('rejects an event whose identity is invalid, keeping what it can name', () => {
    expect(rejected(normalizeAuditEvent('nope', NOW))).toMatchObject({
      reason: 'schema_invalid',
      paths: ['$'],
    });
    const missingAction = { ...auditEvent(), action: 'bad' };
    expect(rejected(normalizeAuditEvent(missingAction, NOW))).toMatchObject({
      reason: 'schema_invalid',
      paths: ['action'],
      eventId: EVENT_ID,
      sourceSeq: 1,
    });
    const userWithoutId = { ...auditEvent(), actor: { type: 'user', id: 'a@b.c' } };
    expect(rejected(normalizeAuditEvent(userWithoutId, NOW))).toMatchObject({
      paths: ['actor.id'],
    });
  });

  it('names the reserved category, unsupported versions, oversized and unrepresentable events', () => {
    expect(
      rejected(normalizeAuditEvent({ ...auditEvent(), category: 'audit_access' }, NOW)).reason,
    ).toBe('category_reserved');
    expect(rejected(normalizeAuditEvent({ ...auditEvent(), schemaVersion: 99 }, NOW)).reason).toBe(
      'contract_version_unsupported',
    );
    const huge = { ...auditEvent(), details: { text: 'x'.repeat(20_000) } };
    expect(rejected(normalizeAuditEvent(huge, NOW)).reason).toBe('too_large');
    const infinite = { ...auditEvent(), details: { n: Infinity } };
    expect(rejected(normalizeAuditEvent(infinite, NOW)).reason).toBe('schema_invalid');
  });

  it('drops a bad optional field instead of rejecting the event', () => {
    const event = {
      ...auditEvent(),
      severity: 'urgent',
      reason: 'Bad Reason',
      request: { requestId: 'req-1', status: 999, extra: 1 },
      client: { type: 'web', appVersion: 'not valid!' },
      network: { ip: 'not-an-ip', userAgent: 'UA' },
      unknownTopLevel: true,
    };
    const result = ok(normalizeAuditEvent(event, NOW));
    expect(result.droppedFields.sort()).toEqual(
      [
        'client.appVersion',
        'network.ip',
        'reason',
        'request.extra',
        'request.status',
        'severity',
        'unknownTopLevel',
      ].sort(),
    );
    expect(result.event.request).toEqual({ requestId: 'req-1' });
    expect(result.event.network).toEqual({ userAgent: 'UA' });
    expect(result.event.severity).toBeUndefined();
  });

  it('drops a key every object inherits (constructor, __proto__…) as any unknown one', () => {
    // As JSON.parse builds them: "__proto__" an own key, not the prototype.
    const resource = JSON.parse(
      '{"type":"order","id":"o-1","constructor":"x","__proto__":{"admin":true},"toString":1,"hasOwnProperty":2}',
    ) as Record<string, unknown>;
    const client = JSON.parse('{"type":"web","valueOf":"x"}') as Record<string, unknown>;
    const result = ok(normalizeAuditEvent({ ...auditEvent(), resource, client }, NOW));
    expect(result.droppedFields.sort()).toEqual(
      [
        'client.valueOf',
        'resource.__proto__',
        'resource.constructor',
        'resource.hasOwnProperty',
        'resource.toString',
      ].sort(),
    );
    expect(result.event.resource).toEqual({ type: 'order', id: 'o-1' });
    expect(Object.getPrototypeOf(result.event.resource)).toBe(Object.prototype);
    expect(({} as { admin?: unknown }).admin).toBeUndefined();
  });

  it('cuts long free text and says where', () => {
    const event = {
      ...auditEvent(),
      actor: { ...auditEvent().actor, label: 'x'.repeat(200) },
      network: { userAgent: 'U'.repeat(600) },
      resource: { type: 'note', label: 'L'.repeat(300) },
      client: { type: 'ios', deviceModel: 'M'.repeat(100) },
      details: { note: 'n'.repeat(MAX_FREE_TEXT + 10) },
    };
    const result = ok(normalizeAuditEvent(event, NOW));
    expect(result.truncatedFields.sort()).toEqual(
      [
        'actor.label',
        'client.deviceModel',
        'details.note',
        'network.userAgent',
        'resource.label',
      ].sort(),
    );
    expect(result.event.actor.label).toHaveLength(128);
    expect(result.event.network?.userAgent).toHaveLength(512);
  });

  it('keeps XSS payloads as plain text', () => {
    const payloads = ['<script>alert(1)</script>', '${alert(1)}', '" onmouseover="alert(1)'];
    for (const payload of payloads) {
      const event = {
        ...auditEvent(),
        actor: { ...auditEvent().actor, label: payload },
        resource: { type: 'note', label: payload },
        details: { title: payload },
      };
      const result = ok(normalizeAuditEvent(event, NOW));
      expect(result.event.actor.label).toBe(payload);
      expect(result.event.resource?.label).toBe(payload);
      expect(result.event.details).toEqual({ title: payload });
    }
  });

  it('removes control characters and NUL everywhere', () => {
    const event = {
      ...auditEvent(),
      details: { ['k\u0000ey']: 'v\u0000al', list: ['a\u0007'], nested: { s: 'x\u001b' } },
    };
    const result = ok(normalizeAuditEvent(event, NOW));
    expect(result.event.details).toEqual({ key: 'val', list: ['a'], nested: { s: 'x' } });
  });

  it('moves a future occurredAt to now and flags it', () => {
    const future = auditEvent({ occurredAt: '2026-10-14T12:10:00.000Z' });
    const result = ok(normalizeAuditEvent(future, NOW));
    expect(result.event.occurredAt).toBe('2026-10-14T12:00:00.000Z');
    expect(result.flags).toEqual(['occurred_at_adjusted']);
    const microseconds = ok(
      normalizeAuditEvent(auditEvent({ occurredAt: '2026-10-14T11:00:00.123456Z' }), NOW),
    );
    expect(microseconds.event.occurredAt).toBe('2026-10-14T11:00:00.123Z');
  });

  it('rounds locations again by their accuracy: five decimals when precise, two otherwise', () => {
    const at = (latitude: number, longitude: number, accuracyM: number) => ({
      ...auditEvent(),
      location: { latitude, longitude, accuracyM, capturedAt: '2026-10-14T11:59:00Z' },
    });
    expect(ok(normalizeAuditEvent(at(19.4326081, -99.1332093, 4.6), NOW)).event.location).toEqual({
      latitude: 19.43261,
      longitude: -99.13321,
      accuracyM: 5,
      capturedAt: '2026-10-14T11:59:00Z',
    });
    // Approximate (1 km or worse): two decimals, whatever was sent.
    expect(ok(normalizeAuditEvent(at(19.432608, -99.133209, 3000), NOW)).event.location).toEqual({
      latitude: 19.43,
      longitude: -99.13,
      accuracyM: 3000,
      capturedAt: '2026-10-14T11:59:00Z',
    });
    expect(
      ok(normalizeAuditEvent(at(19.432608, -99.133209, 250_000), NOW)).event.location,
    ).toMatchObject({ latitude: 19.43, accuracyM: 100_000 });
    // A precise position is still never better than a metre.
    expect(
      ok(normalizeAuditEvent(at(19.4326081, -99.1332093, 0.2), NOW)).event.location,
    ).toMatchObject({ accuracyM: 1 });
    const bad = { ...auditEvent(), location: { latitude: 'x' } };
    expect(ok(normalizeAuditEvent(bad, NOW)).droppedFields).toEqual(['location']);
    expect(ok(normalizeAuditEvent({ ...auditEvent(), location: 'x' }, NOW)).droppedFields).toEqual([
      'location',
    ]);
  });

  it('keeps a masked phone, and never one in clear', () => {
    const withPhone = (phoneLabel: unknown) =>
      normalizeAuditEvent({ ...auditEvent(), actor: { ...auditEvent().actor, phoneLabel } }, NOW);
    expect(ok(withPhone('•••• 1234')).event.actor.phoneLabel).toBe('•••• 1234');
    for (const clear of ['+52 81 1234 5678', '81 1234 5678', '•••• 12345', 1234]) {
      const result = ok(withPhone(clear));
      expect(result.event.actor).not.toHaveProperty('phoneLabel');
      expect(result.droppedFields).toEqual(['actor.phoneLabel']);
    }
  });

  it('keeps client hints field by field: a bad one is dropped alone', () => {
    const withHints = (clientHints: unknown) =>
      normalizeAuditEvent({ ...auditEvent(), network: { ip: '203.0.113.7', clientHints } }, NOW);
    const hints = {
      brands: [{ brand: 'Microsoft Edge', version: '155.0.3405.80' }],
      platform: 'Windows',
      platformVersion: '15.0.0',
      model: '',
      mobile: false,
      extra: 'x',
    };
    const result = ok(withHints(hints));
    expect(result.event.network).toEqual({
      ip: '203.0.113.7',
      clientHints: {
        brands: [{ brand: 'Microsoft Edge', version: '155.0.3405.80' }],
        platform: 'Windows',
        platformVersion: '15.0.0',
        mobile: false,
      },
    });
    expect(result.droppedFields.sort()).toEqual(
      ['network.clientHints.extra', 'network.clientHints.model'].sort(),
    );
    // Long text is cut, not refused; nothing left: no hints at all.
    expect(
      ok(withHints({ platform: 'W'.repeat(100) })).event.network?.clientHints?.platform,
    ).toHaveLength(32);
    expect(ok(withHints({ mobile: 'yes' })).event.network).toEqual({ ip: '203.0.113.7' });
    expect(ok(withHints('Edge')).droppedFields).toEqual(['network.clientHints']);
  });

  it('cleans actors: ids an anonymous actor cannot have, invalid pseudonyms, unknown keys', () => {
    const event = {
      ...auditEvent(),
      actor: { type: 'anonymous', id: 'x', emailHmac: 'zz', label: 7, role: 'member', other: 1 },
    };
    const result = ok(normalizeAuditEvent(event, NOW));
    expect(result.event.actor).toEqual({ type: 'anonymous', role: 'member' });
    expect(result.droppedFields.sort()).toEqual(
      ['actor.emailHmac', 'actor.id', 'actor.label', 'actor.other'].sort(),
    );
    const blank = { ...auditEvent(), actor: { type: 'system', id: 'job-1', label: '\u0000' } };
    expect(ok(normalizeAuditEvent(blank, NOW)).event.actor).toEqual({
      type: 'system',
      id: 'job-1',
    });
  });

  it('cleans changes and clientDeclared', () => {
    const event = {
      ...auditEvent(),
      change: { before: { name: 'A' }, after: 'x', changedFields: ['name'], other: 1 },
      clientDeclared: ['client', 'client', 'bogus', 'location'],
    };
    const result = ok(normalizeAuditEvent(event, NOW));
    expect(result.event.change).toEqual({ before: { name: 'A' }, changedFields: ['name'] });
    expect(result.event.clientDeclared).toEqual(['client', 'location']);
    expect(result.droppedFields).toEqual(
      expect.arrayContaining(['change.after', 'change.other', 'clientDeclared']),
    );
    const empty = ok(
      normalizeAuditEvent({ ...auditEvent(), change: { after: 1 }, clientDeclared: 'x' }, NOW),
    );
    expect(empty.event.change).toBeUndefined();
    expect(empty.event.clientDeclared).toBeUndefined();
    const badFields = ok(
      normalizeAuditEvent({ ...auditEvent(), change: { changedFields: [1] } }, NOW),
    );
    expect(badFields.droppedFields).toContain('change.changedFields');
    expect(ok(normalizeAuditEvent({ ...auditEvent(), change: 'x' }, NOW)).droppedFields).toEqual([
      'change',
    ]);
  });

  it('drops sections that are not objects or lack what they require', () => {
    const event = {
      ...auditEvent(),
      resource: { label: 'no type' },
      request: 'x',
      details: { a: { b: { c: { d: { e: 1 } } } } },
    };
    const result = ok(normalizeAuditEvent(event, NOW));
    expect(result.droppedFields).toEqual(
      expect.arrayContaining(['resource', 'request', 'details']),
    );
    const bigDetails = ok(
      normalizeAuditEvent(
        {
          ...auditEvent(),
          details: Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [`k${String(i)}`, 'v'.repeat(900)]),
          ),
        },
        NOW,
      ),
    );
    expect(bigDetails.droppedFields).toContain('details');
    const emptyKey = ok(normalizeAuditEvent({ ...auditEvent(), details: { ['\u0000']: 1 } }, NOW));
    expect(emptyKey.event.details).toEqual({});
  });
});
