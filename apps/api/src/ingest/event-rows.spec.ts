import type { ActionSpec, AuditEvent } from 'audit-contract';
import { describe, expect, it } from 'vitest';
import {
  type BuildInput,
  buildRows,
  contentHashOf,
  locationDigestOf,
  personalDigestOf,
} from './event-rows.js';
import { riskScore } from './risk.js';

const RECORDED = new Date('2026-10-14T12:00:00.000Z');

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    schemaVersion: 1,
    eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
    sourceSeq: 7,
    occurredAt: '2026-10-14T11:59:00.000Z',
    catalogVersion: '0123456789abcdef',
    category: 'security',
    action: 'auth.session.signed_in',
    outcome: 'success',
    actor: {
      type: 'user',
      id: 'user-1',
      role: 'member',
      label: 'j***@e***.com',
      emailHmac: 'a'.repeat(64),
    },
    ...overrides,
  };
}

const SIGNED_IN: ActionSpec = {
  category: 'security',
  severity: 'info',
  description: 'Signed in',
  source: 'server',
  details: {
    fields: {
      method: { type: 'enum', values: ['password'], required: true },
      note: { type: 'string', maxLength: 5 },
      owner: { type: 'id' },
      secret: { type: 'string', sensitive: true },
      email: { type: 'string', personal: true },
    },
  },
};

const PROFILE: ActionSpec = {
  category: 'audit',
  severity: 'low',
  description: 'Profile',
  source: 'both',
  outcomes: ['success'],
  change: {
    fields: { name: { type: 'string', personal: true, required: true }, plan: { type: 'string' } },
  },
};

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    event: event({ details: { method: 'password' } }),
    spec: SIGNED_IN,
    envelope: {
      appId: 'app-1',
      sequenceEpoch: '0199e0b1-0000-7000-8000-0000000000e1',
      connectorName: 'audit-nestjs',
      connectorVersion: '0.1.0',
      catalogVersionId: 'cat-1',
    },
    recordedAt: RECORDED,
    truncatedFields: [],
    droppedFields: [],
    flags: [],
    ...overrides,
  };
}

function ok(built: ReturnType<typeof buildRows>) {
  if (built.status !== 'ok') throw new Error(`rejected: ${built.reason}`);
  return built;
}

describe('buildRows', () => {
  it('builds the event, its personal row and hashes that bind them', () => {
    const built = ok(
      buildRows(
        input({
          event: event({
            details: { method: 'password', email: 'ada@example.com' },
            network: { ip: '2001:0DB8::1', userAgent: 'UA' },
            client: {
              type: 'android',
              deviceId: 'install-0001',
              sdk: { name: 'audit-expo', version: '0.1.0' },
            },
            resource: {
              type: 'session',
              id: 'f1',
              label: 'Session',
              parent: { type: 'user', id: 'user-1' },
            },
            request: {
              requestId: 'r1',
              method: 'POST',
              route: '/api/auth/sign-in',
              status: 200,
              durationMs: 3,
            },
          }),
          enrichment: {
            geoCountry: 'MX',
            geoAsn: 64500,
            geoCity: 'Mérida',
            geoLatitude: 20.967,
            geoLongitude: -89.624,
            geoAccuracyKm: 20,
            uaBrowser: 'Firefox',
            uaOs: 'Android',
            uaDeviceClass: 'mobile',
            riskSignals: [20],
          },
        }),
      ),
    );
    expect(built.event).toMatchObject({
      appId: 'app-1',
      sourceSeq: 7n,
      severity: 'info',
      riskScore: 20,
      actorId: 'user-1',
      ipScope: 'reserved',
      geoCountry: 'MX',
      clientSdk: 'audit-expo@0.1.0',
      parentResourceType: 'user',
      details: { method: 'password', email: { $personal: true } },
    });
    expect(built.personal).toMatchObject({
      ip: '2001:db8::1',
      deviceId: 'install-0001',
      actorLabel: 'j***@e***.com',
      resourceLabel: 'Session',
      geoCity: 'Mérida',
      geoLatitude: '20.967',
      personalChange: { details: { email: 'ada@example.com' } },
    });
    expect(built.personal?.salt).toHaveLength(16);
    expect(
      Buffer.from(built.event.contentHash).equals(Buffer.from(contentHashOf(built.event))),
    ).toBe(true);
    if (built.personal === null) throw new Error('personal');
    expect(
      Buffer.from(built.event.personalDigest ?? []).equals(
        Buffer.from(personalDigestOf(built.personal)),
      ),
    ).toBe(true);
    // Any change to a stored column changes the hash.
    expect(
      Buffer.from(contentHashOf({ ...built.event, riskScore: 99 })).equals(
        Buffer.from(built.event.contentHash),
      ),
    ).toBe(false);
  });

  it('keeps no personal row when there is nothing personal, and binds the device location', () => {
    const built = ok(
      buildRows(
        input({
          event: event({
            actor: { type: 'system' },
            details: { method: 'password' },
            location: {
              latitude: 19.4,
              longitude: -99.13,
              accuracyM: 1000,
              capturedAt: '2026-10-14T11:58:00.000Z',
            },
          }),
        }),
      ),
    );
    expect(built.personal).toBeNull();
    expect(built.event.actorId).toBeNull();
    expect(built.location).toMatchObject({
      latitude: '19.40',
      longitude: '-99.13',
      accuracyM: 1000,
    });
    if (built.location === null) throw new Error('location');
    expect(
      Buffer.from(built.event.locationDigest ?? []).equals(
        Buffer.from(locationDigestOf(built.location)),
      ),
    ).toBe(true);
  });

  it('keeps a precise location at five decimals, and an approximate one at two', () => {
    const at = (accuracyM: number) =>
      ok(
        buildRows(
          input({
            event: event({
              location: {
                latitude: 19.43261,
                longitude: -99.13321,
                accuracyM,
                capturedAt: '2026-10-14T11:58:00.000Z',
              },
            }),
          }),
        ),
      ).location;
    expect(at(5)).toMatchObject({
      latitude: '19.43261',
      longitude: '-99.13321',
      coordinateDecimals: 5,
    });
    expect(at(3000)).toMatchObject({ latitude: '19.43', coordinateDecimals: 2 });
  });

  it("keeps the actor's masked phone and the client hints with the personal data, bound by its digest", () => {
    const clientHints = {
      brands: [{ brand: 'Microsoft Edge', version: '155.0.3405.80' }],
      platform: 'Windows',
      platformVersion: '15.0.0',
    };
    const built = ok(
      buildRows(
        input({
          event: event({
            actor: { type: 'user', id: 'user-1', label: 'Ann Example', phoneLabel: '•••• 5678' },
            network: { clientHints },
          }),
        }),
      ),
    );
    expect(built.personal).toMatchObject({
      actorLabel: 'Ann Example',
      actorPhone: '•••• 5678',
      clientHints,
    });
    if (built.personal === null) throw new Error('personal');
    expect(
      Buffer.from(built.event.personalDigest ?? []).equals(
        Buffer.from(personalDigestOf(built.personal)),
      ),
    ).toBe(true);
    // Either changed afterwards: another digest.
    expect(
      Buffer.from(personalDigestOf({ ...built.personal, actorPhone: '•••• 0000' })).equals(
        Buffer.from(built.event.personalDigest ?? []),
      ),
    ).toBe(false);
  });

  it('cuts strings to the spec, drops what it does not declare, redacts sensitive values', () => {
    const built = ok(
      buildRows(
        input({
          event: event({
            details: {
              method: 'password',
              note: 'too long',
              owner: 'x'.repeat(200),
              secret: 'hunter2',
              extra: 1,
            },
          }),
          truncatedFields: ['actor.label'],
          droppedFields: ['severity'],
          flags: ['occurred_at_adjusted'],
        }),
      ),
    );
    expect(built.event.details).toEqual({
      method: 'password',
      note: 'too l',
      owner: 'x'.repeat(128),
      secret: '[REDACTED]',
    });
    expect(built.event.truncatedFields).toEqual(['actor.label', 'details.note', 'details.owner']);
    expect(built.event.droppedFields).toEqual(['details.extra', 'severity']);
    expect(built.event.flags).toEqual(['occurred_at_adjusted', 'sensitive_unmasked']);
    const masked = ok(
      buildRows(input({ event: event({ details: { method: 'password', secret: '[REDACTED]' } }) })),
    );
    expect(masked.event.flags).toEqual([]);
  });

  it('drops an invalid optional field and refuses an invalid or missing required one', () => {
    const optional = ok(
      buildRows(input({ event: event({ details: { method: 'password', owner: 'a@b' } }) })),
    );
    expect(optional.event.droppedFields).toEqual(['details.owner']);
    const invalid = buildRows(input({ event: event({ details: { method: 'sms' } }) }));
    expect(invalid).toEqual({
      status: 'rejected',
      reason: 'details_invalid',
      paths: ['details.method'],
    });
    const missing = buildRows(input({ event: event({ details: { note: 'x' } }) }));
    expect(missing).toEqual({
      status: 'rejected',
      reason: 'details_invalid',
      paths: ['details.method'],
    });
    const undeclared = ok(
      buildRows(
        input({ spec: { ...SIGNED_IN, details: undefined }, event: event({ details: { a: 1 } }) }),
      ),
    );
    expect(undeclared.event.details).toBeNull();
    expect(undeclared.event.droppedFields).toEqual(['details']);
  });

  it('applies the change fields, never refusing the event for them', () => {
    const built = ok(
      buildRows(
        input({
          spec: PROFILE,
          event: event({
            category: 'audit',
            action: 'account.profile.updated',
            change: {
              before: { name: 'Ana', plan: 'free' },
              after: { plan: 7 },
              changedFields: ['name', 'plan'],
            },
          }),
        }),
      ),
    );
    expect(built.event.changeBefore).toEqual({ name: { $personal: true }, plan: 'free' });
    expect(built.event.changeAfter).toEqual({});
    expect(built.event.changedFields).toEqual(['name', 'plan']);
    expect(built.event.droppedFields).toEqual(['change.after.name', 'change.after.plan']);
    expect(built.personal?.personalChange).toEqual({ before: { name: 'Ana' } });
  });

  it('refuses what the catalog does not allow', () => {
    expect(buildRows(input({ event: event({ category: 'audit' }) }))).toMatchObject({
      reason: 'category_mismatch',
    });
    expect(
      buildRows(input({ spec: PROFILE, event: event({ category: 'audit', outcome: 'failure' }) })),
    ).toMatchObject({ reason: 'outcome_not_allowed' });
    expect(
      buildRows(
        input({ event: event({ details: { method: 'password' }, clientDeclared: ['client'] }) }),
      ),
    ).toMatchObject({ reason: 'source_not_allowed' });
    expect(
      buildRows(
        input({
          event: event({ details: { method: 'password' }, occurredAt: '2020-01-01T00:00:00.000Z' }),
        }),
      ),
    ).toMatchObject({ reason: 'occurred_at_too_old' });
  });
});

describe('riskScore', () => {
  it('weighs severity, outcome, client-declared data and extra signals, within 0–100', () => {
    expect(
      riskScore({ severity: 'info', outcome: 'success', ipScope: 'public', clientDeclared: [] }),
    ).toBe(0);
    expect(
      riskScore({
        severity: 'high',
        outcome: 'failure',
        ipScope: null,
        clientDeclared: ['client'],
      }),
    ).toBe(75);
    expect(
      riskScore({ severity: 'medium', outcome: 'denied', ipScope: null, clientDeclared: [] }),
    ).toBe(45);
    expect(
      riskScore({
        severity: 'critical',
        outcome: 'denied',
        ipScope: null,
        clientDeclared: [],
        signals: [50],
      }),
    ).toBe(100);
    expect(
      riskScore({ severity: 'unknown', outcome: 'success', ipScope: null, clientDeclared: [] }),
    ).toBe(0);
  });
});
