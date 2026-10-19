import type { AuditEvent, ClientEvent } from '../event.js';

// Valid events of the contract, for specs here and in Audit Hub. Apart from
// the catalog's fixtures, so a spec of events needs nothing of the catalog
// (the Expo connector vendors event.ts and its spec without it).

export const EVENT_ID = '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70';
export const EPOCH = '0199e0b1-0000-7000-8000-000000000001';

export function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    schemaVersion: 1,
    eventId: EVENT_ID,
    sourceSeq: 1,
    occurredAt: '2026-10-14T12:00:00.000Z',
    catalogVersion: '9f2c1a7b3e5d4c21',
    category: 'security',
    action: 'auth.session.signed_in',
    outcome: 'success',
    actor: {
      type: 'user',
      id: '0199e0b1-1111-7000-8000-000000000001',
      role: 'member',
      label: 'j***@e***.com',
      emailHmac: 'a'.repeat(64),
    },
    resource: { type: 'session', id: 'family-1' },
    request: {
      requestId: 'req-1',
      method: 'POST',
      route: '/api/auth/sign-in',
      status: 200,
      durationMs: 42,
    },
    network: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
    client: { type: 'web' },
    details: { method: 'password' },
    ...overrides,
  };
}

export function clientEvent(overrides: Partial<ClientEvent> = {}): ClientEvent {
  return {
    eventId: EVENT_ID,
    occurredAt: '2026-10-14T12:00:00.000Z',
    action: 'client.session.expired',
    outcome: 'success',
    client: {
      type: 'android',
      appVersion: '1.4.2',
      appBuild: '42',
      os: 'Android',
      osVersion: '15',
      deviceModel: 'Pixel 9',
      deviceId: 'install-0001',
      locale: 'es-MX',
      timeZone: 'America/Mexico_City',
      networkType: 'wifi',
      route: '/(app)/settings',
      sdk: { name: 'audit-expo', version: '0.1.0' },
    },
    ...overrides,
  };
}
