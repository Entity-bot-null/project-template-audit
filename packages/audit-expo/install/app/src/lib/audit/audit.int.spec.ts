import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { auditTransport, retryAfterOf } from '@/api/audit';
import { useSessionStore } from '@/auth/session';
import { secureStorage, STORAGE_KEYS } from '@/lib/storage';
import { bodyOf, failure, json, ok, stubFetch, type StubbedFetch } from '@/test/http';
import { endTestSession, signInForTest } from '@/test/session';

import {
  audit,
  auditTriggers,
  pushTokenRegistrar,
  recordRejectedLink,
  registerPushToken,
  signOut,
} from './audit.wiring';
import { DEVICE_ID_PATTERN } from './contract';

// The connector's adapters in the app (src/api/audit.ts, src/lib/storage/auditQueue.ts,
// audit.wiring.ts) against the API stubbed with fetch: the routes, the
// session's token and the device's headers. Created once by
// `pnpm connector add --kind expo`; the project's own code from then on.
// The other specs get the connector's fake transport (src/test/setup.ts).
jest.unmock('@/api/audit');

const PROMPT = {
  id: '0199f0c4-0000-7000-8000-00000000a001',
  signals: ['new_device'],
  context: { clientType: 'android' },
  createdAt: '2026-10-17T12:00:00.000Z',
  expiresAt: '2026-10-24T12:00:00.000Z',
};
const PHONE = 'ExponentPushToken[phone-1]';

let fetchStub: StubbedFetch;
let log: jest.SpyInstance;

/** The events the API received, by action. */
async function sentActions(): Promise<string[]> {
  const batches = fetchStub.requests.filter((request) =>
    request.url.endsWith('/api/audit/client-events'),
  );
  const bodies = (await Promise.all(batches.map(bodyOf))) as { events: { action: string }[] }[];
  return bodies.flatMap((body) => body.events.map((event) => event.action));
}

function accepting(request: Request) {
  return bodyOf(request).then((body) =>
    ok({
      results: (body as { events: { eventId: string }[] }).events.map((event) => ({
        eventId: event.eventId,
        status: 'accepted',
      })),
    }),
  );
}

beforeEach(() => {
  // The template's sign-out does not wait for the server's logout: it logs that it was not confirmed.
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  fetchStub = stubFetch({
    'POST /api/audit/client-events': accepting,
    'PUT /api/account/push-token': () => new Response(null, { status: 204 }),
    'DELETE /api/account/push-token': () => new Response(null, { status: 204 }),
  });
});

afterEach(async () => {
  // As the app signs out (signOut()): the connector lets go of the user first.
  await audit.beforeSignOut();
  await endTestSession(fetchStub);
  fetchStub.restore();
});

describe('the transport (src/api/audit.ts)', () => {
  const batch = {
    events: [
      {
        eventId: '0199f0c4-0000-7000-8000-00000000c001',
        occurredAt: '2026-10-17T12:00:00.000Z',
        action: 'client.link.rejected',
        outcome: 'success' as const,
        client: { type: 'ios' as const },
      },
    ],
  };

  it("sends the device's events with the session's token, and reads the answer", async () => {
    await signInForTest(fetchStub);
    await expect(auditTransport.sendEvents(batch)).resolves.toEqual({
      kind: 'answered',
      results: [{ eventId: batch.events[0]?.eventId, status: 'accepted' }],
    });
    const [request] = fetchStub.requests.filter((sent) => sent.url.endsWith('/client-events'));
    expect(request?.headers.get('Authorization')).toMatch(/^Bearer /);
    expect(await bodyOf(request!)).toEqual(batch);
  });

  it.each([
    [
      'an answer that breaks the contract',
      () => ok({ results: 'none' }),
      { kind: 'later', status: 500 },
    ],
    [
      'busy',
      () => json(429, { data: null, message: 'Slow down' }, { 'Retry-After': '5' }),
      { kind: 'later', status: 429, retryAfterMs: 5000 },
    ],
    ['down', () => failure(503, 'Unavailable'), { kind: 'later', status: 503 }],
    ['its connector off', () => failure(404, 'Not found'), { kind: 'refused', status: 404 }],
    ['refusing the batch', () => failure(400, 'Invalid body'), { kind: 'refused', status: 400 }],
  ])('tells the client what the API said: %s', async (_case, answer, result) => {
    await signInForTest(fetchStub);
    fetchStub.on('POST /api/audit/client-events', answer);
    await expect(auditTransport.sendEvents(batch)).resolves.toEqual(result);
  });

  it('keeps the events for later when the session it went with ended', async () => {
    await signInForTest(fetchStub);
    fetchStub.on('POST /api/audit/client-events', () => failure(401, 'Session revoked'));
    fetchStub.on('POST /api/auth/refresh', () => failure(401, 'Session revoked'));
    await expect(auditTransport.sendEvents(batch)).resolves.toEqual({ kind: 'later', status: 401 });
  });

  it('waits when there is no answer, or the session cannot be renewed for now', async () => {
    await signInForTest(fetchStub);
    fetchStub.on('POST /api/audit/client-events', () => {
      throw new TypeError('Network request failed');
    });
    await expect(auditTransport.sendEvents(batch)).resolves.toEqual({ kind: 'unreachable' });

    // A stored session whose renewal fails for now: the API's database is down.
    await endTestSession(fetchStub);
    await secureStorage.setItem(STORAGE_KEYS.refreshToken, 'refresh-1');
    useSessionStore.setState({ status: 'signedIn', endedBy: null });
    fetchStub.on('POST /api/auth/refresh', () => failure(500, 'Database down'));
    await expect(auditTransport.sendEvents(batch)).resolves.toEqual({
      kind: 'later',
      status: 500,
    });
  });

  it('lets a mistake in the app through, instead of retrying it forever', async () => {
    await signInForTest(fetchStub);
    await expect(
      auditTransport.sendEvents({ events: [{ ...batch.events[0], big: 1n }] } as never),
    ).rejects.toThrow(TypeError);
  });

  it("reads the account's activity and its open prompts, and answers one", async () => {
    await signInForTest(fetchStub);
    const page = { items: [], nextCursor: 'next-1' };
    fetchStub.on('GET /api/account/activity', () => ok(page));
    fetchStub.on('GET /api/account/security-prompts', () => ok({ items: [PROMPT] }));
    fetchStub.on('POST /api/account/security-prompts/:id/answer', () =>
      ok({ ...PROMPT, answer: 'not_me' }),
    );

    await expect(auditTransport.activity({ limit: 20 })).resolves.toEqual(page);
    await expect(auditTransport.activity({ cursor: 'next-1', limit: 20 })).resolves.toEqual(page);
    const urls = fetchStub.requests
      .map((request) => new URL(request.url))
      .filter((url) => url.pathname.endsWith('/activity'));
    expect(urls.map((url) => url.search)).toEqual(['?limit=20', '?cursor=next-1&limit=20']);
    await expect(auditTransport.securityPrompts()).resolves.toEqual([PROMPT]);
    await expect(auditTransport.answerPrompt(PROMPT.id, 'not_me')).resolves.toEqual({
      ...PROMPT,
      answer: 'not_me',
    });
    const answer = fetchStub.requests.find((request) => request.url.endsWith('/answer'));
    expect(await bodyOf(answer!)).toEqual({ answer: 'not_me' });
  });

  it("registers the phone's push token, unless the API has no push module", async () => {
    await signInForTest(fetchStub);
    await expect(auditTransport.registerPushToken(PHONE, 'ios')).resolves.toBe(true);
    await expect(auditTransport.unregisterPushToken(PHONE)).resolves.toBeUndefined();

    fetchStub.on('PUT /api/account/push-token', () => failure(404, 'Not found'));
    fetchStub.on('DELETE /api/account/push-token', () => failure(404, 'Not found'));
    await expect(auditTransport.registerPushToken(PHONE, 'ios')).resolves.toBe(false);
    await expect(auditTransport.unregisterPushToken(PHONE)).resolves.toBeUndefined();

    fetchStub.on('PUT /api/account/push-token', () => failure(503, 'Unavailable'));
    fetchStub.on('DELETE /api/account/push-token', () => failure(503, 'Unavailable'));
    await expect(auditTransport.registerPushToken(PHONE, 'ios')).rejects.toMatchObject({
      kind: 'server',
    });
    await expect(auditTransport.unregisterPushToken(PHONE)).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('reads Retry-After in seconds or as a date', () => {
    const at = Date.UTC(2026, 9, 17, 12, 0, 0);
    const with_ = (value: string) => new Response(null, { headers: { 'Retry-After': value } });
    expect(retryAfterOf(with_('30'), at)).toEqual({ retryAfterMs: 30_000 });
    expect(retryAfterOf(with_('Sat, 17 Oct 2026 12:00:10 GMT'), at)).toEqual({
      retryAfterMs: 10_000,
    });
    expect(retryAfterOf(with_('Sat, 17 Oct 2026 11:00:00 GMT'), at)).toEqual({ retryAfterMs: 0 });
    expect(retryAfterOf(with_('soon'), at)).toEqual({});
    expect(retryAfterOf(new Response(null), at)).toEqual({});
  });
});

describe('the wiring (audit.wiring.ts)', () => {
  it("sends the device's own events for the signed-in user, every request with its headers", async () => {
    await signInForTest(fetchStub);
    await audit.bindUser('user-member');
    recordRejectedLink();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await audit.flush();

    expect(await sentActions()).toEqual(['client.session.started', 'client.link.rejected']);
    const [first] = fetchStub.requests;
    expect(first?.headers.get('X-App-Platform')).toMatch(/^(ios|android)$/);
    expect(first?.headers.get('X-Device-Id')).toMatch(DEVICE_ID_PATTERN);
    expect(await audit.deviceId()).toBe(first?.headers.get('X-Device-Id'));
  });

  it("at sign-out, sends the queue and forgets the phone's push token, then signs out", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      status: 'granted',
    } as never);
    jest.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValueOnce({
      type: 'ios',
      data: 'device-token',
    });
    await signInForTest(fetchStub);
    await audit.bindUser('user-member');
    await audit.registerPushToken({ kind: 'expo', value: PHONE, platform: 'ios' });
    await registerPushToken(); // a device token (no EAS project): not one the API takes

    await signOut();
    expect(useSessionStore.getState()).toEqual({ status: 'signedOut', endedBy: 'user' });
    const forgotten = fetchStub.requests.find((request) => request.method === 'DELETE');
    expect(await bodyOf(forgotten!)).toEqual({ token: PHONE });
    expect(await sentActions()).toEqual(['client.session.started']);
  });

  it("hands the app's push tokens to the API, and logs what it could not send", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await signInForTest(fetchStub);
    await audit.bindUser('user-member');
    await pushTokenRegistrar.register({ kind: 'expo', value: PHONE, platform: 'android' });
    await pushTokenRegistrar.register({ kind: 'device', value: 'fcm-token', platform: 'android' });
    const registered = fetchStub.requests.find((request) => request.method === 'PUT');
    expect(await bodyOf(registered!)).toEqual({ token: PHONE, platform: 'android' });

    fetchStub.on('POST /api/audit/client-events', () => failure(404, 'Not found'));
    recordRejectedLink();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await audit.flush();
    if (__DEV__) {
      expect(log).toHaveBeenCalledWith(
        '[app] Push token not registered: the API takes Expo push tokens only',
        '',
      );
      expect(warn).toHaveBeenCalledWith(
        '[app] The API refused a batch of audit events: dropped',
        expect.objectContaining({ status: 404 }),
      );
    }
  });

  it('never fails a sign-in for a push token it could not read, and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(new Error('unavailable'));
    await expect(registerPushToken()).resolves.toBeUndefined();
    if (__DEV__) {
      expect(warn).toHaveBeenCalledWith('[app] Push token not registered', {
        error: 'Error: unavailable',
      });
    }
  });

  it('sends the queue on its triggers: every interval, back in the foreground, online again', async () => {
    const foreground: ((status: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      foreground.push(listener as (status: string) => void);
      return { remove: jest.fn() };
    });
    const fired: string[] = [];
    const stops = [
      auditTriggers.onForeground(() => fired.push('foreground')),
      auditTriggers.onOnline(() => fired.push('online')),
      auditTriggers.every(5, () => fired.push('interval')),
    ];
    const network = jest.mocked(Network.addNetworkStateListener).mock.calls.at(-1)?.[0];
    foreground.forEach((listener) => {
      listener('background');
      listener('active');
    });
    network?.({ isConnected: false, isInternetReachable: false });
    network?.({ isConnected: true, isInternetReachable: true });
    network?.({ isConnected: true, isInternetReachable: true });
    await new Promise((resolve) => setTimeout(resolve, 12));
    for (const stop of stops) stop();

    expect(fired.filter((what) => what !== 'interval')).toEqual(['foreground', 'online']);
    expect(fired).toContain('interval');
  });
});
