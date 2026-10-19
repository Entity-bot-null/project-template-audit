import {
  FLUSH_INTERVAL_MS,
  MAX_ATTEMPTS,
  PAUSE_FIRST_MS,
  PAUSE_MAX_MS,
  SIGN_OUT_FLUSH_MS,
} from './audit.constants';
import type { AuditDependencies, QueuedRow, SendResult } from './audit.ports';
import {
  canonicalJsonBytes,
  CLIENT_ROUTE_PATTERN,
  type ClientEvent,
  type ClientEventBatch,
  ClientEventSchema,
  DEVICE_ID_PATTERN,
  EXPO_PUSH_TOKEN_PATTERN,
  LIMITS,
  type Outcome,
  type Resource,
  uuidv7,
} from './contract';
import { clientInfoOf, locationOf, newDeviceId, requestHeadersOf } from './device';

// The app's side of Audit Hub (docs/audit/connection-guide.md#the-mobile-app):
// what only the device can tell (a session that expired, a link it refused,
// where it is, with consent) is queued here per user and sent to the app's
// own API, which completes and forwards it. Offline, events wait in the
// queue; at sign-out they are sent for up to three seconds, then discarded:
// never sent with the next user's session.

/** One of the device's events, as a screen or a flow records it. */
export interface RecordInput {
  /** An action the API's catalog gives to clients (source "client" or "both"). */
  action: string;
  /** Default: success. */
  outcome?: Outcome;
  /** A code, for a failure or a denial. */
  reason?: string;
  resource?: Resource;
  /** Only the fields the action declares; never a secret, a token or a password. */
  details?: ClientEvent['details'];
  /** The screen's route pattern (/items/[id]), never a path with ids. */
  route?: string;
  /** Adds where the phone is, rounded, when the user consented to it. */
  withLocation?: boolean;
}

/** A call the contract refuses: a mistake in the app's code, which its tests catch. */
export class AuditEventError extends Error {
  override readonly name = 'AuditEventError';
}

/** The token expo-notifications gives (src/lib/notifications: PushToken). */
export interface PushTokenInput {
  kind: 'expo' | 'device';
  value: string;
  platform: 'ios' | 'android';
}

export interface AuditClient {
  /**
   * Queues one of the device's events for the signed-in user. Signed out, it
   * is dropped: nothing could send it. Rejects only for an invalid event
   * (AuditEventError); storage failures are logged.
   */
  record(input: RecordInput): Promise<void>;
  /** Who is signed in: after each sign-in, and once a restored session knows (useMe). */
  bindUser(userId: string): Promise<void>;
  /**
   * Before session.signOut(), while the token is still valid: sends the queue
   * and forgets the phone's push token for at most three seconds, then
   * discards what is left (reported in a later batch as discardedAtSignOut).
   */
  beforeSignOut(): Promise<void>;
  /** From session.onSignOut: an expiry is recorded, for the user's next session; nothing more is sent. */
  sessionEnded(endedBy: 'user' | 'expired' | null): Promise<void>;
  /** Sends the user's queue now; the triggers of start() call it too. */
  flush(): Promise<void>;
  /** Sends the queue every 30 s, on a return to the foreground and when the network comes back. */
  start(): () => void;
  /** This installation's random id (X-Device-Id). */
  deviceId(): Promise<string>;
  /** X-App-Version, X-App-Build, X-App-Platform and X-Device-Id, for every request to the API. */
  requestHeaders(): Promise<Record<string, string>>;
  /** The PushTokenRegistrar of src/lib/notifications: the phone's Expo push token, for the signed-in user. */
  registerPushToken(token: PushTokenInput): Promise<void>;
}

interface Pending {
  row: QueuedRow;
  event: ClientEvent;
}

/** Room for the batch's envelope (events array, discardedAtSignOut) within LIMITS.clientBatchBytes. */
const BATCH_OVERHEAD_BYTES = 256;

function defaultWait(ms: number): { done: Promise<void>; cancel: () => void } {
  let timer!: ReturnType<typeof setTimeout>;
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
    timer = setTimeout(resolve, ms);
  });
  return {
    done,
    cancel: () => {
      clearTimeout(timer);
      release();
    },
  };
}

/** A count the queue keeps as text; anything else reads as none. */
function countOf(value: string | null): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export function createAuditClient(deps: AuditDependencies): AuditClient {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? defaultWait;
  const { queue, transport, logger } = deps;
  /** The bound user; undefined until read from the queue (a restored session). */
  let user: string | null | undefined;
  let installation: Promise<string> | null = null;
  let flushing: Promise<void> | null = null;
  let pausedUntil = 0;
  let failures = 0;
  /** client.session.started is recorded once per binding of a user. */
  let sessionRecorded = false;

  const failed = (what: string, error: unknown) => {
    logger.warn(`Audit: ${what} failed`, { error: String(error) });
  };

  /** The bound user: in memory, else as the queue remembers it from before a restart. */
  async function currentUser(): Promise<string | null> {
    if (user !== undefined) return user;
    const stored = await queue.meta('user');
    user ??= stored;
    return user;
  }

  function installationId(): Promise<string> {
    installation ??= (async () => {
      const stored = await deps.installation.get().catch((error: unknown) => {
        failed('reading the installation id', error);
        return null;
      });
      if (stored !== null && DEVICE_ID_PATTERN.test(stored)) return stored;
      const id = newDeviceId(deps.random);
      await deps.installation.set(id).catch((error: unknown) => {
        failed('saving the installation id', error);
      });
      return id;
    })();
    return installation;
  }

  async function positionAt(at: number) {
    const location = deps.location;
    if (!location?.consented()) return undefined;
    try {
      const precise = (await location.precise?.()) === true;
      const position =
        precise && location.provider.current !== undefined
          ? await location.provider.current()
          : await location.provider.lastKnown();
      return position === null ? undefined : locationOf(position, at, precise);
    } catch (error) {
      failed('reading the location', error);
      return undefined;
    }
  }

  async function eventOf(input: RecordInput): Promise<ClientEvent> {
    if (input.route !== undefined && !CLIENT_ROUTE_PATTERN.test(input.route)) {
      throw new AuditEventError(`Invalid audit event ${input.action}: route`);
    }
    const at = now();
    const [deviceId, networkType, location] = await Promise.all([
      installationId(),
      deps.device.networkType().catch(() => null),
      input.withLocation === true ? positionAt(at) : Promise.resolve(undefined),
    ]);
    const parsed = ClientEventSchema.safeParse({
      eventId: uuidv7(deps.random, at),
      occurredAt: new Date(at).toISOString(),
      action: input.action,
      outcome: input.outcome ?? 'success',
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      client: clientInfoOf(deps.device.facts(), {
        deviceId,
        networkType,
        ...(input.route === undefined ? {} : { route: input.route }),
      }),
      ...(location === undefined ? {} : { location }),
      ...(input.details === undefined ? {} : { details: input.details }),
    });
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
      throw new AuditEventError(`Invalid audit event ${input.action}: ${paths.join(', ')}`);
    }
    return parsed.data;
  }

  async function record(input: RecordInput): Promise<void> {
    const event = await eventOf(input);
    try {
      const ref = await currentUser();
      if (ref === null) return;
      await queue.add({
        eventId: event.eventId,
        userRef: ref,
        occurredAt: event.occurredAt,
        payload: JSON.stringify(event),
      });
      const dropped = await queue.trim(LIMITS.clientQueueEvents);
      if (dropped > 0) {
        logger.warn('Audit queue full: its oldest events were dropped', { dropped });
      }
    } catch (error) {
      failed('queuing an event', error);
    }
  }

  async function addDiscarded(count: number): Promise<void> {
    const current = countOf(await queue.meta('discarded'));
    await queue.setMeta('discarded', String(current + count));
  }

  async function settleDiscarded(reported: number): Promise<void> {
    const left = countOf(await queue.meta('discarded')) - reported;
    await queue.setMeta('discarded', left > 0 ? String(left) : null);
  }

  /** The rows as events, each checked again: stored data is external input. */
  async function pendingOf(rows: readonly QueuedRow[]): Promise<Pending[]> {
    const pending: Pending[] = [];
    const unreadable: string[] = [];
    let bytes = BATCH_OVERHEAD_BYTES;
    for (const row of rows) {
      let event: ClientEvent | undefined;
      try {
        const parsed = ClientEventSchema.safeParse(JSON.parse(row.payload));
        if (parsed.success && parsed.data.eventId === row.eventId) event = parsed.data;
      } catch {
        // Not JSON: dropped below.
      }
      if (event === undefined) {
        unreadable.push(row.eventId);
        continue;
      }
      const size = canonicalJsonBytes(event) + 1;
      if (pending.length > 0 && bytes + size > LIMITS.clientBatchBytes) break;
      bytes += size;
      pending.push({ row, event });
    }
    if (unreadable.length > 0) {
      await queue.remove(unreadable);
      logger.warn('Audit queue: unreadable events dropped', { count: unreadable.length });
    }
    return pending;
  }

  /** Events the API failed on: one more attempt each, dropped at MAX_ATTEMPTS. */
  async function failedOn(eventIds: readonly string[]): Promise<void> {
    const dropped = await queue.failed(eventIds, MAX_ATTEMPTS);
    if (dropped > 0) logger.warn('Audit events the API kept failing on were dropped', { dropped });
  }

  function pauseFor(result: { retryAfterMs?: number }): number {
    if (result.retryAfterMs !== undefined && result.retryAfterMs > 0) {
      return Math.min(result.retryAfterMs, PAUSE_MAX_MS);
    }
    const base = Math.min(PAUSE_FIRST_MS * 2 ** (failures - 1), PAUSE_MAX_MS);
    // One random byte: the sum of a one-byte array.
    const byte = deps.random(new Uint8Array(1)).reduce((sum, value) => sum + value, 0);
    const jitter = 0.8 + (0.4 * byte) / 255;
    return Math.round(base * jitter);
  }

  /** What the API's answer means for the rows; true when the next batch may go at once. */
  async function settle(pending: Pending[], result: SendResult, reported: number) {
    const ids = pending.map(({ row }) => row.eventId);
    switch (result.kind) {
      case 'answered': {
        failures = 0;
        const answers = new Map(result.results.map((answer) => [answer.eventId, answer]));
        const done: string[] = [];
        const missing: string[] = [];
        for (const { row, event } of pending) {
          const answer = answers.get(row.eventId);
          if (answer === undefined) {
            missing.push(row.eventId);
            continue;
          }
          done.push(row.eventId);
          if (answer.status === 'rejected') {
            logger.warn('The API refused an audit event', {
              action: event.action,
              reason: answer.reason ?? 'none',
            });
          }
        }
        await queue.remove(done);
        if (missing.length > 0) await failedOn(missing);
        if (reported > 0) await settleDiscarded(reported);
        return missing.length === 0;
      }
      case 'unreachable':
        return false;
      case 'later':
        // 401: the session it was sent with ended or is being renewed, which
        // is not the events' fault. 429: busy. 5xx: the API failed on them.
        if (result.status === 401) return false;
        failures += 1;
        pausedUntil = now() + pauseFor(result);
        if (result.status >= 500) await failedOn(ids);
        return false;
      case 'refused':
        await queue.remove(ids);
        logger.warn('The API refused a batch of audit events: dropped', {
          status: result.status,
          count: ids.length,
        });
        return true;
    }
  }

  /** One batch of the user's oldest events; true when there may be more to send now. */
  async function sendBatch(ref: string): Promise<boolean> {
    const rows = await queue.next(ref, LIMITS.clientBatchEvents);
    if (rows.length === 0) return false;
    const pending = await pendingOf(rows);
    if (pending.length === 0) return true;
    const reported = Math.min(countOf(await queue.meta('discarded')), LIMITS.clientQueueEvents);
    const batch: ClientEventBatch = {
      events: pending.map(({ event }) => event),
      ...(reported > 0 ? { discardedAtSignOut: reported } : {}),
    };
    return settle(pending, await transport.sendEvents(batch), reported);
  }

  async function send(force: boolean): Promise<void> {
    if (!deps.signedIn() || (!force && now() < pausedUntil)) return;
    let ref: string | null;
    try {
      ref = await currentUser();
    } catch (error) {
      failed('reading the queue', error);
      return;
    }
    if (ref === null) return;
    // Signed out, or someone else signed in, meanwhile: stop before the next batch.
    while (user === ref && deps.signedIn()) {
      try {
        if (!(await sendBatch(ref))) return;
      } catch (error) {
        failed('sending the queue', error);
        return;
      }
    }
  }

  function flushNow(force: boolean): Promise<void> {
    flushing ??= send(force).finally(() => {
      flushing = null;
    });
    return flushing;
  }

  /**
   * A session began on this phone: a sign-in, or the app opened with the
   * session it kept. Audit Hub's rules read it as a sign-in (a new device,
   * impossible travel), so it is recorded once per binding, never on each
   * return to the foreground.
   */
  async function sessionStarted(): Promise<void> {
    if (sessionRecorded) return;
    sessionRecorded = true;
    await record({ action: 'client.session.started', withLocation: true });
  }

  async function forgetPushToken(): Promise<void> {
    const token = await queue.meta('push_token');
    if (token === null) return;
    await transport.unregisterPushToken(token);
    await queue.setMeta('push_token', null);
  }

  const client: AuditClient = {
    record,

    async bindUser(userId) {
      // At once: what is recorded or registered from now on is theirs.
      const known = user;
      user = userId;
      try {
        const previous = known === undefined ? await queue.meta('user') : known;
        if (previous !== userId) {
          // Someone else's session, or a new one: its own session event.
          sessionRecorded = false;
          const removed = await queue.removeOthers(userId);
          if (removed > 0) await addDiscarded(removed);
          await queue.setMeta('user', userId);
        }
      } catch (error) {
        sessionRecorded = false;
        failed('binding the queue', error);
      }
      await sessionStarted().catch((error: unknown) => {
        failed('recording the session', error);
      });
      void flushNow(false);
    },

    async beforeSignOut() {
      let ref: string | null;
      try {
        ref = await currentUser();
      } catch (error) {
        failed('reading the queue', error);
        return;
      }
      if (ref === null) return;
      const deadline = wait(SIGN_OUT_FLUSH_MS);
      const work = (async () => {
        await flushNow(true);
        await forgetPushToken();
      })().catch((error: unknown) => {
        failed('sending the queue at sign-out', error);
      });
      await Promise.race([work.finally(deadline.cancel), deadline.done]);
      user = null;
      sessionRecorded = false;
      try {
        const removed = await queue.removeUser(ref);
        if (removed > 0) await addDiscarded(removed);
        await queue.setMeta('user', null);
        await queue.setMeta('push_token', null);
      } catch (error) {
        failed('emptying the queue at sign-out', error);
      }
    },

    async sessionEnded(endedBy) {
      try {
        if ((await currentUser()) === null) return;
        // Sent with the user's next session, if they sign in again on this phone.
        if (endedBy === 'expired') await record({ action: 'client.session.expired' });
        user = null;
        sessionRecorded = false;
        await queue.setMeta('user', null);
      } catch (error) {
        user = null;
        sessionRecorded = false;
        failed('ending the queue', error);
      }
    },

    flush: () => flushNow(false),

    start() {
      const stops = [
        deps.triggers.every(FLUSH_INTERVAL_MS, () => void flushNow(false)),
        deps.triggers.onOnline(() => void flushNow(false)),
        deps.triggers.onForeground(() => void flushNow(false)),
      ];
      void flushNow(false);
      return () => {
        for (const stop of stops) stop();
      };
    },

    deviceId: installationId,

    async requestHeaders() {
      return requestHeadersOf(deps.device.facts(), await installationId());
    },

    async registerPushToken(token) {
      if (token.kind !== 'expo' || !EXPO_PUSH_TOKEN_PATTERN.test(token.value)) {
        logger.info('Push token not registered: the API takes Expo push tokens only');
        return;
      }
      try {
        if (!deps.signedIn() || (await currentUser()) === null) return;
        if (await transport.registerPushToken(token.value, token.platform)) {
          await queue.setMeta('push_token', token.value);
        }
      } catch (error) {
        failed('registering the push token', error);
      }
    },
  };
  return client;
}
