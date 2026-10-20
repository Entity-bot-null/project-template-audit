import { api } from '../../api/client';
import type { Alert } from '../types';
import { sseFrames } from './sse';

// The live stream of alerts (GET /api/alerts/stream), one per browser: the
// tabs elect a leader (a Web Lock) that holds the connection and shares what
// it hears with the others (a BroadcastChannel); when it closes, another
// takes over from the same position. The server stays the source of truth:
// a reconnection replays what changed since the last event (Last-Event-ID),
// and each change is delivered once, whatever replays it.

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface LiveEvent {
  alert: Alert;
  /** Replayed after a reconnection: a change missed, not news of now. */
  replay: boolean;
}

type Message =
  | { type: 'alert'; event: LiveEvent; cursor?: string }
  | { type: 'status'; status: LiveStatus }
  | { type: 'resync' };

const LOCK = 'audit-hub-alert-stream';
const CHANNEL = 'audit-hub-alerts';
const MAX_BACKOFF_MS = 30_000;
const SEEN_LIMIT = 2000;

let status: LiveStatus = 'idle';
let leading = false;
let cursor: string | undefined;
let channel: BroadcastChannel | null = null;
let stopper: AbortController | null = null;
const seen = new Set<string>();
const statusListeners = new Set<() => void>();
const alertListeners = new Set<(event: LiveEvent) => void>();
const resyncListeners = new Set<() => void>();

export const liveStatus = (): LiveStatus => status;
/** This tab holds the connection: the one that sounds and shows browser notices. */
export const isLeader = (): boolean => leading;

export function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Every change of an alert the person may see, once. */
export function onLiveAlert(listener: (event: LiveEvent) => void): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

/** Too much was missed to replay: reload what is shown. */
export function onLiveResync(listener: () => void): () => void {
  resyncListeners.add(listener);
  return () => resyncListeners.delete(listener);
}

function setStatus(next: LiveStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener();
  if (leading) channel?.postMessage({ type: 'status', status: next } satisfies Message);
}

function deliver(event: LiveEvent): void {
  const key = `${event.alert.id}|${event.alert.updatedAt}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value ?? key);
  for (const listener of alertListeners) listener(event);
}

function resync(): void {
  for (const listener of resyncListeners) listener();
}

function onMessage(message: MessageEvent<Message>): void {
  const data = message.data;
  if (data.type === 'alert') {
    if (data.cursor !== undefined) cursor = data.cursor;
    deliver(data.event);
  } else if (data.type === 'status' && !leading) {
    status = data.status;
    for (const listener of statusListeners) listener();
  } else if (data.type === 'resync') {
    resync();
  }
}

/** Starts listening (one connection per browser); answers how to stop. */
export function startLive(): () => void {
  if (stopper !== null) return stopLive;
  const controller = new AbortController();
  stopper = controller;
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener('message', onMessage);
  }
  setStatus('connecting');
  const lead = async () => {
    leading = true;
    try {
      await run(controller.signal);
    } finally {
      leading = false;
    }
  };
  // `navigator.locks` is absent in some browsers and in tests, whatever the DOM types say.
  const locks = (navigator as { locks?: LockManager }).locks;
  if (locks === undefined) {
    void lead();
  } else {
    locks.request(LOCK, { signal: controller.signal }, lead).catch(() => undefined);
  }
  return stopLive;
}

export function stopLive(): void {
  stopper?.abort();
  stopper = null;
  channel?.close();
  channel = null;
  leading = false;
  status = 'idle';
  for (const listener of statusListeners) listener();
}

async function run(signal: AbortSignal): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    setStatus(failures === 0 ? 'connecting' : 'reconnecting');
    let outcome: 'renew' | 'retry' | 'stop';
    try {
      outcome = await connect(signal, () => {
        failures = 0;
      });
    } catch {
      outcome = 'retry';
    }
    // Read again: it may have been aborted while connected.
    if (aborted(signal)) return;
    if (outcome === 'stop') {
      setStatus('idle');
      return;
    }
    if (outcome === 'renew') continue;
    failures += 1;
    if (!navigator.onLine) {
      setStatus('offline');
      await whenOnline(signal);
      failures = 0;
      continue;
    }
    setStatus('reconnecting');
    await pause(backoff(failures), signal);
  }
}

/** One connection: 'renew' (the server ended it: at once again), 'retry' (after a pause), 'stop'. */
async function connect(
  signal: AbortSignal,
  onReady: () => void,
): Promise<'renew' | 'retry' | 'stop'> {
  const { response } = await api.GET('/api/alerts/stream', {
    parseAs: 'stream',
    signal,
    headers: cursor === undefined ? {} : { 'Last-Event-ID': cursor },
  });
  // Signed out, or no access any more: the session's own handling takes over.
  if (response.status === 401 || response.status === 403) return 'stop';
  if (!response.ok || response.body === null) return 'retry';
  for await (const frame of sseFrames(response.body)) {
    if (frame.event === 'alert') {
      const event = JSON.parse(frame.data) as LiveEvent;
      if (frame.id !== undefined) cursor = frame.id;
      deliver(event);
      channel?.postMessage({ type: 'alert', event, cursor } satisfies Message);
    } else if (frame.event === 'ready') {
      onReady();
      setStatus('live');
    } else if (frame.event === 'resync') {
      resync();
      channel?.postMessage({ type: 'resync' } satisfies Message);
    } else if (frame.event === 'end') {
      const reason = (JSON.parse(frame.data) as { reason?: string }).reason;
      return reason === 'access' ? 'stop' : 'renew';
    }
  }
  return 'retry';
}

const aborted = (signal: AbortSignal) => signal.aborted;

/** 1, 2, 4… seconds up to 30, each between half and all of it (no thundering herd). */
export function backoff(failures: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(ceiling * (0.5 + random() / 2));
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function whenOnline(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      resolve();
    };
    window.addEventListener('online', done);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Forgets everything (specs). */
export function resetLiveForTests(): void {
  stopLive();
  cursor = undefined;
  seen.clear();
  statusListeners.clear();
  alertListeners.clear();
  resyncListeners.clear();
}
