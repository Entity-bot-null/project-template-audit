import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { forgetVisibleApps } from '../../audit/apps';
import { formatDay } from '../../audit/format';
import type { SecurityOverview, VisibleApps } from '../../audit/types';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const HUB = '0190b6a1-0000-7000-8000-0000000000a0';
const SHOP = '0190b6a1-0000-7000-8000-0000000000a1';
const BLOG = '0190b6a1-0000-7000-8000-0000000000a2';
const APPS = 'GET /api/account/apps';
const securityOf = (appId: string) => `GET /api/connected-apps/${appId}/security`;
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const searchOf = (router: ReturnType<typeof renderRoute>) =>
  Object.fromEntries(new URLSearchParams(router.state.location.search));

const hub: VisibleApps['items'][number] = {
  appId: HUB,
  slug: 'audit-hub',
  name: 'Audit Hub',
  environment: 'production',
  status: 'active',
  system: true,
};
const apps: VisibleApps = {
  items: [
    // Its own log comes first, and is not one to pick here.
    hub,
    {
      appId: SHOP,
      slug: 'shop',
      name: 'Shop',
      environment: 'production',
      status: 'active',
      system: false,
    },
    {
      appId: BLOG,
      slug: 'blog',
      name: 'Blog',
      environment: 'staging',
      status: 'active',
      system: false,
    },
  ],
};

function overview(appId: string, days = 7): SecurityOverview {
  return {
    appId,
    days,
    geolocation: true,
    failedSignIns: [
      { day: '2026-10-13', count: 4 },
      { day: '2026-10-14', count: 12 },
    ],
    topIps: [
      { ip: '203.0.113.5', count: 1_200, accounts: 3 },
      { ip: '198.51.100.7', count: 9, accounts: 1 },
    ],
    topCountries: [
      { country: 'ES', count: 10 },
      { country: 'PT', count: 2 },
    ],
    heatmap: [
      { dow: 1, hour: 9, count: 5 },
      { dow: 6, hour: 23, count: 1 },
    ],
    anomalies: [
      { rule: 'brute_force', severity: 'high', open: 2 },
      { rule: 'impossible_travel', severity: 'critical', open: 1 },
    ],
  };
}
const quiet = (appId: string): SecurityOverview => ({
  appId,
  days: 7,
  geolocation: false,
  failedSignIns: [],
  topIps: [],
  topCountries: [],
  heatmap: [],
  anomalies: [],
});

function withApi(handlers: Parameters<typeof stubFetch>[0] = {}) {
  const fetched = stubFetch({
    [APPS]: () => ok(apps),
    [securityOf(SHOP)]: (request) =>
      ok(overview(SHOP, Number(new URL(request.url).searchParams.get('days')))),
    [securityOf(BLOG)]: (request) =>
      ok(overview(BLOG, Number(new URL(request.url).searchParams.get('days')))),
    ...handlers,
  });
  /** The security overviews asked, as "appId?days=n". */
  const asked = () =>
    fetched.calls
      .filter((call) => routeOf(call) !== APPS)
      .map((call) => {
        const url = new URL(call.url);
        return `${url.pathname.split('/')[3] ?? ''}?${url.search.slice(1)}`;
      });
  return { ...fetched, asked };
}

/** A chart, by its title. */
function chart(title: string) {
  const figure = screen.getByText(title, { selector: 'strong' }).closest('figure');
  if (figure === null) throw new Error(`No chart ${title}`);
  return within(figure);
}

/** A table's body rows as their cells' text. */
function rowsOf(table: HTMLElement) {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );
}

const loaded = () => screen.findByRole('heading', { name: 'Open anomalies' });

beforeEach(() => {
  resetForTests();
  forgetVisibleApps();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: viewer });
});
afterEach(() => {
  resetForTests();
});

describe('SecurityPage', () => {
  it("shows the first application's last 7 days: charts with their tables, and anomalies", async () => {
    const { asked } = withApi();
    renderRoute('/security');
    await loaded();

    const picker = screen.getByLabelText('Application');
    expect(picker).toHaveValue(SHOP);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Shop (production)', 'Blog (staging)']);
    expect(screen.getByLabelText('Period')).toHaveValue('7');
    expect(screen.getByRole('option', { name: 'Last 90 days' })).toHaveValue('90');
    expect(asked()).toEqual([`${SHOP}?days=7`]);

    const failed = chart('Failed sign-ins');
    expect(failed.getByText('Per day, UTC.')).toBeInTheDocument();
    expect(
      failed.getByRole('img', { name: 'Failed sign-ins: 16 in total, at most 12' }),
    ).toBeInTheDocument();
    const days = failed.getByRole('table');
    expect(within(days).getByRole('columnheader', { name: 'Day' })).toBeInTheDocument();
    expect(within(days).getByRole('columnheader', { name: 'Failed sign-ins' })).toBeInTheDocument();
    expect(rowsOf(days)).toEqual([
      [formatDay('2026-10-13'), '4'],
      [formatDay('2026-10-14'), '12'],
    ]);

    const addresses = chart('Addresses with the most failed sign-ins');
    expect(addresses.getByText('And how many accounts each one tried.')).toBeInTheDocument();
    expect(
      within(addresses.getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['203.0.113.5 (3 accounts)1,200', '198.51.100.7 (1 accounts)9']);
    expect(addresses.getByRole('columnheader', { name: 'Address' })).toBeInTheDocument();

    const countries = chart('Countries');
    expect(countries.getByText('Of failed sign-ins.')).toBeInTheDocument();
    expect(rowsOf(countries.getByRole('table'))).toEqual([
      ['ES', '10'],
      ['PT', '2'],
    ]);
    expect(countries.getByRole('columnheader', { name: 'Country' })).toBeInTheDocument();
    expect(screen.queryByText(/IP geolocation files/)).not.toBeInTheDocument();

    const heatmap = chart('When failed sign-ins happen');
    expect(heatmap.getByText('By day of the week and hour, UTC.')).toBeInTheDocument();
    expect(
      heatmap.getByRole('img', { name: 'When failed sign-ins happen: busiest hour 5' }),
    ).toBeInTheDocument();
    expect(rowsOf(heatmap.getByRole('table'))).toEqual([
      ['Mon', '09:00', '5'],
      ['Sat', '23:00', '1'],
    ]);

    const anomalies = within(screen.getByRole('region', { name: 'Open anomalies' }));
    const items = anomalies.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'high brute force 2 open',
      'critical impossible travel 1 open',
    ]);
    expect(within(items[0]!).getByText('high')).toHaveClass('sev-high');
    expect(anomalies.getByRole('link', { name: 'brute force' })).toHaveAttribute(
      'href',
      `/alerts?appId=${SHOP}&rule=brute_force`,
    );
    expect(anomalies.getByRole('link', { name: 'impossible travel' })).toHaveAttribute(
      'href',
      `/alerts?appId=${SHOP}&rule=impossible_travel`,
    );
  });

  it('reads the application and the period from the URL, and writes changes to it', async () => {
    const { asked } = withApi();
    const router = renderRoute(`/security?appId=${BLOG}&days=30`);
    await loaded();
    expect(screen.getByLabelText('Application')).toHaveValue(BLOG);
    expect(screen.getByLabelText('Period')).toHaveValue('30');
    expect(asked()).toEqual([`${BLOG}?days=30`]);
    expect(screen.getByRole('link', { name: 'brute force' })).toHaveAttribute(
      'href',
      `/alerts?appId=${BLOG}&rule=brute_force`,
    );

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Period'), '90');
    await vi.waitFor(() => {
      expect(searchOf(router)).toEqual({ appId: BLOG, days: '90' });
    });
    await vi.waitFor(() => {
      expect(asked()).toEqual([`${BLOG}?days=30`, `${BLOG}?days=90`]);
    });

    await user.selectOptions(await screen.findByLabelText('Application'), SHOP);
    await vi.waitFor(() => {
      expect(searchOf(router)).toEqual({ appId: SHOP, days: '90' });
    });
    await vi.waitFor(() => {
      expect(asked()).toEqual([`${BLOG}?days=30`, `${BLOG}?days=90`, `${SHOP}?days=90`]);
    });
    expect(await screen.findByRole('link', { name: 'brute force' })).toHaveAttribute(
      'href',
      `/alerts?appId=${SHOP}&rule=brute_force`,
    );
  });

  it('falls back to the first application and 7 days for values it does not offer', async () => {
    const { asked } = withApi();
    renderRoute(`/security?appId=${HUB}&days=5`);
    await loaded();
    expect(screen.getByLabelText('Application')).toHaveValue(SHOP);
    expect(screen.getByLabelText('Period')).toHaveValue('7');
    expect(asked()).toEqual([`${SHOP}?days=7`]);
  });

  it('says what is empty, and that countries need the geolocation files', async () => {
    withApi({ [securityOf(SHOP)]: () => ok(quiet(SHOP)) });
    renderRoute('/security');
    await loaded();

    expect(
      chart('Failed sign-ins').getByRole('img', { name: 'Failed sign-ins: 0 in total, at most 1' }),
    ).toBeInTheDocument();
    expect(
      chart('Addresses with the most failed sign-ins').getByText('No failed sign-ins.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Countries', { selector: 'strong' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Countries need the IP geolocation files (docs/deploy-vps.md#ip-geolocation).',
      ),
    ).toBeInTheDocument();
    expect(chart('When failed sign-ins happen').getByText('No activity.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Open anomalies' })).getByText('None open.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['only its own log', [hub]],
    ['none at all', []],
  ])('has nothing to show when the person sees %s', async (_case, items) => {
    const { asked } = withApi({ [APPS]: () => ok({ items }) });
    renderRoute('/security');
    expect(await screen.findByText('No application to show yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Application')).not.toBeInTheDocument();
    expect(asked()).toEqual([]);
  });

  it('explains when the applications cannot be listed, and retries', async () => {
    let attempt = 0;
    withApi({ [APPS]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(apps)) });
    renderRoute('/security');
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await loaded()).toBeInTheDocument();
  });

  it('explains when the overview fails, and retries it', async () => {
    let attempt = 0;
    const { asked } = withApi({
      [securityOf(SHOP)]: () => (attempt++ === 0 ? failure(404, 'No such app') : ok(quiet(SHOP))),
    });
    renderRoute('/security');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    // The pickers stay, to choose another one.
    expect(screen.getByLabelText('Application')).toHaveValue(SHOP);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await loaded()).toBeInTheDocument();
    expect(asked()).toEqual([`${SHOP}?days=7`, `${SHOP}?days=7`]);
  });
});
