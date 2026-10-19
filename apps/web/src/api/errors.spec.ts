import { describe, expect, it, vi } from 'vitest';
import { failure, json, ok, stubFetch } from '../test/http';
import { api } from './client';
import {
  call,
  describeFailure,
  failedField,
  failureOf,
  NETWORK_ERROR_MESSAGE,
  NOT_AN_ENVELOPE_MESSAGE,
} from './errors';

const outcome = (response: Response, body?: unknown) =>
  Promise.resolve(
    response.ok
      ? { data: body as { data?: unknown; message: string }, response }
      : { error: body, response },
  );

describe('call', () => {
  it('unwraps the data of a successful envelope', async () => {
    const response = ok({ id: 1 });
    await expect(call(outcome(response, await response.clone().json()))).resolves.toEqual({
      ok: true,
      data: { id: 1 },
    });
  });

  it('folds a bodyless success to null', async () => {
    await expect(call(outcome(new Response(null, { status: 204 })))).resolves.toEqual({
      ok: true,
      data: null,
    });
  });

  it('fails a success answer that is not the envelope: not the API answering', async () => {
    // A proxy, a captive portal or a deploy in progress can answer 2xx with
    // something else; its body must never reach a screen as data.
    const notAnEnvelope = { ok: false, failure: { status: 502, message: NOT_AN_ENVELOPE_MESSAGE } };
    for (const body of [
      {},
      [],
      'ok',
      42,
      { data: { id: 1 } },
      { message: 'ok' },
      { data: null, message: 1 },
    ]) {
      await expect(call(outcome(json(200, body), body)), JSON.stringify(body)).resolves.toEqual(
        notAnEnvelope,
      );
    }
    // 200 with an empty body: openapi-fetch reads no data.
    await expect(
      call(outcome(new Response('', { status: 200, headers: { 'Content-Length': '0' } }))),
    ).resolves.toEqual(notAnEnvelope);
    await expect(call(outcome(json(201, null), null))).resolves.toEqual(notAnEnvelope);
  });

  it('accepts an envelope whose data is null', async () => {
    await expect(call(outcome(ok(null), { data: null, message: 'Done' }))).resolves.toEqual({
      ok: true,
      data: null,
    });
  });

  it('keeps the status and server message of an error envelope', async () => {
    const response = failure(409, 'Already exists');
    await expect(
      call(outcome(response, { data: null, message: 'Already exists' })),
    ).resolves.toEqual({ ok: false, failure: { status: 409, message: 'Already exists' } });
  });

  it('turns a network error into status 0', async () => {
    await expect(call(Promise.reject(new TypeError('Failed to fetch')))).resolves.toEqual({
      ok: false,
      failure: { status: 0, message: NETWORK_ERROR_MESSAGE },
    });
  });

  it('fails a success answer that is not JSON as not the API answering, not as offline', async () => {
    // A captive portal or a proxy answering 200 with a page: the client's
    // own JSON parsing rejects, before any envelope can be checked.
    stubFetch({
      'GET /api/users/me': () =>
        new Response('<html><body>Sign in to the Wi-Fi</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    });
    try {
      await expect(call(api.GET('/api/users/me'))).resolves.toEqual({
        ok: false,
        failure: { status: 502, message: NOT_AN_ENVELOPE_MESSAGE },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('failureOf', () => {
  it('reads Retry-After on a 429', () => {
    expect(failureOf(json(429, {}, { 'Retry-After': '12' }), undefined)).toEqual({
      status: 429,
      message: 'HTTP 429',
      retryAfterSec: 12,
    });
    expect(failureOf(json(429, {}, { 'Retry-After': 'soon' }), undefined).retryAfterSec).toBe(
      undefined,
    );
  });

  it('keeps why the API refused, from Audit-Error', () => {
    // A 403 that a recent step-up would lift (docs/adr/0012).
    expect(
      failureOf(
        failure(403, 'A recent step-up is required', {
          'Audit-Error': 'reauthentication_required',
        }),
        { data: null, message: 'A recent step-up is required' },
      ),
    ).toEqual({
      status: 403,
      message: 'A recent step-up is required',
      code: 'reauthentication_required',
    });
    expect(failureOf(json(409, {}, { 'Audit-Error': 'a'.repeat(64) }), undefined).code).toBe(
      'a'.repeat(64),
    );
  });

  it('ignores an Audit-Error that is not a code, and a failure without one', () => {
    for (const odd of [
      'Reauthentication_Required',
      'reauthentication required',
      '<script>alert(1)</script>',
      'code-1',
      'a'.repeat(65),
      '',
    ]) {
      expect(failureOf(json(403, {}, { 'Audit-Error': odd }), undefined), odd).toEqual({
        status: 403,
        message: 'HTTP 403',
      });
    }
    expect(failureOf(json(403, {}), undefined)).not.toHaveProperty('code');
  });

  it('falls back to the status when the body has no usable message', () => {
    expect(failureOf(json(500, {}), { message: '' }).message).toBe('HTTP 500');
    expect(failureOf(json(500, {}), { message: 42 }).message).toBe('HTTP 500');
    expect(failureOf(json(500, {}), 'Internal error').message).toBe('HTTP 500');
    expect(failureOf(json(429, {}), undefined)).toEqual({ status: 429, message: 'HTTP 429' });
  });
});

describe('describeFailure', () => {
  it('gives users a message by status, never the raw server text', () => {
    expect(describeFailure({ status: 0, message: 'x' })).toBe(NETWORK_ERROR_MESSAGE);
    expect(describeFailure({ status: 403, message: 'Not allowed for this role' })).toBe(
      'You do not have access to this.',
    );
    expect(describeFailure({ status: 429, message: 'x', retryAfterSec: 30 })).toContain(
      '30 seconds',
    );
    expect(describeFailure({ status: 503, message: 'Database unreachable' })).toBe(
      'The service is unavailable. Try again later.',
    );
    expect(describeFailure({ status: 418, message: 'x' })).toBe('Something went wrong (418).');
    expect(describeFailure({ status: 400, message: 'x' })).toBe(
      'Check the highlighted data and try again.',
    );
    expect(describeFailure({ status: 401, message: 'x' })).toBe(
      'Your session has ended. Sign in again.',
    );
    expect(describeFailure({ status: 404, message: 'x' })).toBe('Not found.');
    expect(describeFailure({ status: 429, message: 'x' })).toBe(
      'Too many attempts. Wait a moment and retry.',
    );
  });
});

describe('failedField', () => {
  it('names the field a 400 is about, from the message the API starts with it', () => {
    expect(failedField({ status: 400, message: 'password: Use at least 15 characters.' })).toBe(
      'password',
    );
    expect(failedField({ status: 400, message: 'newEmail: Invalid email address' })).toBe(
      'newEmail',
    );
    expect(failedField({ status: 400, message: 'Invalid link' })).toBeUndefined();
    expect(failedField({ status: 403, message: 'password: wrong' })).toBeUndefined();
  });
});
