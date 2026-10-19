import {
  FLUSH_INTERVAL_MS,
  MAX_ATTEMPTS,
  PAUSE_FIRST_MS,
  PAUSE_MAX_MS,
  SDK,
} from './audit.constants';
import type { SendResult, SqlDatabase } from './audit.ports';
import {
  countingRandom,
  FakeTransport,
  ManualTriggers,
  memoryDatabase,
  memoryInstallation,
  NOW,
  RecordingLogger,
  testClient,
  testDevice,
} from './audit.testing';
import { AuditEventError, createAuditClient } from './audit-client';
import { openAuditQueue } from './queue';
import { ClientEventBatchSchema, DEVICE_ID_PATTERN, isUuidv7, LIMITS } from './contract';

const ANA = 'user-ana';
const LUIS = 'user-luis';
const LINK = { action: 'client.link.rejected' };
const PHONE = {
  kind: 'expo',
  value: 'ExponentPushToken[phone-of-ana-1]',
  platform: 'ios',
} as const;

type Harness = ReturnType<typeof testClient>;

/** Signed in as `userId`, the sign-in's own event sent and forgotten. */
async function signIn(t: Harness, userId = ANA): Promise<void> {
  await t.client.bindUser(userId);
  await t.client.flush();
  t.transport.batches.length = 0;
}

/** Records `count` events a second apart. */
async function recordMany(t: Harness, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    t.clock.now += 1_000;
    await t.client.record(LINK);
  }
}

const unreachable = (): SendResult => ({ kind: 'unreachable' });
const NOW_ISO = new Date(NOW).toISOString();
const queued = (t: Harness, userId = ANA) => t.queue.next(userId, 10_000);

describe('the audit client', () => {
  it("sends the device's own events for the signed-in user, with the phone's context", async () => {
    const t = testClient();
    await t.client.bindUser(ANA);
    await t.client.flush();
    t.clock.now += 1_000;
    await t.client.record({ ...LINK, route: '/(app)/settings', outcome: 'denied' });
    await t.client.flush();

    expect(t.transport.actions()).toEqual(['client.session.started', 'client.link.rejected']);
    for (const batch of t.transport.batches) {
      expect(ClientEventBatchSchema.safeParse(batch).success).toBe(true);
    }
    const event = t.transport.batches.flatMap((batch) => batch.events)[1];
    expect(isUuidv7(event?.eventId)).toBe(true);
    expect(event).toEqual({
      eventId: event?.eventId,
      occurredAt: new Date(NOW + 1_000).toISOString(),
      action: 'client.link.rejected',
      outcome: 'denied',
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
        sdk: { name: SDK.name, version: SDK.version },
      },
    });
    expect(await queued(t)).toEqual([]);
  });

  it('says what the event is about, and leaves out what the phone cannot tell', async () => {
    const t = testClient({
      device: { ...testDevice(), networkType: () => Promise.reject(new Error('no permission')) },
    });
    await signIn(t);
    await t.client.record({ ...LINK, resource: { type: 'item', id: '42' } });
    await t.client.flush();
    const [event] = t.transport.batches[0]?.events ?? [];
    expect(event?.resource).toEqual({ type: 'item', id: '42' });
    expect(event?.client.networkType).toBeUndefined();
  });

  it('runs on the real clock and timer when it is given none', async () => {
    const transport = new FakeTransport();
    const client = createAuditClient({
      transport,
      queue: openAuditQueue(() => Promise.resolve(memoryDatabase())),
      installation: memoryInstallation('install-0001'),
      device: testDevice(),
      triggers: new ManualTriggers(),
      logger: new RecordingLogger(),
      random: countingRandom(),
      signedIn: () => true,
    });
    const before = Date.now();
    await client.bindUser(ANA);
    await client.beforeSignOut();
    const [event] = transport.batches[0]?.events ?? [];
    expect(Date.parse(event?.occurredAt ?? '')).toBeGreaterThanOrEqual(before);
    expect(transport.actions()).toEqual(['client.session.started']);
  });

  it('records nothing of a session whose clock cannot be trusted, and goes on', async () => {
    const t = testClient();
    t.clock.now = Number.NaN; // a clock that says nothing: no event id can carry it
    await t.client.bindUser(ANA);
    expect(t.logger.messages('warn')).toEqual(['Audit: recording the session failed']);
  });

  it('takes the user at once: a push token registered right after a sign-in is theirs', async () => {
    const t = testClient();
    const binding = t.client.bindUser(ANA);
    await t.client.registerPushToken(PHONE);
    await binding;
    expect([...t.transport.pushTokens.keys()]).toEqual([PHONE.value]);
  });

  it('binds the same user twice without dropping anything', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 1);
    await t.client.bindUser(ANA); // useMe, after the sign-in already bound them
    expect((await queued(t)).length).toBe(1);
  });

  it('queues nothing signed out, and sends nothing until the session is signed in', async () => {
    const t = testClient();
    await t.client.record(LINK);
    await t.client.flush();
    expect(t.transport.batches).toEqual([]);

    t.clock.signedIn = false; // a restored session, still renewing
    await t.client.bindUser(ANA);
    await t.client.record(LINK);
    await t.client.flush();
    expect(t.transport.batches).toEqual([]);
    expect((await queued(t)).length).toBe(2);

    t.clock.signedIn = true;
    await t.client.flush();
    expect(t.transport.actions()).toEqual(['client.session.started', 'client.link.rejected']);
  });

  it('refuses an event the contract does not allow, and queues nothing of it', async () => {
    const t = testClient();
    await signIn(t);
    for (const input of [
      { action: 'Link Rejected' },
      { ...LINK, reason: 'Not A Code' },
      { ...LINK, route: '/items/42?tab=details' },
      { ...LINK, details: { note: 'x'.repeat(9_000) } },
    ]) {
      await expect(t.client.record(input)).rejects.toThrow(AuditEventError);
    }
    expect(await queued(t)).toEqual([]);
  });

  it("picks up a restored session's queue after the app restarts", async () => {
    const database = memoryDatabase();
    const before = testClient({ database });
    before.transport.answer = unreachable;
    await before.client.bindUser(ANA);
    await before.client.record(LINK);

    const after = testClient({ database });
    await after.client.flush();
    expect(after.transport.actions()).toEqual(['client.session.started', 'client.link.rejected']);
  });

  it('keeps the events while offline, counting no attempt, and sends them when back', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 2);
    await t.client.flush();
    expect((await queued(t)).map((row) => row.attempts)).toEqual([0, 0]);

    t.transport.answer = new FakeTransport().answer;
    await t.client.flush();
    expect(await queued(t)).toEqual([]);
    expect(t.transport.batches.at(-1)?.events.length).toBe(2);
  });

  it('waits after the API failed, longer each time, and drops what it keeps failing on', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = () => ({ kind: 'later', status: 503 });
    await t.client.record(LINK);

    await t.client.flush();
    await t.client.flush(); // paused: no second request
    expect(t.transport.batches.length).toBe(1);
    t.clock.now += PAUSE_FIRST_MS * 0.7;
    await t.client.flush();
    expect(t.transport.batches.length).toBe(1);
    t.clock.now += PAUSE_FIRST_MS * 0.6;
    await t.client.flush();
    expect(t.transport.batches.length).toBe(2);
    t.clock.now += PAUSE_FIRST_MS * 1.3; // the second pause is twice as long
    await t.client.flush();
    expect(t.transport.batches.length).toBe(2);

    for (let attempt = 2; attempt < MAX_ATTEMPTS; attempt += 1) {
      t.clock.now += PAUSE_MAX_MS * 1.2;
      await t.client.flush();
    }
    expect(t.transport.batches.length).toBe(MAX_ATTEMPTS);
    expect(await queued(t)).toEqual([]);
    expect(t.logger.messages('warn')).toEqual([
      'Audit events the API kept failing on were dropped',
    ]);

    // Answered again: the next failure waits from the start.
    t.transport.answer = new FakeTransport().answer;
    await t.client.record(LINK);
    t.clock.now += PAUSE_MAX_MS * 1.2;
    await t.client.flush();
    t.transport.answer = () => ({ kind: 'later', status: 500 });
    await t.client.record(LINK);
    await t.client.flush();
    t.clock.now += PAUSE_FIRST_MS * 1.3;
    await t.client.flush();
    expect(t.transport.batches.length).toBe(MAX_ATTEMPTS + 3);
  });

  it("waits for a 429's Retry-After without counting attempts, and never waits for a 401", async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = () => ({ kind: 'later', status: 429, retryAfterMs: 5_000 });
    await t.client.record(LINK);
    await t.client.flush();
    await t.client.flush();
    expect(t.transport.batches.length).toBe(1);
    t.clock.now += 5_000;
    await t.client.flush();
    expect(t.transport.batches.length).toBe(2);

    // The session the batch went with ended: not the events' fault.
    t.transport.answer = () => ({ kind: 'later', status: 401 });
    t.clock.now += 5_000;
    await t.client.flush();
    await t.client.flush();
    expect(t.transport.batches.length).toBe(4);
    expect((await queued(t)).map((row) => row.attempts)).toEqual([0]);
  });

  it('drops a batch the API refuses (404 while its connector is off), and goes on', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, LIMITS.clientBatchEvents + 5);
    t.transport.answer = () => ({ kind: 'refused', status: 404 });
    await t.client.flush();

    expect(t.transport.batches.slice(-2).map((batch) => batch.events.length)).toEqual([50, 5]);
    expect(await queued(t)).toEqual([]);
    expect(t.logger.lines.filter((line) => line.level === 'warn')).toEqual([
      {
        level: 'warn',
        message: 'The API refused a batch of audit events: dropped',
        data: { status: 404, count: 50 },
      },
      {
        level: 'warn',
        message: 'The API refused a batch of audit events: dropped',
        data: { status: 404, count: 5 },
      },
    ]);
  });

  it('reports what it dropped a thousand at a time, and ignores a count it cannot read', async () => {
    const t = testClient();
    await signIn(t);
    await t.queue.setMeta('discarded', '1200');
    await t.client.record(LINK);
    await t.client.flush();
    await t.client.record(LINK);
    await t.client.flush();
    await t.queue.setMeta('discarded', 'many');
    await t.client.record(LINK);
    await t.client.flush();
    expect(t.transport.batches.map((batch) => batch.discardedAtSignOut)).toEqual([
      1000,
      200,
      undefined,
    ]);
  });

  it('forgets what the API answered for, logs what it refused, and tries the missing again', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 3);
    const [first, second, third] = await queued(t);
    t.transport.answer = () => ({
      kind: 'answered',
      results: [
        { eventId: first?.eventId ?? '', status: 'duplicate' },
        { eventId: second?.eventId ?? '', status: 'rejected', reason: 'action_not_allowed' },
      ],
    });
    await t.client.flush();

    expect(await queued(t)).toEqual([{ ...third, attempts: 1 }]);
    t.transport.answer = (batch) => ({
      kind: 'answered',
      results: batch.events.map((event) => ({ eventId: event.eventId, status: 'rejected' })),
    });
    await t.client.flush();
    expect(t.logger.lines).toEqual([
      {
        level: 'warn',
        message: 'The API refused an audit event',
        data: { action: 'client.link.rejected', reason: 'action_not_allowed' },
      },
      {
        level: 'warn',
        message: 'The API refused an audit event',
        data: { action: 'client.link.rejected', reason: 'none' },
      },
    ]);
  });

  it('sends at most 50 events a request, oldest first, and splits large ones by size', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 120);
    t.transport.batches.length = 0;
    t.transport.answer = new FakeTransport().answer;
    await t.client.flush();
    expect(t.transport.batches.map((batch) => batch.events.length)).toEqual([50, 50, 20]);
    const times = t.transport.batches.flatMap((batch) => batch.events.map((e) => e.occurredAt));
    expect(times).toEqual([...times].sort());

    t.transport.answer = unreachable;
    for (let index = 0; index < 10; index += 1) {
      t.clock.now += 1_000;
      await t.client.record({ ...LINK, details: { note: 'x'.repeat(7_000) } });
    }
    t.transport.batches.length = 0;
    t.transport.answer = new FakeTransport().answer;
    await t.client.flush();
    expect(t.transport.batches.map((batch) => batch.events.length)).toEqual([8, 2]);
  });

  it("never sends one user's events as another's, and reports how many it dropped", async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 2);

    t.transport.answer = new FakeTransport().answer;
    await t.client.bindUser(LUIS);
    await t.client.flush();
    expect(t.transport.batches).toEqual([
      {
        events: [expect.objectContaining({ action: 'client.session.started' })],
        discardedAtSignOut: 2,
      },
    ]);
    await t.client.record(LINK);
    await t.client.flush();
    expect(t.transport.batches[1]?.discardedAtSignOut).toBeUndefined();
  });

  it('at sign-out, sends the queue and forgets the push token, then nothing more', async () => {
    const t = testClient();
    await signIn(t);
    await t.client.registerPushToken(PHONE);
    await recordMany(t, 2);
    t.transport.batches.length = 0;
    t.transport.answer = (batch) =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(new FakeTransport().answer(batch));
        }, 1);
      });

    await t.client.beforeSignOut();
    expect(t.transport.actions()).toEqual(['client.link.rejected', 'client.link.rejected']);
    expect(t.transport.unregistered).toEqual([PHONE.value]);
    expect(await t.queue.meta('user')).toBeNull();

    await t.client.record(LINK);
    await t.client.flush();
    expect(t.transport.batches.length).toBe(1);
    await t.client.beforeSignOut(); // signed out already: nothing to do
  });

  it('gives up after three seconds at sign-out, and discards what is left', async () => {
    const t = testClient();
    await signIn(t);
    await recordMany(t, 2);
    let answer: (result: SendResult) => void = () => undefined;
    t.transport.answer = () =>
      new Promise((resolve) => {
        answer = resolve;
      });

    const signingOut = t.client.beforeSignOut();
    await new Promise((resolve) => setTimeout(resolve, 5));
    t.expire();
    await signingOut;
    expect(await queued(t)).toEqual([]);
    answer({ kind: 'unreachable' }); // the app's timeout ends the request
    await t.client.flush();

    t.transport.answer = new FakeTransport().answer;
    await t.client.bindUser(LUIS);
    await t.client.flush();
    expect(t.transport.batches.at(-1)?.discardedAtSignOut).toBe(2);
  });

  it("keeps an expired session's events for the same user only", async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 1);
    await t.client.sessionEnded('expired');
    await t.client.record(LINK); // signed out now: dropped
    expect((await queued(t)).length).toBe(2);
    expect(await t.queue.meta('user')).toBeNull();

    t.transport.answer = new FakeTransport().answer;
    t.transport.batches.length = 0;
    await t.client.bindUser(ANA);
    await t.client.flush();
    expect(t.transport.actions()).toEqual([
      'client.link.rejected',
      'client.session.expired',
      'client.session.started',
    ]);
    expect(t.transport.batches[0]?.discardedAtSignOut).toBeUndefined();

    const other = testClient();
    await signIn(other);
    other.transport.answer = unreachable;
    await other.client.sessionEnded('expired');
    other.transport.answer = new FakeTransport().answer;
    await other.client.bindUser(LUIS);
    await other.client.flush();
    expect(other.transport.batches.at(-1)?.discardedAtSignOut).toBe(1);
  });

  it('stops sending at a sign-out it was not told of, and keeps the events', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 1);
    await t.client.sessionEnded('user');
    await t.client.sessionEnded(null);
    t.transport.answer = new FakeTransport().answer;
    await t.client.flush();
    expect((await queued(t)).length).toBe(1);
  });

  it('says where the phone is with each session, only with consent and a recent position', async () => {
    const position = {
      latitude: 19.43261,
      longitude: -99.13321,
      accuracyM: 20,
      capturedAt: NOW - 60_000,
    };
    const located = testClient({ position, consented: true });
    await located.client.bindUser(ANA);
    await located.client.flush();
    expect(located.transport.batches[0]?.events[0]?.location).toEqual({
      latitude: 19.43,
      longitude: -99.13,
      accuracyM: 1000,
      capturedAt: new Date(NOW - 60_000).toISOString(),
    });
    await located.client.record(LINK); // only when asked for
    await located.client.flush();
    expect(located.transport.batches[1]?.events[0]?.location).toBeUndefined();

    for (const options of [
      { position, consented: false },
      { position: null, consented: true },
      { position: { ...position, capturedAt: NOW - 3_600_000 }, consented: true },
      { position: new Error('location services off'), consented: true },
    ]) {
      const t = testClient(options);
      await t.client.bindUser(ANA);
      await t.client.flush();
      expect(t.transport.batches[0]?.events[0]?.location).toBeUndefined();
    }
    const failing = testClient({ position: new Error('location services off') });
    await failing.client.bindUser(ANA);
    expect(failing.logger.messages('warn')).toEqual(['Audit: reading the location failed']);
  });

  it('takes a fresh, precise position at the session start when the person allowed it', async () => {
    const lastKnown = {
      latitude: 19.4,
      longitude: -99.1,
      accuracyM: 900,
      capturedAt: NOW - 600_000,
    };
    const fresh = { latitude: 19.4326081, longitude: -99.1332093, accuracyM: 4.6, capturedAt: NOW };
    const precise = testClient({ position: lastKnown, current: fresh, precise: true });
    await precise.client.bindUser(ANA);
    await precise.client.flush();
    expect(precise.transport.batches[0]?.events[0]?.location).toEqual({
      latitude: 19.43261,
      longitude: -99.13321,
      accuracyM: 5,
      capturedAt: new Date(NOW).toISOString(),
    });
    // Approximate only: the last known position, rounded, never a fresh fix.
    const approximate = testClient({ position: lastKnown, current: fresh, precise: false });
    await approximate.client.bindUser(ANA);
    await approximate.client.flush();
    expect(approximate.transport.batches[0]?.events[0]?.location).toEqual({
      latitude: 19.4,
      longitude: -99.1,
      accuracyM: 1000,
      capturedAt: new Date(NOW - 600_000).toISOString(),
    });
    // Precise allowed, but no fresh fix to ask for: the last known one, kept precise.
    const noCurrent = testClient({ position: lastKnown, precise: true });
    await noCurrent.client.bindUser(ANA);
    await noCurrent.client.flush();
    expect(noCurrent.transport.batches[0]?.events[0]?.location).toMatchObject({
      latitude: 19.4,
      accuracyM: 900,
    });
    // No fix: no location.
    const none = testClient({ position: lastKnown, current: null, precise: true });
    await none.client.bindUser(ANA);
    await none.client.flush();
    expect(none.transport.batches[0]?.events[0]?.location).toBeUndefined();
  });

  it('records a session once per sign-in, not on each return to the foreground', async () => {
    const t = testClient();
    const stop = t.client.start();
    await t.client.bindUser(ANA);
    await t.client.flush();
    t.triggers.fire('foreground');
    await t.client.bindUser(ANA); // useMe, once the restored session knows who it is
    await t.client.flush();
    expect(t.transport.actions()).toEqual(['client.session.started']);

    await t.client.beforeSignOut();
    await t.client.bindUser(ANA);
    await t.client.flush();
    expect(t.transport.actions()).toEqual(['client.session.started', 'client.session.started']);
    stop();
  });

  it('sends every 30 seconds and when the network comes back, until stopped', async () => {
    const t = testClient();
    await signIn(t);
    const stop = t.client.start();
    await t.client.flush();

    await t.client.record(LINK);
    t.triggers.tick(FLUSH_INTERVAL_MS);
    await t.client.flush();
    await t.client.record(LINK);
    t.triggers.fire('online');
    await t.client.flush();
    expect(t.transport.batches.map((batch) => batch.events.length)).toEqual([1, 1]);

    stop();
    expect(t.triggers.active).toBe(0);
  });

  it('drops its oldest events once it holds a thousand', async () => {
    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, LIMITS.clientQueueEvents + 1);
    expect((await queued(t)).length).toBe(LIMITS.clientQueueEvents);
    expect(t.logger.lines).toEqual([
      {
        level: 'warn',
        message: 'Audit queue full: its oldest events were dropped',
        data: { dropped: 1 },
      },
    ]);
  });

  it('drops a stored event it cannot read back', async () => {
    const only = testClient();
    await signIn(only);
    await only.queue.add({ eventId: 'bad', userRef: ANA, occurredAt: NOW_ISO, payload: '[]' });
    await only.client.flush();
    expect(only.transport.batches).toEqual([]);
    expect(await queued(only)).toEqual([]);

    const t = testClient();
    await signIn(t);
    t.transport.answer = unreachable;
    await recordMany(t, 1);
    for (const [id, payload] of [
      ['bad-1', 'not json'],
      ['bad-2', '{"eventId":"bad-2"}'],
    ] as const) {
      await t.queue.add({
        eventId: id,
        userRef: ANA,
        occurredAt: '2026-10-17T11:00:00.000Z',
        payload,
      });
    }
    t.transport.answer = new FakeTransport().answer;
    await t.client.flush();
    expect(t.transport.actions()).toEqual(['client.link.rejected']);
    expect(await queued(t)).toEqual([]);
    expect(t.logger.messages('warn')).toEqual(['Audit queue: unreadable events dropped']);
  });

  it('gives this installation one random id, and every request its headers', async () => {
    const store = memoryInstallation();
    const t = testClient({ installation: store });
    const id = await t.client.deviceId();
    expect(DEVICE_ID_PATTERN.test(id)).toBe(true);
    expect(store.id).toBe(id);
    expect(await testClient({ installation: store }).client.deviceId()).toBe(id);
    expect(await t.client.requestHeaders()).toEqual({
      'X-App-Platform': 'android',
      'X-App-Version': '1.4.2',
      'X-App-Build': '42',
      'X-Device-Id': id,
    });

    store.id = 'not valid!';
    expect(await testClient({ installation: store }).client.deviceId()).not.toBe('not valid!');

    const broken = testClient({
      installation: {
        get: () => Promise.reject(new Error('unreadable')),
        set: () => Promise.reject(new Error('read-only')),
      },
    });
    expect(DEVICE_ID_PATTERN.test(await broken.client.deviceId())).toBe(true);
    expect(broken.logger.messages('warn')).toEqual([
      'Audit: reading the installation id failed',
      'Audit: saving the installation id failed',
    ]);
  });

  it("registers the phone's Expo push token for the signed-in user only", async () => {
    const t = testClient();
    await t.client.registerPushToken(PHONE); // signed out
    expect(t.transport.pushTokens.size).toBe(0);

    await signIn(t);
    await t.client.registerPushToken({ ...PHONE, kind: 'device', value: 'a1b2c3' });
    await t.client.registerPushToken(PHONE);
    expect([...t.transport.pushTokens]).toEqual([[PHONE.value, 'ios']]);
    expect(await t.queue.meta('push_token')).toBe(PHONE.value);
    expect(t.logger.messages('info')).toEqual([
      'Push token not registered: the API takes Expo push tokens only',
    ]);

    const off = testClient();
    off.transport.pushModule = false;
    await signIn(off);
    await off.client.registerPushToken(PHONE);
    await off.client.beforeSignOut();
    expect(off.transport.unregistered).toEqual([]);

    const failing = testClient();
    failing.transport.registerPushToken = () => Promise.reject(new Error('offline'));
    await signIn(failing);
    await failing.client.registerPushToken(PHONE);
    expect(failing.logger.messages('warn')).toEqual(['Audit: registering the push token failed']);
  });

  it('sends one request at a time', async () => {
    const t = testClient();
    await signIn(t);
    await t.client.record(LINK);
    await Promise.all([t.client.flush(), t.client.flush()]);
    expect(t.transport.batches.length).toBe(1);
  });

  it('never stops the app when its storage or the API fails', async () => {
    const broken: SqlDatabase = {
      execAsync: () => Promise.reject(new Error('disk I/O error')),
      runAsync: () => Promise.reject(new Error('disk I/O error')),
      getAllAsync: () => Promise.reject(new Error('disk I/O error')),
      getFirstAsync: () => Promise.reject(new Error('disk I/O error')),
    };
    // A restart: whose queue it is cannot be read.
    const restarted = testClient({ database: broken });
    await restarted.client.flush();
    await restarted.client.registerPushToken(PHONE);
    await restarted.client.beforeSignOut();
    await restarted.client.sessionEnded('expired');
    expect(restarted.logger.messages('warn')).toEqual([
      'Audit: reading the queue failed',
      'Audit: registering the push token failed',
      'Audit: reading the queue failed',
      'Audit: ending the queue failed',
    ]);

    const t = testClient({ database: broken });
    await t.client.bindUser(ANA);
    await t.client.record(LINK);
    await t.client.flush();
    await t.client.registerPushToken(PHONE);
    await t.client.beforeSignOut();
    expect(t.transport.batches).toEqual([]);
    expect(new Set(t.logger.messages('warn'))).toEqual(
      new Set([
        'Audit: binding the queue failed',
        'Audit: queuing an event failed',
        'Audit: sending the queue failed',
        'Audit: registering the push token failed',
        'Audit: sending the queue at sign-out failed',
        'Audit: emptying the queue at sign-out failed',
      ]),
    );

    const flaky = testClient();
    await signIn(flaky);
    flaky.transport.answer = () => Promise.reject(new Error('bug'));
    await flaky.client.record(LINK);
    await flaky.client.flush();
    expect(flaky.logger.messages('warn')).toEqual(['Audit: sending the queue failed']);
  });
});
