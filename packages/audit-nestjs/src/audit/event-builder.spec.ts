import { describe, expect, it } from 'vitest';
import { TEST_ACTIONS, TEST_CONFIG } from './audit.testing.js';
import type { AuditAction } from './catalog/catalog.js';
import { changeOf } from './change.js';
import {
  AuditEventDraftSchema,
  CONTRACT_VERSION,
  emailHmac,
  maskEmail,
  REDACTED,
  secretKey,
  UUIDV7_PATTERN,
  uuidv7Time,
} from './contract/index.js';
import {
  actorOf,
  AuditEventInvalidError,
  type AuditInput,
  type BuildContext,
  buildEvent,
} from './event-builder.js';
import type { AuditScope } from './request-scope.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const CONTEXT: BuildContext = {
  catalogVersion: '0123456789abcdef',
  pseudonymKey: TEST_CONFIG.pseudonymKey,
  now: NOW,
};

/** The made-up project's catalog (TEST_ACTIONS), for what the base catalog lacks. */
const TEST_CONTEXT: BuildContext = { ...CONTEXT, actions: TEST_ACTIONS };
const ORDER_PLACED = 'shop.order.placed' as AuditAction;
const CART_VIEWED = 'shop.cart.viewed' as AuditAction;

const SCOPE: AuditScope = {
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  requestId: 'req-42',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  method: 'POST',
  route: '/api/orders',
  user: { id: 'user-1', role: 'member' },
  client: { type: 'ios', appVersion: '2.1.0' },
};

const pseudonymOf = (email: string) => emailHmac(secretKey(TEST_CONFIG.pseudonymKey), email);

/** The problems an invalid input is refused with. */
function problemsOf(input: AuditInput, context: BuildContext = CONTEXT): string[] {
  try {
    buildEvent(input, undefined, context);
  } catch (error) {
    expect(error).toBeInstanceOf(AuditEventInvalidError);
    const invalid = error as AuditEventInvalidError;
    expect(invalid.name).toBe('AuditEventInvalidError');
    expect(invalid.action).toBe(input.action);
    expect(invalid.message).toBe(
      `Audit event ${input.action} is invalid: ${invalid.problems.join('; ')}`,
    );
    return invalid.problems;
  }
  throw new Error(`${input.action} was accepted`);
}

describe('buildEvent', () => {
  it('fills in the defaults: success, now, anonymous, the catalog version', () => {
    const event = buildEvent({ action: 'auth.sign_up.requested' }, undefined, CONTEXT);
    expect(event).toEqual({
      schemaVersion: CONTRACT_VERSION,
      eventId: expect.stringMatching(UUIDV7_PATTERN) as unknown,
      occurredAt: '2026-10-15T12:00:00.000Z',
      catalogVersion: '0123456789abcdef',
      category: 'security',
      action: 'auth.sign_up.requested',
      outcome: 'success',
      actor: { type: 'anonymous' },
    });
    expect(AuditEventDraftSchema.safeParse(event).success).toBe(true);
  });

  it('gives each event an id of its own, from the clock', () => {
    const first = buildEvent({ action: 'auth.sign_up.requested' }, undefined, CONTEXT);
    const second = buildEvent({ action: 'auth.sign_up.requested' }, undefined, CONTEXT);
    expect(first.eventId).not.toBe(second.eventId);
    expect(uuidv7Time(first.eventId)).toBe(NOW);
    expect(uuidv7Time(second.eventId)).toBe(NOW);
  });

  it('takes everything the caller gives', () => {
    const occurredAt = new Date('2026-10-15T11:59:00.000Z');
    const change = {
      before: { role: 'member' },
      after: { role: 'admin' },
      changedFields: ['role'],
    };
    const event = buildEvent(
      {
        action: 'iam.user.role_changed',
        outcome: 'success',
        severity: 'critical',
        reason: 'promoted_by_admin',
        actor: { type: 'user', id: 'admin-1', role: 'admin' },
        resource: { type: 'user', id: 'user-2' },
        change,
        status: 200,
        occurredAt,
      },
      undefined,
      CONTEXT,
    );
    expect(event).toMatchObject({
      category: 'audit',
      action: 'iam.user.role_changed',
      outcome: 'success',
      severity: 'critical',
      reason: 'promoted_by_admin',
      occurredAt: '2026-10-15T11:59:00.000Z',
      actor: { type: 'user', id: 'admin-1', role: 'admin' },
      resource: { type: 'user', id: 'user-2' },
      change,
      request: { status: 200 },
    });
    expect(event).not.toHaveProperty('network');
    expect(event).not.toHaveProperty('client');
  });

  it('validates the details against the action', () => {
    const event = buildEvent(
      { action: 'auth.session.signed_in', details: { method: 'mfa' } },
      undefined,
      CONTEXT,
    );
    expect(event.details).toEqual({ method: 'mfa' });
  });

  it('validates against the catalog it is given', () => {
    const change = changeOf(
      'shop.order.placed',
      { status: 'draft', cardNumber: '4111111111111111' },
      { status: 'placed', cardNumber: '4111111111111111' },
      TEST_ACTIONS,
    );
    const event = buildEvent(
      {
        action: ORDER_PLACED,
        resource: { type: 'order', id: 'order-7' },
        change,
        details: { total: 12.5 },
      },
      undefined,
      TEST_CONTEXT,
    );
    expect(event).toMatchObject({
      category: 'audit',
      action: 'shop.order.placed',
      change: {
        before: { status: 'draft', cardNumber: REDACTED },
        after: { status: 'placed', cardNumber: REDACTED },
        changedFields: ['status'],
      },
      details: { total: 12.5 },
    });
    expect(problemsOf({ action: ORDER_PLACED, details: { total: -1 } }, TEST_CONTEXT)).toEqual([
      'details.total: Too small: expected number to be >=0',
    ]);
    expect(
      problemsOf({ action: ORDER_PLACED, details: { total: 'twelve' } }, TEST_CONTEXT),
    ).toHaveLength(1);
  });

  it('takes the request, the network and the client from the scope', () => {
    const event = buildEvent(
      { action: CART_VIEWED, details: { items: 3 }, status: 200 },
      SCOPE,
      TEST_CONTEXT,
    );
    expect(event).toMatchObject({
      actor: { type: 'user', id: 'user-1', role: 'member' },
      request: {
        requestId: 'req-42',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        method: 'POST',
        route: '/api/orders',
        status: 200,
      },
      network: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      client: { type: 'ios', appVersion: '2.1.0' },
    });
    expect(AuditEventDraftSchema.safeParse(event).success).toBe(true);
  });

  it('records only the parts of the scope there are', () => {
    const build = (scope: AuditScope) =>
      buildEvent({ action: 'auth.sign_up.requested' }, scope, CONTEXT);
    const empty = build({});
    expect(empty).not.toHaveProperty('request');
    expect(empty).not.toHaveProperty('network');
    expect(empty).not.toHaveProperty('client');
    expect(empty.actor).toEqual({ type: 'anonymous' });
    expect(build({ ip: '2001:db8::1' }).network).toEqual({ ip: '2001:db8::1' });
    expect(build({ userAgent: 'curl/8.0' }).network).toEqual({ userAgent: 'curl/8.0' });
    const withHints = build({ clientHints: { platform: 'Windows', platformVersion: '15.0.0' } });
    expect(withHints.network).toEqual({
      clientHints: { platform: 'Windows', platformVersion: '15.0.0' },
    });
    expect(AuditEventDraftSchema.safeParse(withHints).success).toBe(true);
    expect(build({ method: 'GET' }).request).toEqual({ method: 'GET' });
    expect(build({ requestId: 'r-1' }).request).toEqual({ requestId: 'r-1' });
    expect(build({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }).request).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
    expect(build({ route: '/api/health' }).request).toEqual({ route: '/api/health' });
  });

  it('refuses an action that is not in the catalog', () => {
    expect(problemsOf({ action: 'test.unknown.action' as AuditAction })).toEqual([
      'the action is not in the catalog',
    ]);
    expect(problemsOf({ action: 'auth.session.signed_in' }, TEST_CONTEXT)).toEqual([
      'the action is not in the catalog',
    ]);
  });

  it('refuses an outcome the action does not have', () => {
    expect(problemsOf({ action: 'auth.session.sign_in_failed' })).toEqual([
      'outcome success is not one of failure, denied',
    ]);
    expect(
      buildEvent(
        { action: 'auth.session.sign_in_failed', outcome: 'denied', reason: 'invalid_credentials' },
        undefined,
        CONTEXT,
      ).outcome,
    ).toBe('denied');
  });

  it('refuses a client action: it comes from a device', () => {
    expect(problemsOf({ action: 'client.session.expired' })).toEqual([
      'a client action comes from a device, not the server',
    ]);
  });

  it('refuses details the action does not declare', () => {
    expect(problemsOf({ action: 'auth.session.signed_out', details: { method: 'mfa' } })).toEqual([
      'details: Unrecognized key: "method"',
    ]);
    expect(problemsOf({ action: 'iam.users.listed', details: { count: -1 } })).toEqual([
      'details.count: Too small: expected number to be >=0',
    ]);
  });

  it('refuses a change the action does not declare', () => {
    expect(
      problemsOf({ action: 'auth.session.signed_in', change: { changedFields: ['method'] } }),
    ).toEqual(['the action declares no change in the catalog']);
  });

  it('refuses what the contract refuses', () => {
    expect(problemsOf({ action: 'auth.sign_up.requested', reason: 'Not A Code' })).toEqual([
      'reason: Invalid string: must match pattern /^[a-z][a-z0-9_]{0,63}$/',
    ]);
    expect(problemsOf({ action: 'auth.sign_up.requested', status: 99 })).toHaveLength(1);
    expect(
      problemsOf({ action: 'auth.sign_up.requested', actor: { type: 'user', id: 'a@b' } }),
    ).toHaveLength(1);
  });

  it('lists every problem at once', () => {
    expect(
      problemsOf({
        action: 'client.link.rejected',
        outcome: 'success',
        details: { url: 'https://example.com' },
        change: {},
        reason: 'Bad',
      }),
    ).toHaveLength(4);
  });
});

describe('actorOf', () => {
  const key = TEST_CONFIG.pseudonymKey;

  it('is the signed-in user of the scope, or anonymous', () => {
    expect(actorOf(undefined, SCOPE, key)).toEqual({ type: 'user', id: 'user-1', role: 'member' });
    expect(actorOf(undefined, {}, key)).toEqual({ type: 'anonymous' });
    expect(actorOf(undefined, undefined, key)).toEqual({ type: 'anonymous' });
  });

  it('prefers the given actor to the scope', () => {
    expect(actorOf({ type: 'system' }, SCOPE, key)).toEqual({ type: 'system' });
  });

  it('turns an email into its pseudonym and a masked label', () => {
    const email = ' Ana.Perez@Example.com ';
    expect(actorOf({ type: 'user', id: 'user-1', email }, undefined, key)).toEqual({
      type: 'user',
      id: 'user-1',
      emailHmac: pseudonymOf('ana.perez@example.com'),
      label: maskEmail(email),
    });
    expect(maskEmail(email)).toBe('a***@e***.com');
    expect(actorOf({ type: 'anonymous', email }, undefined, key)).toEqual({
      type: 'anonymous',
      emailHmac: pseudonymOf(email),
      label: 'a***@e***.com',
    });
  });

  it('labels a person with their name, and masks their phone before it leaves', () => {
    const email = 'ana.perez@example.com';
    expect(
      actorOf(
        {
          type: 'user',
          id: 'user-1',
          email,
          name: '  Ana María Pérez ',
          phone: '+52 81 1234 5678',
        },
        undefined,
        key,
      ),
    ).toEqual({
      type: 'user',
      id: 'user-1',
      emailHmac: pseudonymOf(email),
      label: 'Ana María Pérez',
      phoneLabel: '•••• 5678',
    });
    // A name of nothing falls back to the masked email; a phone without four digits is left out.
    expect(actorOf({ type: 'anonymous', email, name: '   ', phone: '12' }, undefined, key)).toEqual(
      {
        type: 'anonymous',
        emailHmac: pseudonymOf(email),
        label: 'a***@e***.com',
      },
    );
    // A name alone, cut to the contract's limit.
    expect(actorOf({ type: 'user', id: 'u-2', name: 'x'.repeat(300) }, undefined, key)).toEqual({
      type: 'user',
      id: 'u-2',
      label: 'x'.repeat(128),
    });
  });

  it('keeps the role of a user when there is one', () => {
    expect(actorOf({ type: 'user', id: 'u-1', role: 'admin' }, undefined, key)).toEqual({
      type: 'user',
      id: 'u-1',
      role: 'admin',
    });
    expect(actorOf({ type: 'user', id: 'u-1' }, undefined, key)).toEqual({
      type: 'user',
      id: 'u-1',
    });
  });

  it('names a system or a service by its id, when given', () => {
    expect(actorOf({ type: 'system', id: 'nightly-cleanup' }, undefined, key)).toEqual({
      type: 'system',
      id: 'nightly-cleanup',
    });
    expect(actorOf({ type: 'service' }, undefined, key)).toEqual({ type: 'service' });
    expect(actorOf({ type: 'service', id: 'billing' }, undefined, key)).toEqual({
      type: 'service',
      id: 'billing',
    });
  });

  it('pseudonymizes with the key it is given', () => {
    const other = Buffer.alloc(32, 9).toString('base64url');
    const actor = actorOf({ type: 'anonymous', email: 'ana@example.com' }, undefined, other);
    expect(actor).toMatchObject({ emailHmac: emailHmac(secretKey(other), 'ana@example.com') });
    expect(actor).not.toMatchObject({ emailHmac: pseudonymOf('ana@example.com') });
  });
});
