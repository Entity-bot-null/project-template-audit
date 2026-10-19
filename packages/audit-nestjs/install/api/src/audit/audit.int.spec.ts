import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../../test/app.js';
import { asUser, bearer, seedUser, signIn } from '../../test/auth.js';
import { envelopeOf } from '../../test/http.js';
import type { AuditConfig } from './audit-env.js';
import { AUDIT_CLOCK, AUDIT_CONFIG, AUDIT_PUSH, WEBHOOK_PATH } from './audit.constants.js';
import { AuditService } from './audit.service.js';
import { FakePushSender } from './audit.testing.js';
import { expoPushSender } from './audit.wiring.js';
import {
  type AuditEvent,
  bodyDigest,
  canonicalQuery,
  CONTRACT_VERSION,
  emailHmac,
  EventBatchSchema,
  newSecret,
  nodeRandomFill,
  parseSignatureHeader,
  parseTimestamp,
  secretKey,
  SIGNATURE_HEADERS,
  signWebhook,
  uuidv7,
  verifySignature,
} from './contract/index.js';
import { ForwarderService } from './forwarder.service.js';

// The connector wired into this project (audit.wiring.ts): its tables, its
// transport and its routes, against the test database and an Audit Hub of
// its own on a local port that verifies every signature like the real one.
// Created by `pnpm connector add` and never overwritten: this project's spec.

const KEY_ID = randomUUID();
const KEY_SECRET = newSecret();
const PSEUDONYM_KEY = newSecret();
const WEBHOOK_SECRET = newSecret();
const WRONG_PASSWORD = 'not-the-password-123';

const pseudonym = (email: string) => emailHmac(secretKey(PSEUDONYM_KEY), email);
const iso = (at: number) => new Date(at).toISOString();

function answer(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/**
 * Audit Hub as the connector meets it: each request's signature checked,
 * each event kept once (a second copy is answered as a duplicate). Down, it
 * drops every connection; with its answer lost, it keeps the events and
 * drops the connection before answering.
 */
class FakeHub {
  mode: 'up' | 'down' | 'answer lost' = 'up';
  readonly events = new Map<string, AuditEvent>();
  /** Every request it answered, as "METHOD /path". */
  readonly requests: string[] = [];
  /** Requests whose signature did not verify: none, ever. */
  readonly unsigned: string[] = [];
  activity: unknown = { items: [] };
  url = '';
  private readonly server = createServer((req, res) => {
    void this.handle(req, res);
  });

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${String(port)}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  reset(): void {
    this.mode = 'up';
    this.events.clear();
    this.requests.length = 0;
    this.unsigned.length = 0;
  }

  /** The events received, in their order. */
  received(): AuditEvent[] {
    return [...this.events.values()].sort((a, b) => a.sourceSeq - b.sourceSeq);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    if (this.mode === 'down') {
      req.socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '/', this.url);
    const text = Buffer.concat(chunks).toString('utf8');
    const body: unknown = text === '' ? undefined : JSON.parse(text);
    const line = `${req.method ?? ''} ${url.pathname}`;
    if (!this.signed(req, url, body)) {
      this.unsigned.push(line);
      answer(res, 401, { data: null, message: 'Invalid signature' });
      return;
    }
    this.requests.push(line);
    if (url.pathname === '/api/ingest/events') {
      const { events } = EventBatchSchema.parse(body);
      const results = events.map((event, index) => {
        const known = this.events.has(event.eventId);
        if (!known) this.events.set(event.eventId, event);
        return { index, status: known ? ('duplicate' as const) : ('accepted' as const) };
      });
      if (this.mode === 'answer lost') {
        req.socket.destroy();
        return;
      }
      const accepted = results.filter((result) => result.status === 'accepted').length;
      answer(res, 200, {
        data: { results, accepted, duplicates: results.length - accepted, rejected: 0 },
      });
      return;
    }
    if (url.pathname.endsWith('/activity')) {
      answer(res, 200, { data: this.activity });
      return;
    }
    // The catalog and the heartbeat: only their status is read.
    answer(res, 200, { data: {} });
  }

  private signed(req: IncomingMessage, url: URL, body: unknown): boolean {
    const header = (name: string): string | undefined => {
      const value = req.headers[name.toLowerCase()];
      return typeof value === 'string' ? value : undefined;
    };
    const timestamp = parseTimestamp(header(SIGNATURE_HEADERS.timestamp));
    const nonce = header(SIGNATURE_HEADERS.nonce);
    const digest = header(SIGNATURE_HEADERS.bodyDigest);
    if (
      timestamp === undefined ||
      nonce === undefined ||
      digest !== bodyDigest(body) ||
      header(SIGNATURE_HEADERS.keyId) !== KEY_ID
    ) {
      return false;
    }
    return verifySignature(
      [secretKey(KEY_SECRET)],
      {
        method: req.method ?? '',
        path: url.pathname,
        query: canonicalQuery(url.searchParams),
        timestamp,
        nonce,
        keyId: KEY_ID,
        bodyDigest: digest,
      },
      parseSignatureHeader(header(SIGNATURE_HEADERS.signature)),
    );
  }
}

describe('Audit Hub connector (integration)', () => {
  const hub = new FakeHub();
  // Expo's push service, in memory: the module's sender is specced on its own below.
  const pushes = new FakePushSender();
  let config: AuditConfig;
  let t: TestApp;
  let audit: AuditService;
  let forwarder: ForwarderService;
  // The connector's clock, moved on by the specs (pauses, retries); never
  // behind the database's.
  let now = Date.now();

  beforeAll(async () => {
    await hub.start();
    config = {
      hubUrl: hub.url,
      app: 'example-app',
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      pseudonymKey: PSEUDONYM_KEY,
      webhookSecrets: [WEBHOOK_SECRET],
      responseActions: ['revoke_sessions'],
      queueAlert: 1000,
      appVersion: 'test',
      push: { provider: 'expo', accessToken: undefined },
    };
    t = await createTestApp((builder) =>
      builder
        .overrideProvider(AUDIT_CONFIG)
        .useValue(config)
        .overrideProvider(AUDIT_CLOCK)
        .useValue(() => now)
        .overrideProvider(AUDIT_PUSH)
        .useValue(pushes),
    );
    audit = t.app.get(AuditService);
    forwarder = t.app.get(ForwarderService);
    // The specs run each round themselves: no timer races them.
    forwarder.onModuleDestroy();
  });

  afterAll(async () => {
    await t.app.close();
    await hub.stop();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    hub.reset();
    pushes.sent.length = 0;
    // Past any pause an earlier spec left.
    now = Math.max(now, Date.now()) + 60 * 60_000;
  });

  afterEach(() => {
    expect(hub.unsigned).toEqual([]);
  });

  function webhook(type: string, data: unknown) {
    return { id: randomUUID(), type, createdAt: iso(now), contractVersion: CONTRACT_VERSION, data };
  }

  function deliver(body: { id: string }, secret = WEBHOOK_SECRET) {
    const headers = signWebhook({
      keys: [secretKey(secret)],
      appSlug: config.app,
      deliveryId: body.id,
      path: WEBHOOK_PATH,
      body,
      now,
    });
    return request(t.server).post(WEBHOOK_PATH).set(headers).send(body);
  }

  it('sends an event once its transaction commits, with the state before the change', async () => {
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });
    const changeEmail = (to: string, rollBack: boolean) =>
      t.prisma.$transaction(async (tx) => {
        const before = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { email: true },
        });
        const after = await tx.user.update({
          where: { id: user.id },
          data: { email: to },
          select: { email: true },
        });
        await audit.record(tx, {
          action: 'account.email.changed',
          actor: { type: 'user', id: user.id },
          resource: { type: 'user', id: user.id },
          change: audit.change(
            'account.email.changed',
            { emailHmac: audit.emailPseudonym(before.email) },
            { emailHmac: audit.emailPseudonym(after.email) },
          ),
        });
        if (rollBack) throw new Error('rolled back');
      });

    await expect(changeEmail('mallory@example.com', true)).rejects.toThrow('rolled back');
    expect(await t.prisma.auditOutbox.count()).toBe(0);
    await changeEmail('ana@new.example.com', false);
    await forwarder.tick();

    expect(hub.received().map((event) => [event.action, event.change])).toEqual([
      [
        'account.email.changed',
        {
          before: { emailHmac: pseudonym('ana@example.com') },
          after: { emailHmac: pseudonym('ana@new.example.com') },
          changedFields: ['emailHmac'],
        },
      ],
    ]);
    expect(await t.prisma.auditOutbox.count()).toBe(0);
  });

  it("records the template's flows with the request they came with", async () => {
    await seedUser(t.prisma, { email: 'ana@example.com' });
    const failSignIn = (email: string) =>
      request(t.server).post('/api/auth/sign-in').send({ email, password: WRONG_PASSWORD });

    await failSignIn('nobody@example.com').expect(401);
    await failSignIn('ana@example.com').expect(401);
    const session = await signIn(t.server, 'ana@example.com');
    await request(t.server)
      .post('/api/auth/logout')
      .set('Cookie', session.refreshCookie)
      .expect(204);
    await forwarder.tick();

    const events = hub.received();
    expect(events.map((event) => [event.action, event.outcome, event.actor.type])).toEqual([
      ['auth.session.sign_in_failed', 'failure', 'anonymous'],
      ['auth.session.sign_in_failed', 'failure', 'user'],
      ['auth.session.signed_in', 'success', 'user'],
      ['auth.session.signed_out', 'success', 'user'],
    ]);
    expect(events[0]?.actor).toMatchObject({ emailHmac: pseudonym('nobody@example.com') });
    expect(events[2]?.details).toEqual({ method: 'password' });
    // Numbered without gaps, in the order they committed.
    expect(events.map((event) => event.sourceSeq)).toEqual([1, 2, 3, 4]);
    for (const event of events) {
      expect(event.network?.ip).toBe('127.0.0.1');
      expect(event.request?.method).toBe('POST');
    }
    expect(events.map((event) => event.request?.route)).toEqual([
      '/api/auth/sign-in',
      '/api/auth/sign-in',
      '/api/auth/sign-in',
      '/api/auth/logout',
    ]);
  });

  it('takes the address through TRUST_PROXY: a forged X-Forwarded-For changes nothing', async () => {
    const failSignIn = (forwardedFor: string) =>
      request(t.server)
        .post('/api/auth/sign-in')
        .set('X-Forwarded-For', forwardedFor)
        .send({ email: 'nobody@example.com', password: WRONG_PASSWORD })
        .expect(401);
    try {
      // Behind one proxy (TRUST_PROXY=1): the client's own entries come
      // first, the proxy appends the address it saw.
      t.app.set('trust proxy', 1);
      await failSignIn('203.0.113.66, 198.51.100.7');
      // Trusting no proxy: the header counts for nothing.
      t.app.set('trust proxy', false);
      await failSignIn('203.0.113.66');
    } finally {
      t.app.set('trust proxy', 'loopback');
    }
    await forwarder.tick();

    expect(hub.received().map((event) => event.network?.ip)).toEqual(['198.51.100.7', '127.0.0.1']);
  });

  it('keeps the events while Audit Hub is down, and delivers each once when it is back', async () => {
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });
    hub.mode = 'down';
    for (let index = 0; index < 3; index += 1) {
      await audit.recordAlone({
        action: 'auth.session.signed_out',
        actor: { type: 'user', id: user.id },
      });
    }

    await forwarder.tick();
    expect(hub.events.size).toBe(0);
    expect(await t.prisma.auditOutbox.count()).toBe(3);
    // What the queue's gauges report (app_audit_outbox_*).
    expect(forwarder.stats.size).toBe(3);

    // Received, but the answer never arrives: sent again, answered as duplicates.
    hub.mode = 'answer lost';
    now += 60_000;
    await forwarder.tick();
    expect(hub.events.size).toBe(3);
    expect(await t.prisma.auditOutbox.count()).toBe(3);

    hub.mode = 'up';
    now += 60_000;
    await forwarder.tick();
    expect(hub.received().map((event) => event.sourceSeq)).toEqual([1, 2, 3]);
    expect(hub.requests.filter((line) => line === 'POST /api/ingest/events')).toHaveLength(2);
    expect(await t.prisma.auditOutbox.count()).toBe(0);
    expect(forwarder.stats).toEqual({ size: 0, oldestAgeSeconds: 0, retrying: 0 });
  });

  it('asks "Was it you?" on a suspicious sign-in, and ends the sessions on "not me"', async () => {
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });
    const session = await signIn(t.server, 'ana@example.com');
    // Her phone, registered by the app after its sign-in.
    await request(t.server)
      .put('/api/account/push-token')
      .set(bearer(session.accessToken))
      .send({ token: 'ExponentPushToken[phone-of-ana]', platform: 'ios' })
      .expect(204);
    const delivery = webhook('security.sign_in_suspicious', {
      subject: user.id,
      eventId: uuidv7(nodeRandomFill, now),
      occurredAt: iso(now),
      signals: ['new_country'],
      context: { country: 'PT' },
    });

    expect(envelopeOf(await deliver(delivery).expect(200)).data).toEqual({
      status: 'accepted',
    });
    // Delivered again: handled once.
    await deliver(delivery).expect(200);
    await deliver(delivery, newSecret()).expect(401);

    const open = await request(t.server)
      .get('/api/account/security-prompts')
      .set(bearer(session.accessToken))
      .expect(200);
    const { items } = envelopeOf<{ items: { id: string; signals: string[] }[] }>(open).data;
    expect(items.map((prompt) => prompt.signals)).toEqual([['new_country']]);
    // Pushed once to her phone, opening the prompt's screen (the second delivery is a duplicate).
    expect(pushes.sent).toEqual([
      {
        tokens: ['ExponentPushToken[phone-of-ana]'],
        message: expect.objectContaining({
          url: `/security/prompts/${items[0]?.id ?? ''}`,
        }) as unknown,
      },
    ]);
    await request(t.server)
      .post(`/api/account/security-prompts/${items[0]?.id ?? ''}/answer`)
      .set(bearer(session.accessToken))
      .send({ answer: 'not_me' })
      .expect(200);

    await request(t.server)
      .post('/api/auth/refresh')
      .set('Cookie', session.refreshCookie)
      .expect(401);
    await forwarder.tick();
    expect(
      hub.received().find((event) => event.action === 'account.security_prompt.answered'),
    ).toMatchObject({ actor: { type: 'user', id: user.id }, details: { answer: 'not_me' } });
  });

  it('runs a response action Audit Hub asks for, and records how it went', async () => {
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });
    const session = await signIn(t.server, 'ana@example.com');
    const actionId = randomUUID();
    const delivery = webhook('response_action.requested', {
      actionId,
      action: 'revoke_sessions',
      subject: user.id,
      reason: 'Many failed sign-ins from one address',
      requestedAt: iso(now),
      expiresAt: iso(now + 60 * 60_000),
    });

    expect(envelopeOf(await deliver(delivery).expect(200)).data).toEqual({
      status: 'accepted',
    });

    await request(t.server)
      .post('/api/auth/refresh')
      .set('Cookie', session.refreshCookie)
      .expect(401);
    const account = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(account.securityVersion).toBe(1);
    await forwarder.tick();
    expect(
      hub.received().find((event) => event.action === 'audit.response_action.executed'),
    ).toMatchObject({
      outcome: 'success',
      actor: { type: 'service', id: 'audit-hub' },
      resource: { type: 'user', id: user.id },
      details: { actionId, action: 'revoke_sessions', result: 'succeeded' },
    });
  });

  it("forwards the apps' own events with the server's actor and address", async () => {
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });
    const event = {
      eventId: uuidv7(nodeRandomFill, now),
      occurredAt: iso(now),
      action: 'client.session.expired',
      outcome: 'success',
      client: { type: 'web', appVersion: '1.0.0' },
    };

    const res = await request(t.server)
      .post('/api/audit/client-events')
      .set(asUser(t.app, user.id))
      .send({ events: [event] })
      .expect(200);
    expect(envelopeOf(res).data).toEqual({
      results: [{ eventId: event.eventId, status: 'accepted' }],
    });
    await forwarder.tick();

    expect(hub.received()).toMatchObject([
      {
        eventId: event.eventId,
        action: 'client.session.expired',
        actor: { type: 'user', id: user.id },
        network: { ip: '127.0.0.1' },
      },
    ]);
  });

  it("shows the account's own activity from Audit Hub", async () => {
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });
    hub.activity = {
      items: [
        {
          eventId: uuidv7(nodeRandomFill, now),
          action: 'auth.session.signed_in',
          description: 'Signed in',
          outcome: 'success',
          occurredAt: iso(now),
        },
      ],
    };

    const res = await request(t.server)
      .get('/api/account/activity?limit=5')
      .set(asUser(t.app, user.id))
      .expect(200);

    expect(envelopeOf(res).data).toEqual(hub.activity);
    expect(hub.requests).toEqual([`GET /api/connector/subjects/${user.id}/activity`]);
  });

  it("registers a phone's push token, gives it to the next account signed in on it, forgets it", async () => {
    const ana = await seedUser(t.prisma, { email: 'ana@example.com' });
    const luis = await seedUser(t.prisma, { email: 'luis@example.com' });
    const token = 'ExponentPushToken[shared-phone]';
    const put = (id: string) =>
      request(t.server).put('/api/account/push-token').set(asUser(t.app, id));
    const remove = (id: string) =>
      request(t.server).delete('/api/account/push-token').set(asUser(t.app, id));
    const owner = async () =>
      (await t.prisma.auditPushToken.findUnique({ where: { token } }))?.userId ?? null;

    await put(ana.id).send({ token, platform: 'android' }).expect(204);
    expect(await owner()).toBe(ana.id);
    await put(luis.id).send({ token, platform: 'android' }).expect(204);
    expect(await owner()).toBe(luis.id);
    // Not hers any more: her sign-out leaves it to him.
    await remove(ana.id).send({ token }).expect(204);
    expect(await owner()).toBe(luis.id);
    await remove(luis.id).send({ token }).expect(204);
    expect(await owner()).toBeNull();

    await put(ana.id).send({ token: 'a-device-token', platform: 'ios' }).expect(400);
    await request(t.server)
      .put('/api/account/push-token')
      .send({ token, platform: 'ios' })
      .expect(401);
  });

  it('sends a signed heartbeat and sweeps what it keeps', async () => {
    await forwarder.beat();
    expect(hub.requests).toEqual(['POST /api/ingest/heartbeat']);
  });
});

describe('Audit Hub connector, off (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('answers 404 on its routes and queues nothing without the AUDIT_HUB_* variables', async () => {
    await resetDatabase(t.prisma);
    const user = await seedUser(t.prisma, { email: 'ana@example.com' });

    await request(t.server).post(WEBHOOK_PATH).send({}).expect(404);
    await request(t.server)
      .put('/api/account/push-token')
      .set(asUser(t.app, user.id))
      .send({ token: 'ExponentPushToken[phone-of-ana]', platform: 'ios' })
      .expect(404);
    await request(t.server)
      .get('/api/account/security-prompts')
      .set(asUser(t.app, user.id))
      .expect(404);
    await request(t.server)
      .post('/api/auth/sign-in')
      .send({ email: 'ana@example.com', password: WRONG_PASSWORD })
      .expect(401);
    await signIn(t.server, 'ana@example.com');

    expect(await t.prisma.auditOutbox.count()).toBe(0);
  });
});

describe("Expo's push sender (audit.wiring.ts)", () => {
  /** Expo's push service, answering one ticket a message, as `tickets` says. */
  function expo(tickets: unknown) {
    const calls: { url: string; init: RequestInit | undefined; body: string }[] = [];
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url: input instanceof Request ? input.url : String(input), init, body });
      return Promise.resolve(
        new Response(JSON.stringify(tickets), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  const message = { title: 'Was it you?', body: 'Open the app.', url: '/security/prompts/1' };

  it('sends a message a token on the security channel, and answers the tokens it no longer knows', async () => {
    const { calls, fetchImpl } = expo({
      data: [
        { status: 'ok', id: 'ticket-a' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } },
      ],
    });
    const tokens = ['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]'];

    const answer = await expoPushSender('expo-access-token', fetchImpl).send(tokens, message);

    expect(answer).toEqual({ unregistered: ['ExponentPushToken[b]'] });
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['https://exp.host/--/api/v2/push/send', 'POST'],
    ]);
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(
      'Bearer expo-access-token',
    );
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual(
      tokens.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: { url: message.url },
        channelId: 'security',
        priority: 'high',
        sound: 'default',
      })),
    );
  });

  it('sends no credentials without an access token, and refuses an answer it cannot read', async () => {
    const plain = expo({ data: [{ status: 'ok', id: 'ticket-a' }] });
    await expect(
      expoPushSender(undefined, plain.fetchImpl).send(['ExponentPushToken[a]'], message),
    ).resolves.toEqual({ unregistered: [] });
    expect(new Headers(plain.calls[0]?.init?.headers).has('authorization')).toBe(false);

    const odd = expo({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] });
    await expect(
      expoPushSender(undefined, odd.fetchImpl).send(['ExponentPushToken[a]'], message),
    ).rejects.toThrow();
  });
});
