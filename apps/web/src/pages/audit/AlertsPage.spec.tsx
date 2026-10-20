import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetVisibleApps } from '../../audit/apps';
import { formatDateTime, toLocalInput } from '../../audit/format';
import { resetLiveForTests, startLive } from '../../audit/live/stream';
import type { Alert, AlertPage, VisibleApps } from '../../audit/types';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { alertDetail, alertRow, liveFeed } from '../../test/alerts';
import { eventSummary } from '../../test/events';
import { admin } from '../../test/fixtures';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// The alert center: its filters, search and order live in the URL, it pages
// by offset, it reloads quietly when the live stream hears a change, and each
// row links to the alert and to the user it is about, named, says whether it
// was escalated or is silenced, with the alert's whole detail in a drawer.

const LIST = 'GET /api/alerts';
const DETAIL = 'GET /api/alerts/0190b6a1-0000-7000-8000-0000000000b1';
const APPS = 'GET /api/account/apps';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const OTHER_APP_ID = '0190b6a1-0000-7000-8000-0000000000a2';
const HUB_ID = '0190b6a1-0000-7000-8000-0000000000a0';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;

const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000005',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const visible: VisibleApps = {
  items: [
    {
      appId: APP_ID,
      slug: 'shop',
      name: 'Shop',
      environment: 'production',
      status: 'active',
      system: false,
    },
    {
      appId: OTHER_APP_ID,
      slug: 'shop-staging',
      name: 'Shop',
      environment: 'staging',
      status: 'active',
      system: false,
    },
    {
      appId: HUB_ID,
      slug: 'audit-hub',
      name: 'Audit Hub',
      environment: 'production',
      status: 'active',
      system: true,
    },
  ],
};

const alert = (overrides: Partial<Alert> = {}): Alert => ({
  id: '0190b6a1-0000-7000-8000-0000000000b1',
  appId: APP_ID,
  appSlug: 'shop',
  rule: 'brute_force',
  severity: 'high',
  status: 'open',
  subject: 'user-42',
  subjectLabel: null,
  title: 'Many failed sign-ins',
  occurrences: 1234,
  firstSeenAt: '2026-10-14T08:00:00.000Z',
  lastSeenAt: '2026-10-15T09:30:00.000Z',
  assigneeId: null,
  resolvedAt: null,
  resolvedById: null,
  acknowledgedAt: null,
  acknowledgedById: null,
  escalations: 0,
  lastEscalatedAt: null,
  mutedUntil: null,
  createdAt: '2026-10-14T08:00:00.000Z',
  updatedAt: '2026-10-15T09:30:00.000Z',
  version: 1,
  ...overrides,
});

const page = (items: Alert[], total = items.length): AlertPage => ({ items, total });

function stub(list: (request: Request) => Response | Promise<Response>) {
  return stubFetch({ [APPS]: () => ok(visible), [LIST]: list });
}

const listCalls = (calls: Request[]) => calls.filter((call) => routeOf(call) === LIST);
const queryOf = (request: Request | undefined) => new URL(request?.url ?? '').searchParams;

beforeEach(() => {
  resetForTests();
  forgetVisibleApps();
  setSession({ accessToken: 'admin-token', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetLiveForTests();
  resetForTests();
});

describe('AlertsPage', () => {
  it('lists the alerts, each linked to its detail and to the user it is about', async () => {
    const { calls } = stub(() =>
      ok(
        page([
          alert(),
          alert({
            id: '0190b6a1-0000-7000-8000-0000000000b2',
            title: 'A new country',
            severity: 'medium',
            status: 'in_review',
            subject: null,
          }),
          // Values the page cannot trust as links stay text.
          alert({ id: 'not-a-uuid', title: 'Odd alert', subject: 'not an id' }),
        ]),
      ),
    );
    renderRoute('/alerts');

    const title = await screen.findByRole('link', { name: 'Many failed sign-ins' });
    expect(title).toHaveAttribute('href', '/alerts/0190b6a1-0000-7000-8000-0000000000b1');
    expect(screen.getByRole('link', { name: 'user-42' })).toHaveAttribute(
      'href',
      `/apps/${APP_ID}/actors/user-42`,
    );
    expect(screen.queryByRole('link', { name: 'Odd alert' })).toBeNull();
    expect(screen.getByText('Odd alert')).toBeInTheDocument();
    expect(screen.getByText('not an id')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'not an id' })).toBeNull();

    const second = screen.getByRole('row', { name: /A new country/ });
    expect(within(second).getByText('—')).toBeInTheDocument();
    expect(within(second).getByText('in review')).toHaveClass('badge', 'status-in_review');
    expect(within(second).getByText('medium')).toHaveClass('badge', 'sev-medium');
    const first = screen.getByRole('row', { name: /Many failed sign-ins/ });
    expect(within(first).getByText('1,234')).toBeInTheDocument();
    expect(within(first).getByText(formatDateTime('2026-10-15T09:30:00.000Z'))).toBeInTheDocument();

    const query = queryOf(listCalls(calls)[0]);
    expect(query.get('limit')).toBe('25');
    expect(query.get('offset')).toBe('0');
    expect(query.has('status')).toBe(false);
    // Its own log is never an option: alerts are about applications.
    const picker = screen.getByRole('combobox', { name: 'Application' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every application', 'Shop (production)', 'Shop (staging)']);
  });

  it('names who each alert is about, then their id', async () => {
    stub(() => ok(page([alert({ subjectLabel: 'Ann Example' })])));
    renderRoute('/alerts');

    const row = await screen.findByRole('row', { name: /Many failed sign-ins/ });
    expect(within(row).getByText('Ann Example')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'user-42' })).toHaveAttribute(
      'href',
      `/apps/${APP_ID}/actors/user-42`,
    );
  });

  it("opens an alert's whole detail in a drawer, then gives the focus back", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      eventSummary({
        id: `0190b6a1-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
        description: index === 1 ? null : 'Signed in.',
        action: 'auth.sign_in',
        outcome: 'failure',
        actor:
          index === 2
            ? { type: 'user', id: 'user-7', role: null, label: null }
            : index === 3
              ? { type: 'system', id: null, role: null, label: null }
              : { type: 'user', id: 'user-42', role: null, label: 'Ann Example' },
      }),
    );
    const { calls } = stubFetch({
      [APPS]: () => ok(visible),
      [LIST]: () => ok(page([alert(), alert({ id: 'not-a-uuid', title: 'Odd alert' })])),
      [DETAIL]: () => ok(alertDetail({ events: [...many, eventSummary({ id: 'not-a-uuid' })] })),
    });
    renderRoute('/alerts');
    const user = userEvent.setup();

    const row = await screen.findByRole('row', { name: /Many failed sign-ins/ });
    // No detail for an alert whose id the page cannot trust.
    expect(within(screen.getByRole('row', { name: /Odd alert/ })).queryByRole('button')).toBeNull();
    const open = within(row).getByRole('button', {
      name: `View details Many failed sign-ins ${formatDateTime('2026-10-15T09:30:00.000Z')}`,
    });
    await user.click(open);

    const drawer = await screen.findByRole('dialog', { name: 'Alert detail' });
    expect(
      await within(drawer).findByRole('heading', { name: 'Many failed sign-ins', level: 3 }),
    ).toBeInTheDocument();
    expect(calls.filter((call) => routeOf(call) === DETAIL)).toHaveLength(1);
    expect(within(drawer).getByRole('link', { name: 'Open as a page' })).toHaveAttribute(
      'href',
      '/alerts/0190b6a1-0000-7000-8000-0000000000b1',
    );
    expect(within(drawer).getByRole('region', { name: 'Why it fired' })).toHaveTextContent(
      '12 failed sign-ins of Ann Example (user-42) within 15 minutes.',
    );
    expect(within(drawer).getByRole('region', { name: 'What the events show' })).toHaveTextContent(
      'invalid credentials × 1, mfa failed × 1',
    );
    // Nothing to change from here: that is on its page.
    expect(within(drawer).queryByRole('heading', { name: 'Review' })).toBeNull();

    // The first events, each linked to its page, then how many more.
    const events = within(within(drawer).getByRole('region', { name: 'Events behind it' }));
    const items = events.getAllByRole('listitem');
    expect(items).toHaveLength(10);
    expect(items[0]).toHaveTextContent(/· Ann Example · Signed in\. failure$/);
    expect(within(items[0]!).getByRole('link')).toHaveAttribute(
      'href',
      `/events/${many[0]?.id ?? ''}`,
    );
    expect(items[1]).toHaveTextContent(/· auth\.sign_in failure$/);
    expect(items[2]).toHaveTextContent('· user-7 ·');
    expect(items[3]).toHaveTextContent('· system ·');
    expect(events.getByText(/^3 more:/)).toBeInTheDocument();
    expect(events.getByRole('link', { name: 'open the alert as a page' })).toHaveAttribute(
      'href',
      '/alerts/0190b6a1-0000-7000-8000-0000000000b1',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  });

  it('lists every event of an alert with few in its drawer, an odd id as text', async () => {
    stubFetch({
      [APPS]: () => ok(visible),
      [LIST]: () => ok(page([alert()])),
      [DETAIL]: () => ok(alertDetail()),
    });
    renderRoute('/alerts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^View details/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Alert detail' });
    const events = within(await within(drawer).findByRole('region', { name: 'Events behind it' }));
    expect(events.getAllByRole('listitem')).toHaveLength(2);
    expect(events.getAllByRole('link')).toHaveLength(1);
    expect(events.queryByText(/more:/)).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks with the filters of the URL, empty ones left out, and shows them', async () => {
    const { calls } = stub(() => ok(page([alert()], 60)));
    renderRoute(`/alerts?appId=${APP_ID}&status=open&severity=high&rule=brute_force&offset=25`);

    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    const query = queryOf(listCalls(calls)[0]);
    expect(Object.fromEntries(query)).toEqual({
      appId: APP_ID,
      status: 'open',
      severity: 'high',
      rule: 'brute_force',
      limit: '25',
      offset: '25',
    });
    expect(screen.getByLabelText('Status')).toHaveValue('open');
    expect(screen.getByLabelText('Severity')).toHaveValue('high');
    expect(screen.getByLabelText('Rule')).toHaveValue('brute_force');
    expect(await screen.findByRole('combobox', { name: 'Application' })).toHaveValue(APP_ID);
    expect(screen.getByText('26–50 of 60')).toBeInTheDocument();
  });

  it('drops an empty filter and a wrong offset', async () => {
    const { calls } = stub(() => ok(page([alert()])));
    renderRoute('/alerts?rule=&offset=nope');

    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    expect(Object.fromEntries(queryOf(listCalls(calls)[0]))).toEqual({
      limit: '25',
      offset: '0',
    });
  });

  it('never asks with a negative offset', async () => {
    const { calls } = stub(() => ok(page([alert()])));
    renderRoute('/alerts?offset=-50');

    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    expect(queryOf(listCalls(calls)[0]).get('offset')).toBe('0');
  });

  it('puts the filters in the URL, back on the first page, and asks again', async () => {
    const { calls } = stub(() => ok(page([alert()], 60)));
    const router = renderRoute(`/alerts?appId=${APP_ID}&rule=brute_force&offset=25`);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Application' }),
      'Every application',
    );
    await user.selectOptions(screen.getByLabelText('Status'), 'false positive');
    await user.selectOptions(screen.getByLabelText('Severity'), 'critical');
    await user.clear(screen.getByLabelText('Rule'));
    await user.click(screen.getByRole('button', { name: 'Filter' }));

    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?status=false_positive&severity=critical');
    });
    await vi.waitFor(() => {
      expect(listCalls(calls)).toHaveLength(2);
    });
    expect(Object.fromEntries(queryOf(listCalls(calls)[1]))).toEqual({
      status: 'false_positive',
      severity: 'critical',
      limit: '25',
      offset: '0',
    });
  });

  it('searches, bounds the time, picks silenced ones and sorts, all in the URL', async () => {
    const { calls } = stub(() => ok(page([alert()])));
    const router = renderRoute('/alerts');
    const user = userEvent.setup();

    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    await user.type(screen.getByLabelText('Search'), 'user-42');
    await user.selectOptions(screen.getByLabelText('Status'), 'Unresolved');
    await user.type(
      screen.getByLabelText('Last seen from'),
      toLocalInput('2026-10-14T08:00:00.000Z'),
    );
    await user.selectOptions(screen.getByLabelText('Silenced'), 'Not silenced');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Severity');
    await user.selectOptions(screen.getByLabelText('Order'), 'Oldest or least serious first');
    await user.click(screen.getByRole('button', { name: 'Filter' }));

    await vi.waitFor(() => {
      expect(listCalls(calls)).toHaveLength(2);
    });
    expect(Object.fromEntries(queryOf(listCalls(calls)[1]))).toEqual({
      status: 'open,in_review',
      q: 'user-42',
      from: '2026-10-14T08:00:00.000Z',
      muted: 'false',
      sort: 'severity',
      order: 'asc',
      limit: '25',
      offset: '0',
    });
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('user-42');
    // The defaults stay out of the URL.
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Last seen');
    await user.selectOptions(screen.getByLabelText('Order'), 'Newest or most serious first');
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await vi.waitFor(() => {
      expect(router.state.location.search).not.toMatch(/sort|order/);
    });
  });

  it('says which alerts were escalated unacknowledged and which a silence covers', async () => {
    stub(() =>
      ok(
        page([
          alert({ escalations: 2 }),
          alert({
            id: '0190b6a1-0000-7000-8000-0000000000b2',
            title: 'A new country',
            mutedUntil: new Date(Date.now() + 3_600_000).toISOString(),
          }),
          alert({
            id: '0190b6a1-0000-7000-8000-0000000000b3',
            title: 'Silence over',
            mutedUntil: new Date(Date.now() - 60_000).toISOString(),
          }),
        ]),
      ),
    );
    renderRoute('/alerts');

    const escalated = await screen.findByRole('row', { name: /Many failed sign-ins/ });
    expect(within(escalated).getByText('Escalated × 2')).toBeInTheDocument();
    const silenced = screen.getByRole('row', { name: /A new country/ });
    expect(within(silenced).getByText('Silenced')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Silence over/ })).queryByText('Silenced'),
    ).toBeNull();
  });

  it('reloads quietly when the live stream hears a change: what is shown stays meanwhile', async () => {
    const feed = liveFeed();
    const { calls } = stubFetch({
      [APPS]: () => ok(visible),
      [LIST]: () => ok(page([alert()])),
      'GET /api/alerts/stream': () => feed.response(),
    });
    renderRoute('/alerts');
    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    startLive();
    feed.send('ready', {});
    const changed = alertRow({ status: 'in_review' });
    feed.send('alert', { alert: changed, replay: false }, `${changed.updatedAt}|${changed.id}`);

    await vi.waitFor(
      () => {
        expect(listCalls(calls)).toHaveLength(2);
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole('link', { name: 'Many failed sign-ins' })).toBeInTheDocument();
  });

  it('pages through the alerts, keeping the filters', async () => {
    const { calls } = stub(() => ok(page([alert()], 60)));
    const router = renderRoute('/alerts?status=open');
    const user = userEvent.setup();

    await screen.findByText('1–25 of 60');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?status=open&offset=25');
    });
    await screen.findByText('26–50 of 60');
    expect(queryOf(listCalls(calls).at(-1)).get('offset')).toBe('25');

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?status=open');
    });
    await screen.findByText('1–25 of 60');
  });

  it('says when no alert matches', async () => {
    stub(() => ok(page([])));
    renderRoute('/alerts?status=resolved');
    expect(await screen.findByText('No alerts match.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stub(() => (attempt++ === 0 ? failure(400, 'severity: invalid value') : ok(page([alert()]))));
    renderRoute('/alerts');

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted data');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Many failed sign-ins' })).toBeInTheDocument();
  });

  it('filters without the application picker when the applications could not be loaded', async () => {
    stubFetch({
      [APPS]: () => failure(503, 'Unavailable'),
      [LIST]: () => ok(page([alert()])),
    });
    renderRoute('/alerts');

    await screen.findByRole('link', { name: 'Many failed sign-ins' });
    expect(screen.queryByRole('combobox', { name: 'Application' })).toBeNull();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('is open to viewers', async () => {
    setSession({ accessToken: 'viewer-token', expiresIn: 900, user: viewer });
    stub(() => ok(page([alert()])));
    renderRoute('/alerts');
    expect(await screen.findByRole('heading', { name: 'Alerts' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Many failed sign-ins' })).toBeInTheDocument();
  });
});
