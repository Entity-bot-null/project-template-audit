import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AuditConfig } from './audit-env.js';
import { CLIENT_MAX_AGE_MS, CLIENT_MAX_SKEW_MS } from './audit.constants.js';
import { AuditService } from './audit.service.js';
import { MemoryStore, TEST_CONFIG } from './audit.testing.js';
import { ACTIONS } from './catalog/catalog.js';
import { ClientEventBatchBodySchema, ClientEventsService } from './client-events.service.js';
import {
  type ActionSpec,
  type ClientEvent,
  ClientEventBatchSchema,
  CONTRACT_VERSION,
  nodeRandomFill,
  uuidv7,
} from './contract/index.js';
import type { RequestUser } from './host.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
let now = NOW;
const clock = () => now;

const USER: RequestUser = { id: 'user-1', role: 'member' };
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';

/** An Express request as the API hands it over, with the headers given. */
function fakeRequest(
  headers: Record<string, string> = { 'user-agent': USER_AGENT },
  ip: string | null = '203.0.113.7',
): Request {
  return {
    ip: ip ?? undefined,
    method: 'POST',
    baseUrl: '/api/audit',
    route: { path: '/client-events' },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function clientEvent(overrides: Partial<ClientEvent> = {}): ClientEvent {
  return {
    eventId: uuidv7(nodeRandomFill, now),
    occurredAt: new Date(now - 60_000).toISOString(),
    action: 'client.session.expired',
    outcome: 'success',
    client: { type: 'ios', appVersion: '1.4.2', appBuild: '42', deviceId: 'install-0001' },
    ...overrides,
  };
}

function setup(config: AuditConfig | null = TEST_CONFIG) {
  const store = new MemoryStore();
  store.now = clock;
  const audit = new AuditService(config, store, clock);
  const service = new ClientEventsService(config, store, clock, audit);
  return { store, audit, service };
}

beforeEach(() => {
  now = NOW;
});

describe('ClientEventBatchBodySchema', () => {
  it('documents as an OpenAPI schema without references, which an inline schema cannot hold', () => {
    const json = z.toJSONSchema(ClientEventBatchBodySchema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    });
    expect(JSON.stringify(json)).not.toContain('$ref');
  });

  it("accepts the contract's batches, and leaves each event's details to the service", () => {
    const valid = {
      events: [
        clientEvent({
          action: 'client.security.csp_violation',
          details: { directive: 'script-src', blockedOrigin: 'https://cdn.example.net' },
        }),
      ],
    };
    expect(ClientEventBatchSchema.safeParse(valid).success).toBe(true);
    expect(ClientEventBatchBodySchema.safeParse(valid).success).toBe(true);
    const odd = { events: [{ ...clientEvent(), details: { nested: { deep: [1, 'two'] } } }] };
    expect(ClientEventBatchBodySchema.safeParse(odd).success).toBe(true);
    for (const wrong of [{ events: [] }, { events: [{ ...clientEvent(), extra: 1 }] }, {}]) {
      expect(ClientEventBatchBodySchema.safeParse(wrong).success).toBe(false);
    }
  });
});

describe('ClientEventsService', () => {
  it('answers 404 while the connector is off', async () => {
    const { store, service } = setup(null);

    await expect(service.receive(USER, fakeRequest(), { events: [clientEvent()] })).rejects.toThrow(
      NotFoundException,
    );
    expect(store.rows).toEqual([]);
  });

  it("adds what the device dropped at sign-out to the instance's count, batch after batch", async () => {
    const { audit, service } = setup();

    await service.receive(USER, fakeRequest(), { events: [clientEvent()], discardedAtSignOut: 3 });
    await service.receive(USER, fakeRequest(), { events: [clientEvent()] });
    await service.receive(USER, fakeRequest(), { events: [clientEvent()], discardedAtSignOut: 0 });
    await service.receive(USER, fakeRequest(), { events: [clientEvent()], discardedAtSignOut: 2 });

    expect(audit.discardedAtSignOut).toBe(5);
  });

  it('queues an accepted event with the actor and the network taken from the server', async () => {
    const { store, audit, service } = setup();
    const event = clientEvent();

    const answer = await service.receive(USER, fakeRequest(), { events: [event] });

    expect(answer).toEqual({ results: [{ eventId: event.eventId, status: 'accepted' }] });
    expect(store.rows.map((row) => row.draft)).toEqual([
      {
        schemaVersion: CONTRACT_VERSION,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        catalogVersion: audit.catalogVersion,
        category: 'security',
        action: 'client.session.expired',
        outcome: 'success',
        actor: { type: 'user', id: 'user-1', role: 'member' },
        network: { ip: '203.0.113.7', userAgent: USER_AGENT },
        client: event.client,
        clientDeclared: ['occurredAt', 'client'],
      },
    ]);
  });

  it('marks every section the device declared', async () => {
    const { store, service } = setup();
    const event = clientEvent({
      action: 'client.security.csp_violation',
      outcome: 'denied',
      reason: 'blocked_by_csp',
      resource: { type: 'page', id: 'settings' },
      location: {
        latitude: 25.67,
        longitude: -100.31,
        accuracyM: 5000,
        capturedAt: new Date(now - 120_000).toISOString(),
      },
      details: { directive: 'script-src', blockedOrigin: 'https://cdn.example.net' },
    });

    await service.receive(USER, fakeRequest(), { events: [event] });

    expect(store.rows[0]?.draft).toMatchObject({
      action: 'client.security.csp_violation',
      outcome: 'denied',
      reason: 'blocked_by_csp',
      resource: event.resource,
      location: event.location,
      details: event.details,
      clientDeclared: ['occurredAt', 'client', 'location', 'details', 'resource'],
    });
  });

  it('records no address the request does not carry', async () => {
    const { store, service } = setup();

    await service.receive(USER, fakeRequest({}, null), { events: [clientEvent()] });

    expect(store.rows[0]?.draft.network).toEqual({});
  });

  it('answers duplicate for an event queued before and for a repeat within the batch', async () => {
    const { store, service } = setup();
    const first = clientEvent();
    const second = clientEvent();

    await service.receive(USER, fakeRequest(), { events: [first] });
    const answer = await service.receive(USER, fakeRequest(), {
      events: [first, second, second],
    });

    expect(answer.results).toEqual([
      { eventId: first.eventId, status: 'duplicate' },
      { eventId: second.eventId, status: 'accepted' },
      { eventId: second.eventId, status: 'duplicate' },
    ]);
    expect(store.rows.map((row) => row.eventId)).toEqual([first.eventId, second.eventId]);
  });

  it.each([
    [
      'an action only the server records',
      { action: 'auth.session.signed_in' },
      USER,
      'action_not_allowed',
    ],
    [
      'a server action with a fixed outcome',
      { action: 'auth.session.sign_in_failed', outcome: 'failure' as const },
      USER,
      'action_not_allowed',
    ],
    [
      'an action not in the catalog',
      { action: 'client.thing.unknown' },
      USER,
      'action_not_allowed',
    ],
    [
      'details for an action that declares none',
      { details: { screen: 'home' } },
      USER,
      'details_invalid',
    ],
    [
      'details the catalog refuses',
      { action: 'client.security.csp_violation', details: { directive: 42 } },
      USER,
      'details_invalid',
    ],
    [
      'a user id the contract refuses',
      {},
      { id: 'someone@example.com', role: 'member' },
      'schema_invalid',
    ],
    [
      'a role the contract refuses',
      {},
      // A project whose roles the contract's pattern does not allow.
      { id: 'user-1', role: 'Admin' } as unknown as RequestUser,
      'schema_invalid',
    ],
  ] satisfies [string, Partial<ClientEvent>, RequestUser, string][])(
    'rejects %s',
    async (_case, overrides, user, reason) => {
      const { store, service } = setup();
      const event = clientEvent(overrides);

      const answer = await service.receive(user, fakeRequest(), { events: [event] });

      expect(answer.results).toEqual([{ eventId: event.eventId, status: 'rejected', reason }]);
      expect(store.rows).toEqual([]);
    },
  );

  it('rejects an outcome the catalog does not allow the action', async () => {
    // No client action of the base catalog fixes its outcomes: one is added
    // for this spec, and taken out again.
    const actions = ACTIONS as Record<string, ActionSpec>;
    actions['client.spec.confirmed'] = {
      category: 'security',
      severity: 'low',
      description: 'A device confirmed something.',
      source: 'client',
      outcomes: ['success'],
    };
    try {
      const { service } = setup();
      const refused = clientEvent({ action: 'client.spec.confirmed', outcome: 'failure' });
      const allowed = clientEvent({ action: 'client.spec.confirmed', outcome: 'success' });

      const answer = await service.receive(USER, fakeRequest(), { events: [refused, allowed] });

      expect(answer.results).toEqual([
        { eventId: refused.eventId, status: 'rejected', reason: 'outcome_not_allowed' },
        { eventId: allowed.eventId, status: 'accepted' },
      ]);
    } finally {
      delete actions['client.spec.confirmed'];
    }
  });

  it.each([
    ['older than the oldest kept', -CLIENT_MAX_AGE_MS - 1, false],
    ['later than the clock skew', CLIENT_MAX_SKEW_MS + 1, false],
    ['as old as the oldest kept', -CLIENT_MAX_AGE_MS, true],
    ['a day old', -24 * 60 * 60_000, true],
    ['ahead within the clock skew', CLIENT_MAX_SKEW_MS, true],
  ])(
    'takes the time of an event %s from the server unless it is plausible',
    async (_case, offset, kept) => {
      const { store, service } = setup();
      const occurredAt = new Date(now + offset).toISOString();

      await service.receive(USER, fakeRequest(), { events: [clientEvent({ occurredAt })] });

      expect(store.rows[0]?.draft.occurredAt).toBe(kept ? occurredAt : new Date(now).toISOString());
    },
  );
});
