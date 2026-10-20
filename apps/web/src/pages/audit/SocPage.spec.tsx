import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetVisibleApps } from '../../audit/apps';
import { DEFAULT_PREFERENCES } from '../../audit/live/policy';
import { resetLiveForTests } from '../../audit/live/stream';
import type { Alert, Source, SourceList, VisibleApps } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { alertRow, liveFeed } from '../../test/alerts';
import { admin } from '../../test/fixtures';
import { ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// The security operations view: unresolved alerts by severity, the critical
// and high ones waiting, what changed just now (the live stream), the
// sources' state and the log's integrity, for one application, one
// environment or all.
vi.unmock('../../audit/live/LiveProvider');

const SHOP = '0190b6a1-0000-7000-8000-0000000000a1';
const STAGING = '0190b6a1-0000-7000-8000-0000000000a2';
const LIST = 'GET /api/alerts';
const SUMMARY = 'GET /api/alerts/summary';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);

const visible: VisibleApps = {
  items: [
    {
      appId: SHOP,
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
  ],
};

const counts = (critical: number, high: number) => ({ info: 0, low: 0, medium: 0, high, critical });

const source = (overrides: Partial<Source>): Source => ({
  appId: SHOP,
  slug: 'shop',
  name: 'Shop',
  environment: 'production',
  status: 'active',
  heartbeatTimeoutSec: 120,
  lastHeartbeatAt: new Date().toISOString(),
  queueSize: 0,
  queueOldestAgeSec: null,
  retrying: 0,
  lastEventAt: new Date().toISOString(),
  rejected15m: 0,
  gaps: 0,
  missingEvents: 0,
  oldestGapAt: null,
  ...overrides,
});

const sources: SourceList = {
  checkedAt: new Date().toISOString(),
  items: [
    source({ queueSize: 3, queueOldestAgeSec: 600, rejected15m: 2 }),
    source({
      appId: STAGING,
      slug: 'shop-staging',
      environment: 'staging',
      status: 'disconnected',
      lastHeartbeatAt: null,
      missingEvents: 5,
    }),
  ],
};

const urgent: Alert[] = [
  alertRow({ severity: 'critical', title: 'Integrity verification failed' }),
  alertRow({
    id: '0190b6a1-0000-7000-8000-0000000000b2',
    appId: STAGING,
    appSlug: 'shop-staging',
    title: 'Source silent',
    status: 'in_review',
  }),
];

function setup() {
  const feed = liveFeed();
  const fetched = stubFetch({
    'GET /api/alerts/stream': () => feed.response(),
    'GET /api/account/notification-preferences': () => ok(DEFAULT_PREFERENCES),
    'GET /api/account/apps': () => ok(visible),
    [SUMMARY]: (request) =>
      ok({
        open:
          new URL(request.url).searchParams.get('appId') === STAGING ? counts(0, 1) : counts(2, 5),
        inReview: counts(0, 1),
        muted: 1,
        oldestOpenAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    [LIST]: () => ok({ items: urgent, total: urgent.length }),
    'GET /api/sources': () => ok(sources),
    'GET /api/overview': () =>
      ok({
        since: new Date().toISOString(),
        integrity: { outcome: 'passed', finishedAt: new Date().toISOString() },
        apps: [],
      }),
  });
  renderRoute('/soc');
  return { feed, ...fetched };
}

beforeEach(() => {
  resetForTests();
  resetLiveForTests();
  forgetVisibleApps();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetLiveForTests();
  resetForTests();
});

describe('SocPage', () => {
  it('shows what is unresolved, what waits, the sources and the integrity at a glance', async () => {
    const { calls } = setup();

    expect(await screen.findByRole('heading', { name: 'Security operations' })).toBeInTheDocument();
    const unresolved = screen.getByRole('region', { name: 'Unresolved alerts' });
    expect(await within(unresolved).findByText('2')).toHaveClass('stat');
    expect(within(unresolved).getByText('1 silenced')).toBeInTheDocument();

    const waiting = screen.getByRole('region', { name: 'Critical and high, unresolved' });
    expect(
      await within(waiting).findByRole('link', { name: 'Integrity verification failed' }),
    ).toHaveAttribute('href', `/alerts/${urgent[0]?.id ?? ''}`);
    const query = new URL(callsTo(calls, LIST)[0]?.url ?? '').searchParams;
    expect(query.getAll('status')).toEqual(['open', 'in_review']);
    expect(query.getAll('severity')).toEqual(['critical', 'high']);
    expect(query.get('sort')).toBe('severity');

    const table = await screen.findByRole('table');
    const staging = within(table).getByRole('row', { name: /staging/ });
    expect(within(staging).getByText('Disconnected: no heartbeat')).toHaveClass(
      'source-disconnected',
    );
    expect(within(staging).getByText('5')).toBeInTheDocument();
    const production = within(table).getByRole('row', { name: /production/ });
    expect(within(production).getByText('3, oldest 10 min')).toBeInTheDocument();

    expect(await screen.findByText(/The latest verification passed/)).toBeInTheDocument();
  });

  it('narrows everything to one environment, or to one application', async () => {
    const { calls } = setup();
    const user = userEvent.setup();

    await screen.findByRole('link', { name: 'Source silent' });
    await user.selectOptions(await screen.findByLabelText('Environment'), 'production');
    expect(screen.queryByRole('link', { name: 'Source silent' })).toBeNull();
    expect(screen.queryByRole('row', { name: /staging/ })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Environment'), 'Every environment');
    await user.selectOptions(screen.getByLabelText('Application'), 'Shop (staging)');
    await vi.waitFor(() => {
      expect(
        callsTo(calls, LIST).some(
          (call) => new URL(call.url).searchParams.get('appId') === STAGING,
        ),
      ).toBe(true);
    });
    expect(screen.queryByRole('link', { name: 'Integrity verification failed' })).toBeNull();
    expect(
      callsTo(calls, SUMMARY).some(
        (call) => new URL(call.url).searchParams.get('appId') === STAGING,
      ),
    ).toBe(true);
  });

  it('lists what changed just now, as the live stream hears it', async () => {
    const { feed } = setup();
    const activity = await screen.findByRole('region', { name: 'Just now' });
    expect(within(activity).getByText('Nothing since this page opened.')).toBeInTheDocument();

    feed.send('ready', {});
    const opened = alertRow({ id: '0190b6a1-0000-7000-8000-0000000000b9', title: 'Mass export' });
    feed.send('alert', { alert: opened, replay: false }, `${opened.updatedAt}|${opened.id}`);

    expect(await within(activity).findByRole('link', { name: 'Mass export' })).toHaveAttribute(
      'href',
      `/alerts/${opened.id}`,
    );
  });
});
