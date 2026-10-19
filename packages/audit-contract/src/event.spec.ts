import { describe, expect, it } from 'vitest';
import {
  AuditEventDraftSchema,
  AuditEventSchema,
  ClientEventBatchSchema,
  ClientEventSchema,
  LocationSchema,
} from './event.js';
import { auditEvent, clientEvent } from './testing/events.js';
import { LIMITS } from './version.js';

const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

describe('AuditEventSchema', () => {
  it('accepts a complete event', () => {
    expect(AuditEventSchema.parse(auditEvent())).toEqual(auditEvent());
  });

  it('accepts a minimal anonymous event', () => {
    const event = {
      schemaVersion: 1,
      eventId: auditEvent().eventId,
      sourceSeq: 9,
      occurredAt: '2026-10-14T12:00:00Z',
      catalogVersion: '0123456789abcdef',
      category: 'security',
      action: 'auth.session.sign_in_failed',
      outcome: 'failure',
      reason: 'invalid_credentials',
      actor: { type: 'anonymous', emailHmac: 'b'.repeat(64) },
    };
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
  });

  it('requires an id for a user and refuses one for an anonymous actor', () => {
    expect(
      issues(AuditEventSchema.safeParse(auditEvent({ actor: { type: 'user' } as never }))),
    ).toContain('actor.id');
    const anonymous = auditEvent({ actor: { type: 'anonymous', id: 'x' } as never });
    expect(AuditEventSchema.safeParse(anonymous).success).toBe(false);
  });

  it('refuses ids that look like emails, unknown fields and invented status codes', () => {
    expect(
      AuditEventSchema.safeParse(auditEvent({ actor: { type: 'user', id: 'a@b.com' } })).success,
    ).toBe(false);
    expect(AuditEventSchema.safeParse({ ...auditEvent(), extra: true }).success).toBe(false);
    expect(AuditEventSchema.safeParse(auditEvent({ request: { status: 999 } })).success).toBe(
      false,
    );
  });

  it('refuses the reserved category, bad actions and timestamps with an offset', () => {
    expect(AuditEventSchema.safeParse({ ...auditEvent(), category: 'audit_access' }).success).toBe(
      false,
    );
    expect(AuditEventSchema.safeParse(auditEvent({ action: 'auth.signed_in' })).success).toBe(
      false,
    );
    expect(
      AuditEventSchema.safeParse(auditEvent({ occurredAt: '2026-10-14T12:00:00+01:00' })).success,
    ).toBe(false);
  });

  it('bounds details by size and depth, and clientDeclared by uniqueness', () => {
    const big = { text: 'x'.repeat(9000) };
    expect(issues(AuditEventSchema.safeParse(auditEvent({ details: big })))).toContain('details');
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(issues(AuditEventSchema.safeParse(auditEvent({ details: deep })))).toContain('details');
    expect(
      AuditEventSchema.safeParse(auditEvent({ clientDeclared: ['client', 'client'] })).success,
    ).toBe(false);
  });

  it('has a draft form without the sequence number', () => {
    const { sourceSeq: _sequence, ...draft } = auditEvent();
    expect(AuditEventDraftSchema.safeParse(draft).success).toBe(true);
    expect(AuditEventSchema.safeParse(draft).success).toBe(false);
  });

  it('accepts IPv4 and IPv6 only', () => {
    expect(AuditEventSchema.safeParse(auditEvent({ network: { ip: '2001:db8::1' } })).success).toBe(
      true,
    );
    expect(AuditEventSchema.safeParse(auditEvent({ network: { ip: 'unknown' } })).success).toBe(
      false,
    );
  });
});

describe('client events', () => {
  it('accepts what a device may declare and nothing it may not', () => {
    expect(ClientEventSchema.parse(clientEvent())).toEqual(clientEvent());
    expect(
      ClientEventSchema.safeParse({ ...clientEvent(), actor: { type: 'system' } }).success,
    ).toBe(false);
    expect(ClientEventSchema.safeParse({ ...clientEvent(), sourceSeq: 1 }).success).toBe(false);
  });

  it('limits a batch', () => {
    expect(ClientEventBatchSchema.safeParse({ events: [] }).success).toBe(false);
    const events = Array.from({ length: 51 }, () => clientEvent());
    expect(ClientEventBatchSchema.safeParse({ events }).success).toBe(false);
    expect(ClientEventBatchSchema.safeParse({ events: events.slice(0, 50) }).success).toBe(true);
  });

  it("carries how many events the device dropped at sign-out, within its queue's size", () => {
    const events = [clientEvent()];
    for (const discardedAtSignOut of [0, 7, LIMITS.clientQueueEvents]) {
      expect(ClientEventBatchSchema.safeParse({ events, discardedAtSignOut }).success).toBe(true);
    }
    for (const discardedAtSignOut of [-1, 1.5, LIMITS.clientQueueEvents + 1, '3']) {
      expect(ClientEventBatchSchema.safeParse({ events, discardedAtSignOut }).success).toBe(false);
    }
  });

  it('takes an approximate location, and a precise one, within the planet and 100 km', () => {
    const location = {
      latitude: 19.43,
      longitude: -99.13,
      accuracyM: 1000,
      capturedAt: '2026-10-14T12:00:00.000Z',
    };
    expect(LocationSchema.safeParse(location).success).toBe(true);
    // Precise, with consent to the precise position.
    expect(
      LocationSchema.safeParse({ ...location, latitude: 19.43261, accuracyM: 5 }).success,
    ).toBe(true);
    expect(LocationSchema.safeParse({ ...location, accuracyM: 0 }).success).toBe(false);
    expect(LocationSchema.safeParse({ ...location, accuracyM: 100_001 }).success).toBe(false);
    expect(LocationSchema.safeParse({ ...location, latitude: 91 }).success).toBe(false);
  });
});
