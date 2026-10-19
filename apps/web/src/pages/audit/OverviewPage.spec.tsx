import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { formatDateTime } from '../../audit/format';
import type { Overview, ResponseAction } from '../../audit/types';
import { admin } from '../../test/fixtures';
import { deferred, failure, json, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

const OVERVIEW = 'GET /api/overview';
const REQUEST = 'POST /api/response-actions';
const STEP_UP = 'POST /api/account/step-up';
const SINCE = '2026-10-14T09:00:00.000Z';
const VERIFIED = '2026-10-15T07:00:00.000Z';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });

const auditor: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000003',
  email: 'auditor@example.com',
  name: 'Auditor',
  role: 'auditor',
};

const SHOP = '0190b6a1-0000-7000-8000-0000000000a1';
const BLOG = '0190b6a1-0000-7000-8000-0000000000a2';
const HEARTBEAT = '2026-10-15T08:30:00.000Z';

const busy: Overview['apps'][number] = {
  appId: SHOP,
  slug: 'shop',
  name: 'Shop',
  status: 'active',
  events24h: 12_345,
  highRisk24h: 3,
  rejected24h: 7,
  // Shown by severity, most severe first; zeros are left out.
  openAlerts: { low: 4, critical: 2, high: 0, info: 1 },
  lastHeartbeatAt: HEARTBEAT,
  queueSize: 1_500,
  openGaps: 3,
  trend: [1, 5, 2, 9],
};

const quiet: Overview['apps'][number] = {
  appId: BLOG,
  slug: 'blog',
  name: 'Blog',
  status: 'paused',
  events24h: 0,
  highRisk24h: 0,
  rejected24h: 0,
  openAlerts: {},
  lastHeartbeatAt: null,
  queueSize: 0,
  openGaps: 0,
  trend: [],
};

const overview = (
  apps: Overview['apps'],
  integrity: Overview['integrity'] = { outcome: 'passed', finishedAt: VERIFIED },
): Overview => ({ since: SINCE, integrity, apps });

const requested = (status: ResponseAction['status']): ResponseAction => ({
  id: '0190b6a1-0000-7000-8000-0000000000c1',
  appId: SHOP,
  subject: 'user-42',
  action: 'revoke_sessions',
  reason: 'Account takeover suspected',
  status,
  alertId: null,
  requestedById: admin.id,
  approvedById: null,
  approvedAt: null,
  expiresAt: '2026-10-16T09:30:00.000Z',
  completedAt: null,
  createdAt: '2026-10-15T09:30:00.000Z',
});

async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
  await user.type(within(dialog).getByLabelText('Code'), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

const card = (name: string) => screen.findByRole('article', { name });

const signedInAs = (user: AuthUser) => {
  setSession({ accessToken: 'token-1', expiresIn: 900, user });
};

/** The value next to a label in a card's description list. */
function fact(card: HTMLElement, label: string) {
  const term = within(card).getByText(label, { selector: 'dt' });
  return term.nextElementSibling as HTMLElement;
}

beforeEach(() => {
  resetForTests();
  signedInAs(admin);
});
afterEach(() => {
  resetForTests();
});

describe('OverviewPage', () => {
  it('says it is loading until the overview arrives', async () => {
    const held = deferred<Response>();
    stubFetch({ [OVERVIEW]: () => held.promise });
    renderRoute('/');
    expect(await screen.findByText('Loading the overview…')).toBeInTheDocument();
    held.resolve(ok(overview([quiet])));
    expect(await screen.findByRole('article', { name: 'Blog' })).toBeInTheDocument();
  });

  it('shows a card per application: activity, alerts by severity, ingestion health', async () => {
    const { calls } = stubFetch({ [OVERVIEW]: () => ok(overview([busy, quiet])) });
    renderRoute('/');

    const shop = await screen.findByRole('article', { name: 'Shop' });
    expect(within(shop).getByRole('heading', { level: 3, name: 'Shop' })).toBeInTheDocument();
    expect(within(shop).getByText('active')).toHaveClass('badge', 'status-active');
    expect(fact(shop, 'Events, 24 h')).toHaveTextContent('12,345');
    expect(
      within(shop).getByRole('img', {
        name: 'Events per hour, last 24 hours: 17 in total, at most 9',
      }),
    ).toBeInTheDocument();
    expect(fact(shop, 'High risk, 24 h')).toHaveTextContent(/^3$/);
    expect(fact(shop, 'Rejected, 24 h')).toHaveTextContent(/^7$/);
    const alerts = fact(shop, 'Open alerts');
    expect(alerts).toHaveTextContent('critical 2 low 4 info 1');
    expect(within(alerts).getByText('critical')).toHaveClass('sev-critical');
    expect(within(alerts).queryByText('high')).not.toBeInTheDocument();
    expect(fact(shop, 'Last heartbeat')).toHaveTextContent(formatDateTime(HEARTBEAT));
    expect(fact(shop, 'Connector queue')).toHaveTextContent('1,500');
    const gaps = fact(shop, 'Missing events');
    expect(gaps).toHaveTextContent('3 open gaps');
    expect(gaps).toHaveClass('outcome-failure');
    expect(within(shop).getByRole('link', { name: 'Events' })).toHaveAttribute(
      'href',
      `/events?appId=${SHOP}`,
    );
    expect(within(shop).getByRole('link', { name: 'Security' })).toHaveAttribute(
      'href',
      `/security?appId=${SHOP}`,
    );
    expect(within(shop).getByRole('link', { name: 'Alerts' })).toHaveAttribute(
      'href',
      `/alerts?appId=${SHOP}`,
    );

    const blog = screen.getByRole('article', { name: 'Blog' });
    expect(within(blog).getByText('paused')).toHaveClass('status-paused');
    expect(fact(blog, 'Events, 24 h')).toHaveTextContent(/^0$/);
    expect(
      within(blog).getByRole('img', {
        name: 'Events per hour, last 24 hours: 0 in total, at most 1',
      }),
    ).toBeInTheDocument();
    expect(fact(blog, 'Open alerts')).toHaveTextContent(/^none$/);
    expect(fact(blog, 'Last heartbeat')).toHaveTextContent('—');
    const noGaps = fact(blog, 'Missing events');
    expect(noGaps).toHaveTextContent(/^none$/);
    expect(noGaps).not.toHaveClass('outcome-failure');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('sums up first: the log verified, the open alerts by severity, the high-risk events of 24 hours', async () => {
    stubFetch({ [OVERVIEW]: () => ok(overview([busy, { ...quiet, openAlerts: { low: 1 } }])) });
    renderRoute('/');

    const integrity = await card('Log integrity');
    expect(within(integrity).getByText('Verified')).toHaveClass('stat', 'outcome-success');
    expect(
      within(integrity).getByText(`Last verification ${formatDateTime(VERIFIED)}.`),
    ).toBeInTheDocument();
    expect(within(integrity).getByRole('link', { name: 'Integrity' })).toHaveAttribute(
      'href',
      '/integrity',
    );

    const alerts = await card('Open alerts');
    expect(within(alerts).getByText('8')).toHaveClass('stat', 'outcome-failure');
    expect(within(alerts).getByText('critical')).toHaveClass('sev-critical');
    expect(alerts).toHaveTextContent('critical 2low 5info 1');
    expect(within(alerts).getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts');

    // Its link finds the very events counted: the same 24 hours, the same risk.
    const risk = await card('High-risk events, 24 h');
    expect(within(risk).getByText('3')).toHaveClass('stat', 'outcome-denied');
    expect(within(risk).getByText('Risk score 60 or more.')).toBeInTheDocument();
    expect(within(risk).getByRole('link', { name: 'See them' })).toHaveAttribute(
      'href',
      `/events?from=${encodeURIComponent(SINCE)}&minRisk=60`,
    );
  });

  it.each([
    [
      { outcome: 'failed', finishedAt: VERIFIED } as const,
      'Failed',
      'outcome-failure',
      /found the log changed/,
    ],
    [
      { outcome: 'error', finishedAt: VERIFIED } as const,
      'Not finished',
      'outcome-denied',
      /could not finish/,
    ],
    [null, 'Not verified yet', 'muted', null],
  ])('says the integrity of the log as it is: %o', async (integrity, shown, className, why) => {
    signedInAs(auditor);
    stubFetch({ [OVERVIEW]: () => ok(overview([quiet], integrity)) });
    renderRoute('/');
    const figure = await card('Log integrity');
    expect(within(figure).getByText(shown)).toHaveClass('stat', className);
    if (why !== null) expect(within(figure).getByText(why)).toBeInTheDocument();
    // The integrity page is for administrators.
    expect(within(figure).queryByRole('link')).toBeNull();
  });

  it('shows nothing to worry about as plain zeros', async () => {
    stubFetch({ [OVERVIEW]: () => ok(overview([quiet])) });
    renderRoute('/');
    expect(within(await card('Open alerts')).getByText('0')).not.toHaveClass('outcome-failure');
    expect(within(await card('High-risk events, 24 h')).getByText('0')).not.toHaveClass(
      'outcome-denied',
    );
  });

  describe('quick response actions', () => {
    const region = () => screen.findByRole('region', { name: 'Respond quickly' });

    it('are for administrators, on applications in service', async () => {
      signedInAs(auditor);
      stubFetch({ [OVERVIEW]: () => ok(overview([busy])) });
      renderRoute('/');
      await card('Shop');
      expect(screen.queryByRole('region', { name: 'Respond quickly' })).toBeNull();
    });

    it('are not offered without an application in service', async () => {
      stubFetch({ [OVERVIEW]: () => ok(overview([quiet])) });
      renderRoute('/');
      await card('Blog');
      expect(screen.queryByRole('region', { name: 'Respond quickly' })).toBeNull();
    });

    it('check the user and the reason before asking anything', async () => {
      const { calls } = stubFetch({ [OVERVIEW]: () => ok(overview([busy, quiet])) });
      renderRoute('/');
      const scope = within(await region());
      // Only the applications in service are offered.
      expect(
        within(scope.getByLabelText('Application'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Shop']);
      const user = userEvent.setup();
      await user.type(scope.getByLabelText('User id'), 'bad id!');
      await user.type(scope.getByLabelText('Reason'), 'short');
      await user.click(scope.getByRole('button', { name: 'Revoke sessions' }));
      expect(scope.getByLabelText('User id')).toHaveAttribute('aria-invalid', 'true');
      expect(scope.getByText("Enter the user's id in that application.")).toBeInTheDocument();
      expect(scope.getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
      expect(callsTo(calls, REQUEST)).toHaveLength(0);
    });

    it.each([
      ['Revoke sessions', 'revoke_sessions'],
      ['Force a password change', 'require_password_change'],
      ['Disable the account', 'disable_account'],
    ])('%s: confirms who is asking, then requests it', async (button, action) => {
      let attempt = 0;
      const { calls } = stubFetch({
        [OVERVIEW]: () => ok(overview([busy])),
        [REQUEST]: () =>
          attempt++ === 0
            ? reauthenticate()
            : json(201, { data: requested('pending_approval'), message: 'Created' }),
        [STEP_UP]: () => session('token-2', admin),
      });
      renderRoute('/');
      const scope = within(await region());
      const user = userEvent.setup();
      await user.type(scope.getByLabelText('User id'), ' user-42 ');
      await user.type(scope.getByLabelText('Reason'), '  Account takeover suspected ');
      await user.click(scope.getByRole('button', { name: button }));
      await confirmItIsYou(user);

      expect(await scope.findByRole('status')).toHaveTextContent(
        'Requested: another administrator approves it under Response actions.',
      );
      expect(scope.getByLabelText('User id')).toHaveValue('');
      expect(scope.getByLabelText('Reason')).toHaveValue('');
      const sent = callsTo(calls, REQUEST);
      expect(sent).toHaveLength(2);
      await expect(sent[1]?.json()).resolves.toEqual({
        appId: SHOP,
        subject: 'user-42',
        action,
        reason: 'Account takeover suspected',
      });
      expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');
    });

    it.each([
      [
        json(201, { data: requested('dispatched'), message: 'Created' }),
        /^Requested: dispatched\.$/,
      ],
      [failure(409, 'Not accepted'), /does not accept this action, or has no webhook URL/],
      [failure(500, 'Boom'), /The service is unavailable/],
    ])('says what became of it', async (answer, shown) => {
      stubFetch({ [OVERVIEW]: () => ok(overview([busy])), [REQUEST]: () => answer });
      renderRoute('/');
      const scope = within(await region());
      const user = userEvent.setup();
      await user.type(scope.getByLabelText('User id'), 'user-42');
      await user.type(scope.getByLabelText('Reason'), 'Account takeover suspected');
      await user.click(scope.getByRole('button', { name: 'Disable the account' }));
      expect(await scope.findByText(shown)).toBeInTheDocument();
    });

    it('requests nothing when the step-up is cancelled', async () => {
      const { calls } = stubFetch({
        [OVERVIEW]: () => ok(overview([busy])),
        [REQUEST]: reauthenticate,
      });
      renderRoute('/');
      const scope = within(await region());
      const user = userEvent.setup();
      await user.type(scope.getByLabelText('User id'), 'user-42');
      await user.type(scope.getByLabelText('Reason'), 'Account takeover suspected');
      await user.click(scope.getByRole('button', { name: 'Revoke sessions' }));
      const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(await scope.findByRole('alert')).toHaveTextContent(
        'Nothing was requested: it needs you to confirm it is you.',
      );
      expect(callsTo(calls, REQUEST)).toHaveLength(1);
    });
  });

  it('offers an administrator to register the first application', async () => {
    stubFetch({ [OVERVIEW]: () => ok(overview([])) });
    renderRoute('/');
    expect(await screen.findByText(/No application sends its audit log yet\./)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Register an application' })).toHaveAttribute(
      'href',
      '/apps/new',
    );
    expect(
      within(screen.getByRole('region', { name: 'Applications' })).queryByRole('article'),
    ).not.toBeInTheDocument();
  });

  it('tells anyone else to ask an administrator', async () => {
    signedInAs(auditor);
    stubFetch({ [OVERVIEW]: () => ok(overview([])) });
    renderRoute('/');
    expect(
      await screen.findByText('No application is assigned to you yet: ask an administrator.'),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Register an application' })).not.toBeInTheDocument();
  });

  it('explains a failure and loads again on retry', async () => {
    let attempt = 0;
    const { calls } = stubFetch({
      [OVERVIEW]: () =>
        attempt++ === 0 ? failure(503, 'Database unreachable') : ok(overview([busy])),
    });
    renderRoute('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The service is unavailable. Try again later.',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('article', { name: 'Shop' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });
});
