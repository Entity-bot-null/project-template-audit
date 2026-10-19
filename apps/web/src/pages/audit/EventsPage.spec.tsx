import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_ERROR_MESSAGE } from '../../api/errors';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { forgetVisibleApps } from '../../audit/apps';
import type { EventPage, EventSummary, VisibleApps } from '../../audit/types';
import { admin } from '../../test/fixtures';
import { failure, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

const APPS = 'GET /api/account/apps';
const EVENTS = 'GET /api/events';
const EXPORT = 'GET /api/exports/events';
const STEP_UP = 'POST /api/account/step-up';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const queryOf = (request: Request | undefined) =>
  Object.fromEntries(new URL(request?.url ?? 'http://localhost/').searchParams);
const searchOf = (router: ReturnType<typeof renderRoute>) =>
  Object.fromEntries(new URLSearchParams(router.state.location.search));

const auditor: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000003',
  email: 'auditor@example.com',
  name: 'Auditor',
  role: 'auditor',
};
const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const SHOP = '0190b6a1-0000-7000-8000-0000000000a1';
const HUB = '0190b6a1-0000-7000-8000-0000000000a0';
const apps: VisibleApps = {
  items: [
    {
      appId: HUB,
      slug: 'audit-hub',
      name: 'Audit Hub',
      environment: 'production',
      status: 'active',
      system: true,
    },
    {
      appId: SHOP,
      slug: 'shop',
      name: 'Shop',
      environment: 'production',
      status: 'active',
      system: false,
    },
  ],
};

function summary(index: number, action: string): EventSummary {
  return {
    id: `0190b6a1-0000-7000-8000-00000000e00${String(index)}`,
    eventId: `0190b6a1-0000-7000-8000-00000000f00${String(index)}`,
    appId: SHOP,
    appSlug: 'shop',
    recordedAt: '2026-10-15T08:00:00.000Z',
    occurredAt: '2026-10-15T07:59:59.000Z',
    category: 'security',
    action,
    outcome: 'failure',
    severity: 'high',
    riskScore: 40,
    description: null,
    actor: { type: 'user', id: 'user-1', role: 'customer', label: null },
    resource: { type: 'order', id: 'ord-1' },
    requestId: 'req-1',
    httpStatus: 401,
    clientType: 'web',
    country: 'ES',
    ipScope: 'public',
  };
}
const page = (items: EventSummary[], nextCursor: string | null = null): EventPage => ({
  items,
  nextCursor,
});

// Local times, as a datetime-local field shows them.
const FROM = new Date(2026, 9, 1, 10, 0).toISOString();
const TO = new Date(2026, 9, 14, 18, 45).toISOString();

const signedInAs = (user: AuthUser) => {
  setSession({ accessToken: 'token-1', expiresIn: 900, user });
};

function withApi(handlers: Parameters<typeof stubFetch>[0] = {}) {
  const fetched = stubFetch({
    [APPS]: () => ok(apps),
    [EVENTS]: () => ok(page([summary(1, 'user.login')])),
    ...handlers,
  });
  const sent = (route: string) => fetched.calls.filter((call) => routeOf(call) === route);
  return { ...fetched, sent };
}

/** The page once its events and the application picker are there. */
async function opened(path: string) {
  const router = renderRoute(path);
  await screen.findByRole('form', { name: 'Filters' });
  await screen.findByLabelText('Application');
  await screen.findByRole('table');
  return router;
}

beforeEach(() => {
  resetForTests();
  forgetVisibleApps();
  signedInAs(admin);
});
afterEach(() => {
  resetForTests();
});

describe('EventsPage, filters', () => {
  it('reads its filters from the URL and asks the API for them, newest first', async () => {
    const { sent } = withApi();
    await opened(
      `/events?appId=${SHOP}&action=user.login&outcome=failure&severity=high&minRisk=60&category=security&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&country=&unknown=x`,
    );

    expect(queryOf(sent(EVENTS)[0])).toEqual({
      appId: SHOP,
      action: 'user.login',
      outcome: 'failure',
      severity: 'high',
      minRisk: '60',
      category: 'security',
      from: FROM,
      to: TO,
      limit: '50',
    });
    expect(screen.getByLabelText('Application')).toHaveValue(SHOP);
    expect(screen.getByRole('option', { name: 'Every application' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Audit Hub (its own log)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Action')).toHaveValue('user.login');
    expect(screen.getByLabelText('Outcome')).toHaveValue('failure');
    expect(screen.getByLabelText('Severity')).toHaveValue('high');
    expect(screen.getByLabelText('Risk')).toHaveValue('60');
    expect(screen.getByLabelText('Category')).toHaveValue('security');
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-01T10:00');
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-14T18:45');
    // None of the other filters is set: they stay folded away.
    expect(screen.getByLabelText('Actor id')).not.toBeVisible();
    expect(screen.getByRole('cell', { name: 'user.login' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAccessibleName('Newest first');
    // One page only: no pager.
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    expect(screen.queryByText(/is blocked after an erasure/)).not.toBeInTheDocument();
  });

  it('says when the person searched for is blocked after an erasure, and only then', async () => {
    withApi({ [EVENTS]: () => ok({ ...page([]), blocked: true }) });
    renderRoute('/events?actorId=user-7');
    expect(
      await screen.findByText(
        'The person searched for is blocked after an erasure in some of these applications: their events there are left out.',
      ),
    ).toHaveRole('status');
  });

  it('unfolds "More filters" when one of them is set', async () => {
    const { sent } = withApi();
    await opened('/events?actorId=user-7&clientType=ios&requestId=req-9');
    expect(screen.getByLabelText('Actor id')).toBeVisible();
    expect(screen.getByLabelText('Actor id')).toHaveValue('user-7');
    expect(screen.getByLabelText('Client')).toHaveValue('ios');
    expect(screen.getByLabelText('Request id')).toHaveValue('req-9');
    expect(screen.getByLabelText('Application')).toHaveValue('');
    expect(queryOf(sent(EVENTS)[0])).toEqual({
      actorId: 'user-7',
      clientType: 'ios',
      requestId: 'req-9',
      limit: '50',
    });
  });

  it('writes the search to the URL, leaving out the empty filters', async () => {
    const { sent } = withApi();
    const router = await opened('/events?outcome=failure');
    // A hundred characters typed: no timer between keystrokes, the same events.
    const user = userEvent.setup({ delay: null });

    await user.selectOptions(screen.getByLabelText('Application'), SHOP);
    await user.type(screen.getByLabelText('Action'), 'order.create');
    await user.selectOptions(screen.getByLabelText('Outcome'), '');
    await user.selectOptions(screen.getByLabelText('Severity'), 'critical');
    await user.selectOptions(screen.getByLabelText('Risk'), '80 or more (critical)');
    await user.selectOptions(screen.getByLabelText('Category'), 'audit_access');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01T10:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-14T18:45' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } });
    await user.click(screen.getByText('More filters'));
    await user.type(screen.getByLabelText('Actor id'), 'user-1');
    await user.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user.type(screen.getByLabelText('IP address'), '203.0.113.5');
    await user.type(screen.getByLabelText('Country'), 'ESP');
    await user.selectOptions(screen.getByLabelText('Client'), 'android');
    await user.type(screen.getByLabelText('Resource type'), 'order');
    await user.type(screen.getByLabelText('Resource id'), 'ord-1');
    await user.type(screen.getByLabelText('Request id'), 'req-1');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const expected = {
      appId: SHOP,
      from: FROM,
      category: 'audit_access',
      action: 'order.create',
      severity: 'critical',
      minRisk: '80',
      actorId: 'user-1',
      email: 'someone@example.com',
      resourceType: 'order',
      resourceId: 'ord-1',
      ip: '203.0.113.5',
      // Two letters at most.
      country: 'ES',
      clientType: 'android',
      requestId: 'req-1',
    };
    await vi.waitFor(() => {
      expect(searchOf(router)).toEqual(expected);
    });
    await vi.waitFor(() => {
      expect(sent(EVENTS)).toHaveLength(2);
    });
    expect(queryOf(sent(EVENTS)[1])).toEqual({ ...expected, limit: '50' });
    // The form is the URL's again.
    expect(await screen.findByLabelText('Severity')).toHaveValue('critical');
    expect(screen.getByLabelText('Actor id')).toBeVisible();
  });

  it('leaves a date out once its field is emptied', async () => {
    const { sent } = withApi();
    const router = await opened(
      `/events?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    expect(screen.getByLabelText('From')).toHaveValue('');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Search' }));

    await vi.waitFor(() => {
      expect(searchOf(router)).toEqual({ to: TO });
    });
    await vi.waitFor(() => {
      expect(sent(EVENTS)).toHaveLength(2);
    });
    expect(queryOf(sent(EVENTS)[1])).toEqual({ to: TO, limit: '50' });
  });

  it('clears every filter', async () => {
    const { sent } = withApi();
    const router = await opened(`/events?appId=${SHOP}&severity=high&ip=203.0.113.5`);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }));

    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    await vi.waitFor(() => {
      expect(sent(EVENTS)).toHaveLength(2);
    });
    expect(queryOf(sent(EVENTS)[1])).toEqual({ limit: '50' });
    expect(await screen.findByLabelText('Severity')).toHaveValue('');
    expect(screen.getByLabelText('IP address')).toHaveValue('');
  });

  it('asks for an application before searching by email, and sends nothing until then', async () => {
    const { sent } = withApi();
    const router = await opened('/events');
    const user = userEvent.setup();

    await user.click(screen.getByText('More filters'));
    await user.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const message = 'Choose an application: an email is searched by its pseudonym there.';
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(message);
    expect(router.state.location.search).toBe('');
    expect(sent(EVENTS)).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText('Application'), SHOP);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => {
      expect(searchOf(router)).toEqual({ appId: SHOP, email: 'someone@example.com' });
    });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(sent(EVENTS)).toHaveLength(2);
    });
  });

  it('drops the email error when the filters are cleared', async () => {
    withApi();
    await opened('/events');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    // Unfolded by the error itself.
    expect(screen.getByLabelText('Email')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'false');
  });

  it('goes to older pages with the cursor, and back to the newest', async () => {
    const { sent } = withApi({
      [EVENTS]: (request) =>
        new URL(request.url).searchParams.get('cursor') === 'cursor-2'
          ? ok(page([summary(2, 'order.cancel')]))
          : ok(page([summary(1, 'user.login')], 'cursor-2')),
    });
    const router = await opened('/events?severity=high');
    const user = userEvent.setup();

    const pager = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pager).getByRole('button', { name: 'Newest' })).toBeDisabled();
    await user.click(within(pager).getByRole('button', { name: 'Older' }));

    expect(await screen.findByRole('cell', { name: 'order.cancel' })).toBeInTheDocument();
    expect(searchOf(router)).toEqual({ severity: 'high', cursor: 'cursor-2' });
    expect(queryOf(sent(EVENTS)[1])).toEqual({ severity: 'high', cursor: 'cursor-2', limit: '50' });
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Newest' }));
    expect(await screen.findByRole('cell', { name: 'user.login' })).toBeInTheDocument();
    expect(searchOf(router)).toEqual({ severity: 'high' });
  });

  it('explains a refused search and retries it', async () => {
    let attempt = 0;
    withApi({
      [EVENTS]: () =>
        attempt++ === 0 ? failure(400, 'from: Invalid date') : ok(page([summary(1, 'user.login')])),
    });
    renderRoute('/events');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted data and try again.',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('cell', { name: 'user.login' })).toBeInTheDocument();
  });

  it('still searches when the applications cannot be listed, without the picker', async () => {
    withApi({ [APPS]: () => failure(503, 'Database unreachable') });
    renderRoute('/events');
    expect(await screen.findByRole('cell', { name: 'user.login' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Application')).not.toBeInTheDocument();
  });
});

describe('EventsPage, exports', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:http://localhost/export-1');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  let saved: { download: string; href: string }[] = [];

  beforeEach(() => {
    saved = [];
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // jsdom has no object URLs; the class stays the real one otherwise.
    class TestUrl extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', TestUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ download: this.download, href: this.getAttribute('href') ?? '' });
    });
  });

  const reauthenticate = () =>
    failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });
  const csv = (headers: Record<string, string> = {}) =>
    new Response('id,action\n1,user.login\n', {
      status: 200,
      headers: { 'content-type': 'text/csv', ...headers },
    });

  async function confirmItIsYou() {
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
    await user.type(within(dialog).getByLabelText('Code'), '123 456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  }

  it('is not offered to a viewer', async () => {
    signedInAs(viewer);
    withApi();
    await opened('/events');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export JSON Lines' })).not.toBeInTheDocument();
  });

  it('exports what the filters match after a step-up, and saves the file', async () => {
    let attempt = 0;
    const { sent } = withApi({
      [EXPORT]: () =>
        attempt++ === 0
          ? reauthenticate()
          : csv({
              'Content-Disposition': 'attachment; filename="audit-events-20261015.csv"',
              'Audit-Export-Id': '0190b6a1-0000-7000-8000-0000000000c1',
            }),
      [STEP_UP]: () => session('token-2', admin),
    });
    await opened(`/events?appId=${SHOP}&severity=high`);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));

    // Busy while the step-up is asked.
    expect(screen.getByText('Exporting…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export JSON Lines' })).toBeDisabled();
    await confirmItIsYou();

    expect(
      await screen.findByText('Exported. Its digest, to check a copy later, is under Exports.'),
    ).toHaveRole('status');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Exporting…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();

    const exports = sent(EXPORT);
    expect(exports).toHaveLength(2);
    expect(queryOf(exports[1])).toEqual({ appId: SHOP, severity: 'high', format: 'csv' });
    expect(exports[0]?.headers.get('Authorization')).toBe('Bearer token-1');
    expect(exports[1]?.headers.get('Authorization')).toBe('Bearer token-2');
    await expect(sent(STEP_UP)[0]?.json()).resolves.toEqual({
      password: 'admin-password',
      code: '123456',
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await expect(createObjectURL.mock.calls[0]?.[0].text()).resolves.toBe(
      'id,action\n1,user.login\n',
    );
    expect(saved).toEqual([
      { download: 'audit-events-20261015.csv', href: 'blob:http://localhost/export-1' },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/export-1');
    });
  });

  it('exports JSON Lines at once when the step-up is recent, named by its format', async () => {
    signedInAs(auditor);
    const { sent } = withApi({ [EXPORT]: () => csv() });
    await opened('/events?outcome=denied');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export JSON Lines' }));

    expect(
      await screen.findByText('Exported. Its digest, to check a copy later, is under Exports.'),
    ).toBeInTheDocument();
    expect(queryOf(sent(EXPORT)[0])).toEqual({ outcome: 'denied', format: 'jsonl' });
    expect(saved).toEqual([
      { download: 'audit-events.jsonl', href: 'blob:http://localhost/export-1' },
    ]);
  });

  it('exports nothing when the step-up is cancelled, and says why', async () => {
    signedInAs(auditor);
    const { sent } = withApi({ [EXPORT]: reauthenticate });
    await opened('/events');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing was exported: an export needs you to confirm it is you.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sent(EXPORT)).toHaveLength(1);
    expect(sent(STEP_UP)).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it.each([
    ['a server error', () => failure(500, 'Boom'), 'The service is unavailable. Try again later.'],
    ['a refused filter', () => failure(400, 'from: Invalid'), 'Check the highlighted data'],
    ['a plain 403', () => failure(403, 'Not allowed'), 'You do not have access to this.'],
    [
      'no network',
      () => {
        throw new TypeError('Failed to fetch');
      },
      NETWORK_ERROR_MESSAGE,
    ],
  ])('explains %s, with nothing saved', async (_case, answer, shown) => {
    const { sent } = withApi({ [EXPORT]: answer });
    await opened('/events');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sent(EXPORT)).toHaveLength(1);
    expect(saved).toEqual([]);
  });
});
