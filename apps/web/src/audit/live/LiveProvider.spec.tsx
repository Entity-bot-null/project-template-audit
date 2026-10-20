import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTests, setSession } from '../../auth/session';
import { ALERT_ID, alertRow, liveFeed } from '../../test/alerts';
import { admin } from '../../test/fixtures';
import { ok, stubFetch } from '../../test/http';
import type { Alert } from '../types';
import { LiveControls } from './LiveControls';
import { useLive } from './LiveContext';
import { LiveProvider } from './LiveProvider';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from './policy';
import { resetSoundForTests } from './sound';
import { resetLiveForTests } from './stream';

// The real live layer (test/setup.ts leaves it out of the pages' specs).
vi.unmock('./LiveProvider');

const STREAM = 'GET /api/alerts/stream';
const SUMMARY = 'GET /api/alerts/summary';
const PREFERENCES = 'GET /api/account/notification-preferences';
const SAVE = 'PUT /api/account/notification-preferences';
const COUNTS = { info: 0, low: 0, medium: 1, high: 2, critical: 1 };
const summary = { open: COUNTS, inReview: COUNTS, muted: 0, oldestOpenAt: null };

/** Records the notes played (a fake Web Audio) and the browser notices shown. */
function stubBrowser() {
  const notes: number[] = [];
  const notices: string[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: param(),
        connect: (next: unknown) => next,
        start: (at: number) => notes.push(at),
        stop: vi.fn(),
      };
    }
    createGain() {
      return { gain: param(), connect: (next: unknown) => next };
    }
  }
  class FakeNotification {
    static permission = 'granted';
    onclick = null;
    constructor(title: string) {
      notices.push(title);
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('Notification', FakeNotification);
  return { notes, notices };
}

function Probe() {
  const live = useLive();
  return (
    <>
      <LiveControls />
      <p>critical open: {live.summary === null ? '—' : String(live.summary.open.critical)}</p>
      <p>changes heard: {live.recent.length}</p>
    </>
  );
}

function setup(preferences: Partial<NotificationPreferences> = {}) {
  const feed = liveFeed();
  const saved: unknown[] = [];
  const fetched = stubFetch({
    [STREAM]: () => feed.response(),
    [SUMMARY]: () => ok(summary),
    [PREFERENCES]: () => ok({ ...DEFAULT_PREFERENCES, ...preferences }),
    [SAVE]: async (request) => {
      const body: unknown = await request.json();
      saved.push(body);
      return ok(body);
    },
  });
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <LiveProvider enabled>
          <Probe />
        </LiveProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  return { feed, saved, ...fetched };
}

/** The stream's news of `alert` now. */
const news = (feed: ReturnType<typeof liveFeed>, alert: Alert, replay = false) => {
  feed.send('alert', { alert, replay }, `${alert.updatedAt}|${alert.id}`);
};

beforeEach(() => {
  resetForTests();
  resetLiveForTests();
  resetSoundForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetLiveForTests();
  resetSoundForTests();
  resetForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LiveProvider', () => {
  it('connects, says it is live and loads the counters', async () => {
    const { feed } = setup();
    feed.send('ready', {});
    expect(await screen.findByRole('status')).toHaveTextContent('Live');
    expect(await screen.findByText('critical open: 1')).toBeInTheDocument();
  });

  it('shows news on the page, announced at once for a critical alert; it stays until dismissed', async () => {
    const { feed } = setup({ sound: { ...DEFAULT_PREFERENCES.sound, enabled: false } });
    feed.send('ready', {});
    news(feed, alertRow({ severity: 'critical', title: 'Integrity verification failed' }));

    const notices = await screen.findByRole('region', { name: 'Alert notices' });
    expect(within(notices).getByText('New')).toBeInTheDocument();
    expect(within(notices).getByText('Integrity verification failed')).toBeInTheDocument();
    expect(within(notices).getByRole('link', { name: 'Open the alert' })).toHaveAttribute(
      'href',
      `/alerts/${ALERT_ID}`,
    );
    expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(
      'New critical alert: Integrity verification failed',
    );

    await userEvent.setup().click(within(notices).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Alert notices' })).toBeNull();
  });

  it("plays the severity's sound and shows the browser's notice, as the person chose", async () => {
    const browser = stubBrowser();
    const { feed } = setup({
      sound: { enabled: true, volume: 60, severities: ['high', 'critical'] },
      browser: { enabled: true, severities: ['critical'] },
    });
    feed.send('ready', {});
    await screen.findByRole('button', { name: 'Enable sound' });
    // The browser starts audio from a gesture of the person: on the click, never the press
    // (the header changes then, and must not move under a click on its way).
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('button', { name: 'Enable sound' })).toBeInTheDocument();
    fireEvent.click(document.body);
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Enable sound' })).toBeNull();
    });

    news(feed, alertRow({ severity: 'high' }));
    await screen.findByRole('region', { name: 'Alert notices' });
    expect(browser.notes).toHaveLength(2);
    expect(browser.notices).toEqual([]);

    news(feed, alertRow({ id: '0190b6a1-0000-7000-8000-0000000000b2', severity: 'critical' }));
    await vi.waitFor(() => {
      expect(browser.notices).toEqual(['CRITICAL alert · shop']);
    });
    // One sound at most every few seconds, whatever arrives: a burst is one sound.
    expect(browser.notes).toHaveLength(2);
  });

  it('keeps quiet during a quiet time, for a silenced alert and for a muted application: still heard', async () => {
    const browser = stubBrowser();
    const { feed } = setup({
      quietUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    feed.send('ready', {});
    expect(await screen.findByRole('button', { name: /^Quiet until .*: resume$/ })).toBeVisible();
    fireEvent.click(document.body);
    news(feed, alertRow({ severity: 'critical' }));
    news(
      feed,
      alertRow({
        id: '0190b6a1-0000-7000-8000-0000000000b2',
        mutedUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    expect(await screen.findByText('changes heard: 2')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Alert notices' })).toBeNull();
    expect(browser.notes).toHaveLength(0);
    expect(browser.notices).toHaveLength(0);
  });

  it('never makes news of a replay, an acknowledged alert or a closed one', async () => {
    const { feed } = setup();
    feed.send('ready', {});
    news(feed, alertRow(), true);
    news(
      feed,
      alertRow({
        id: '0190b6a1-0000-7000-8000-0000000000b2',
        acknowledgedAt: new Date().toISOString(),
      }),
    );
    news(feed, alertRow({ id: '0190b6a1-0000-7000-8000-0000000000b3', status: 'resolved' }));

    expect(await screen.findByText('changes heard: 2')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Alert notices' })).toBeNull();
  });

  it('sounds a critical alert again while nobody acknowledges it, and stops once someone does', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
    const browser = stubBrowser();
    const { feed } = setup({
      sound: { enabled: true, volume: 60, severities: ['critical'] },
      criticalRepeat: { enabled: true, intervalSeconds: 30, times: 2 },
    });
    feed.send('ready', {});
    await screen.findByRole('button', { name: 'Enable sound' });
    fireEvent.click(document.body);
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Enable sound' })).toBeNull();
    });

    const alert = alertRow({ severity: 'critical' });
    news(feed, alert);
    await vi.waitFor(() => {
      expect(browser.notes).toHaveLength(4);
    });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(browser.notes).toHaveLength(8);

    news(
      feed,
      alertRow({
        ...alert,
        status: 'in_review',
        acknowledgedAt: new Date().toISOString(),
        updatedAt: new Date(Date.now() + 1).toISOString(),
      }),
    );
    await screen.findByText('changes heard: 2');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(browser.notes).toHaveLength(8);
  });

  it("saves an hour of quiet from the header: the person's preference, on their account", async () => {
    const { feed, saved } = setup();
    feed.send('ready', {});
    const before = Date.now();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Quiet for an hour' }));

    expect(await screen.findByRole('button', { name: /^Quiet until .*: resume$/ })).toBeVisible();
    const [body] = saved as NotificationPreferences[];
    const until = Date.parse(body?.quietUntil ?? '');
    expect(until - before).toBeGreaterThanOrEqual(3_600_000 - 1000);
    expect(until - before).toBeLessThanOrEqual(3_600_000 + 5000);
  });
});
