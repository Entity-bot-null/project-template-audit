import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetVisibleApps } from '../../audit/apps';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from '../../audit/live/policy';
import { resetSoundForTests } from '../../audit/live/sound';
import { resetLiveForTests } from '../../audit/live/stream';
import type { VisibleApps } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { liveFeed } from '../../test/alerts';
import { admin } from '../../test/fixtures';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// The person's notifications: sounds by severity (each to try), a critical
// alert's sound again, the browser's notices, quiet times and applications
// never heard about; kept on their account through the live layer.
vi.unmock('../../audit/live/LiveProvider');

const GET = 'GET /api/account/notification-preferences';
const PUT = 'PUT /api/account/notification-preferences';
const STAGING = '0190b6a1-0000-7000-8000-0000000000a2';
const visible: VisibleApps = {
  items: [
    {
      appId: '0190b6a1-0000-7000-8000-0000000000a1',
      slug: 'shop',
      name: 'Shop',
      environment: 'production',
      status: 'active',
      system: false,
    },
    {
      appId: STAGING,
      slug: 'shop-staging',
      name: 'Shop',
      environment: 'staging',
      status: 'active',
      system: false,
    },
    {
      appId: '0190b6a1-0000-7000-8000-0000000000a0',
      slug: 'audit-hub',
      name: 'Audit Hub',
      environment: 'production',
      status: 'active',
      system: true,
    },
  ],
};
const saved: NotificationPreferences = {
  ...DEFAULT_PREFERENCES,
  sound: { enabled: true, volume: 30, severities: ['critical'] },
};

function setup(
  put: (request: Request) => Response | Promise<Response> = async (request) =>
    ok(await request.clone().json()),
) {
  const fetched = stubFetch({
    'GET /api/alerts/stream': () => liveFeed().response(),
    'GET /api/alerts/summary': () => ok({ open: {}, inReview: {}, muted: 0, oldestOpenAt: null }),
    'GET /api/account/apps': () => ok(visible),
    [GET]: () => ok(saved),
    [PUT]: put,
  });
  renderRoute('/account/notifications');
  return fetched;
}

const sent = async (calls: Request[]) => {
  const put = calls.filter((call) => call.method === 'PUT').at(-1);
  return (await put?.json()) as NotificationPreferences;
};

beforeEach(() => {
  resetForTests();
  resetLiveForTests();
  resetSoundForTests();
  forgetVisibleApps();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetLiveForTests();
  resetSoundForTests();
  resetForTests();
  vi.unstubAllGlobals();
});

describe('NotificationSettingsPage', () => {
  it('starts from what the person saved, and saves their changes on their account', async () => {
    const { calls } = setup();
    const user = userEvent.setup();

    expect(await screen.findByLabelText('Volume (30)')).toHaveValue('30');
    const sounds = screen.getByRole('group', { name: 'Severities that sound' });
    expect(within(sounds).getByLabelText('critical')).toBeChecked();
    expect(within(sounds).getByLabelText('high')).not.toBeChecked();

    await user.click(within(sounds).getByLabelText('high'));
    await user.click(screen.getByLabelText('Show browser notifications for new alerts'));
    const muted = await screen.findByRole('group', {
      name: 'Applications you never hear about here',
    });
    expect(within(muted).queryByLabelText(/Audit Hub/)).toBeNull();
    await user.click(within(muted).getByLabelText('Shop (staging)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved.')).toHaveAttribute('role', 'status');
    expect(await sent(calls)).toEqual({
      ...saved,
      sound: { enabled: true, volume: 30, severities: ['critical', 'high'] },
      browser: { enabled: true, severities: ['critical', 'high'] },
      mutedAppIds: [STAGING],
    });
  });

  it('says when the API refused the values, keeping them', async () => {
    setup(() => failure(400, 'criticalRepeat.times: Too big'));
    const user = userEvent.setup();

    const times = await screen.findByLabelText('At most (times)');
    await user.clear(times);
    await user.type(times, '7');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not saved: check the values and try again.',
    );
    expect(times).toHaveValue(7);
  });

  it('asks the browser for its notices only from a click, and says when it blocks them', async () => {
    const requestPermission = vi.fn(() => Promise.resolve('denied' as const));
    vi.stubGlobal(
      'Notification',
      Object.assign(vi.fn(), { permission: 'default', requestPermission }),
    );
    setup();
    const user = userEvent.setup();

    expect(await screen.findByText('Not asked yet.')).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Allow browser notifications' }));

    expect(await screen.findByText(/^Blocked by this browser/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow browser notifications' })).toBeNull();
  });

  it('keeps quiet for a while, then resumes', async () => {
    const { calls } = setup();
    const user = userEvent.setup();

    const before = Date.now();
    await user.click(await screen.findByRole('button', { name: 'Quiet for 8 hours' }));
    expect(await screen.findByText(/^No sound and no notice until /)).toBeInTheDocument();
    const span = Date.parse((await sent(calls)).quietUntil ?? '') - before;
    expect(span).toBeGreaterThanOrEqual(8 * 3_600_000 - 1000);
    expect(span).toBeLessThanOrEqual(8 * 3_600_000 + 5000);

    await user.click(screen.getByRole('button', { name: 'Resume now' }));
    const quiet = screen.getByRole('region', { name: 'Quiet' });
    expect(await within(quiet).findByRole('button', { name: 'Quiet for an hour' })).toBeVisible();
    expect((await sent(calls)).quietUntil).toBeNull();
  });

  it('says so when this browser plays no sound', async () => {
    vi.stubGlobal('AudioContext', undefined);
    setup();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Try the critical sound' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This browser does not play sounds here.',
    );
    expect(screen.getByText('This browser has no Web Audio: no sound here.')).toBeInTheDocument();
  });
});
