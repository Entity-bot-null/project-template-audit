import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTests, setSession } from '../../auth/session';
import { ALERT_ID, alertRow, liveFeed } from '../../test/alerts';
import { admin } from '../../test/fixtures';
import { failure, stubFetch } from '../../test/http';
import {
  backoff,
  type LiveEvent,
  liveStatus,
  onLiveAlert,
  onLiveResync,
  resetLiveForTests,
  startLive,
} from './stream';

const STREAM = 'GET /api/alerts/stream';
const OTHER = '0190b6a1-0000-7000-8000-0000000000b2';

/** Each connection answered in turn by the next feed. */
function connections(...feeds: ReturnType<typeof liveFeed>[]) {
  let index = 0;
  return () => {
    const feed = feeds[index++];
    return feed === undefined ? failure(503, 'Unavailable') : feed.response();
  };
}

function heard() {
  const events: LiveEvent[] = [];
  onLiveAlert((event) => events.push(event));
  return events;
}

beforeEach(() => {
  resetForTests();
  resetLiveForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetLiveForTests();
  resetForTests();
  vi.unstubAllGlobals();
});

describe('the live stream', () => {
  it('connects with the access token, says it is live, and delivers each change once', async () => {
    const feed = liveFeed();
    const { calls } = stubFetch({ [STREAM]: connections(feed) });
    const events = heard();
    startLive();

    feed.send('ready', {});
    await vi.waitFor(() => {
      expect(liveStatus()).toBe('live');
    });
    const alert = alertRow();
    feed.send('alert', { alert, replay: false }, `${alert.updatedAt}|${ALERT_ID}`);
    feed.send('alert', { alert, replay: false }, `${alert.updatedAt}|${ALERT_ID}`);
    const other = alertRow({ id: OTHER });
    feed.send('alert', { alert: other, replay: false }, `${other.updatedAt}|${OTHER}`);

    await vi.waitFor(() => {
      expect(events.map((event) => event.alert.id)).toEqual([ALERT_ID, OTHER]);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer token-1');
    expect(calls[0]?.headers.get('Last-Event-ID')).toBeNull();
  });

  it('reconnects from where it was when the server renews it; a replay is never delivered twice', async () => {
    const first = liveFeed();
    const second = liveFeed();
    const { calls } = stubFetch({ [STREAM]: connections(first, second) });
    const events = heard();
    startLive();

    const alert = alertRow();
    const cursor = `${alert.updatedAt}|${ALERT_ID}`;
    first.send('ready', {});
    first.send('alert', { alert, replay: false }, cursor);
    first.send('end', { reason: 'renew' });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.headers.get('Last-Event-ID')).toBe(cursor);

    const changed = alertRow({
      status: 'in_review',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    });
    second.send('ready', {});
    second.send('alert', { alert, replay: true }, cursor);
    second.send('alert', { alert: changed, replay: true }, `${changed.updatedAt}|${ALERT_ID}`);
    await vi.waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events.map((event) => event.alert.status)).toEqual(['open', 'in_review']);
    expect(events[1]?.replay).toBe(true);
  });

  it('asks the page to reload when too much was missed to replay', async () => {
    const feed = liveFeed();
    stubFetch({ [STREAM]: connections(feed) });
    const resync = vi.fn();
    onLiveResync(resync);
    startLive();

    feed.send('resync', {});
    await vi.waitFor(() => {
      expect(resync).toHaveBeenCalledOnce();
    });
  });

  it('stops for good when the session ended: no renewal, no reconnection', async () => {
    const { calls } = stubFetch({
      [STREAM]: () => failure(401, 'Unauthorized'),
      'POST /api/auth/refresh': () => failure(401, 'Unauthorized'),
    });
    startLive();
    await vi.waitFor(() => {
      expect(liveStatus()).toBe('idle');
    });
    expect(calls.filter((call) => call.url.endsWith('/api/alerts/stream'))).toHaveLength(1);
  });

  it('stops for good when the server says access was lost', async () => {
    const feed = liveFeed();
    const { calls } = stubFetch({ [STREAM]: connections(feed, liveFeed()) });
    startLive();
    feed.send('ready', {});
    await vi.waitFor(() => {
      expect(liveStatus()).toBe('live');
    });
    feed.send('end', { reason: 'access' });
    await vi.waitFor(() => {
      expect(liveStatus()).toBe('idle');
    });
    expect(calls).toHaveLength(1);
  });

  it('waits for the network to come back when offline, then connects again', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const feed = liveFeed();
    let attempt = 0;
    const { calls } = stubFetch({
      [STREAM]: () => {
        if (attempt++ === 0) throw new TypeError('Failed to fetch');
        return feed.response();
      },
    });
    startLive();
    await vi.waitFor(() => {
      expect(liveStatus()).toBe('offline');
    });
    expect(calls).toHaveLength(1);

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    feed.send('ready', {});
    await vi.waitFor(() => {
      expect(liveStatus()).toBe('live');
    });
    expect(calls).toHaveLength(2);
  });

  it('hears what the connection of another tab heard (one connection per browser)', async () => {
    const feed = liveFeed();
    stubFetch({ [STREAM]: connections(feed) });
    const events = heard();
    startLive();

    const tab = new BroadcastChannel('audit-hub-alerts');
    const alert = alertRow({ id: OTHER });
    tab.postMessage({
      type: 'alert',
      event: { alert, replay: false },
      cursor: `${alert.updatedAt}|${OTHER}`,
    });
    tab.postMessage({ type: 'alert', event: { alert, replay: false } });
    await vi.waitFor(() => {
      expect(events.map((event) => event.alert.id)).toEqual([OTHER]);
    });
    tab.close();
  });
});

describe('backoff', () => {
  it('doubles from a second up to 30, each between half and all of it', () => {
    expect(backoff(1, () => 0)).toBe(500);
    expect(backoff(1, () => 1)).toBe(1000);
    expect(backoff(3, () => 1)).toBe(4000);
    expect(backoff(12, () => 1)).toBe(30_000);
    expect(backoff(12, () => 0)).toBe(15_000);
  });
});
