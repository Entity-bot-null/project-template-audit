import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { formatDateTime } from '../../audit/format';
import type { EventSummary, SubjectActivity } from '../../audit/types';
import { admin } from '../../test/fixtures';
import { deferred, failure, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

const auditor: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000003',
  email: 'auditor@example.com',
  name: 'Auditor',
  role: 'auditor',
};

const SHOP = '0190b6a1-0000-7000-8000-0000000000a1';
const BLOG = '0190b6a1-0000-7000-8000-0000000000a2';
const ACTOR = 'user-42';
const PATH = `/apps/${SHOP}/actors/${ACTOR}`;
const ACTIVITY = `GET /api/connected-apps/${SHOP}/subjects/${ACTOR}`;
const ERASE = `POST /api/connected-apps/${SHOP}/subjects/${ACTOR}/erasure`;
const STEP_UP = 'POST /api/account/step-up';
const FIRST = '2026-01-02T10:00:00.000Z';
const LAST = '2026-10-15T08:00:00.000Z';
const SIGN_IN = '2026-10-14T07:30:00.000Z';

const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const queryOf = (request: Request | undefined) =>
  Object.fromEntries(new URL(request?.url ?? 'http://localhost/').searchParams);
const searchOf = (router: ReturnType<typeof renderRoute>) =>
  Object.fromEntries(new URLSearchParams(router.state.location.search));

function summary(index: number, action: string): EventSummary {
  return {
    id: `0190b6a1-0000-7000-8000-00000000e00${String(index)}`,
    eventId: `0190b6a1-0000-7000-8000-00000000f00${String(index)}`,
    appId: SHOP,
    appSlug: 'shop',
    recordedAt: LAST,
    occurredAt: LAST,
    category: 'security',
    action,
    outcome: 'success',
    severity: 'info',
    riskScore: 0,
    description: null,
    actor: { type: 'user', id: ACTOR, role: 'customer', label: null },
    resource: null,
    requestId: null,
    httpStatus: 200,
    clientType: 'web',
    country: 'ES',
    ipScope: 'public',
  };
}

function activity(
  overrides: Partial<SubjectActivity['summary']> = {},
  items: EventSummary[] = [summary(1, 'user.signed_in')],
  nextCursor: string | null = null,
): SubjectActivity {
  return {
    subject: ACTOR,
    appId: SHOP,
    blockedSince: null,
    blockedThrough: null,
    summary: {
      firstSeenAt: FIRST,
      lastSeenAt: LAST,
      lastSignInAt: SIGN_IN,
      devices: 1_204,
      countries: ['ES', 'PT'],
      openAlerts: 3,
      otherApps: [],
      ...overrides,
    },
    events: { items, nextCursor },
  };
}

const signedInAs = (user: AuthUser) => {
  setSession({ accessToken: 'token-1', expiresIn: 900, user });
};

function withApi(handlers: Parameters<typeof stubFetch>[0] = {}) {
  const fetched = stubFetch({ [ACTIVITY]: () => ok(activity()), ...handlers });
  const sent = (route: string) => fetched.calls.filter((call) => routeOf(call) === route);
  return { ...fetched, sent };
}

function fact(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
}

const loaded = () => screen.findByRole('checkbox', { name: /Also in other applications/ });

beforeEach(() => {
  resetForTests();
  signedInAs(auditor);
});
afterEach(() => {
  resetForTests();
});

describe('ActorPage', () => {
  it('sums the user up, with their events newest first', async () => {
    const held = deferred<Response>();
    const { sent } = withApi({ [ACTIVITY]: () => held.promise });
    renderRoute(PATH);

    // The heading is there while the activity loads.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(`User ${ACTOR}`);
    expect(screen.getByText("Loading the user's activity…")).toBeInTheDocument();
    held.resolve(ok(activity()));
    await loaded();
    expect(screen.getByRole('link', { name: '← Events' })).toHaveAttribute('href', '/events');
    expect(fact('Application')).toHaveTextContent('shop');
    expect(fact('First seen')).toHaveTextContent(formatDateTime(FIRST));
    expect(fact('Last seen')).toHaveTextContent(formatDateTime(LAST));
    expect(fact('Last sign-in')).toHaveTextContent(formatDateTime(SIGN_IN));
    expect(fact('Devices')).toHaveTextContent('1,204');
    expect(fact('Countries')).toHaveTextContent('ES, PT');
    expect(within(fact('Open alerts')).getByRole('link', { name: '3' })).toHaveAttribute(
      'href',
      `/alerts?appId=${SHOP}`,
    );
    expect(screen.getByRole('checkbox', { name: /Also in other applications/ })).not.toBeChecked();
    expect(screen.queryByText(/^Also in:/)).not.toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Newest first' });
    expect(within(table).getByRole('cell', { name: 'user.signed_in' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Application' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();

    expect(queryOf(sent(ACTIVITY)[0])).toEqual({ limit: '50' });
    // Erasure is for administrators only.
    expect(screen.queryByRole('heading', { name: 'Right to erasure' })).not.toBeInTheDocument();
  });

  it('shows dashes for what is not known yet', async () => {
    withApi({
      [ACTIVITY]: () =>
        ok(
          activity(
            {
              firstSeenAt: null,
              lastSeenAt: null,
              lastSignInAt: null,
              devices: 0,
              countries: [],
              openAlerts: 0,
            },
            [],
          ),
        ),
    });
    renderRoute(PATH);
    await loaded();
    expect(fact('Application')).toHaveTextContent(/^—$/);
    expect(fact('First seen')).toHaveTextContent(/^—$/);
    expect(fact('Last sign-in')).toHaveTextContent(/^—$/);
    expect(fact('Devices')).toHaveTextContent(/^0$/);
    expect(fact('Countries')).toHaveTextContent(/^—$/);
    expect(fact('Open alerts')).toHaveTextContent(/^none$/);
    expect(screen.getByText('No events match.')).toBeInTheDocument();
  });

  it('looks for the user in other applications, from the URL, and links the valid ones', async () => {
    const { sent } = withApi({
      [ACTIVITY]: (request) =>
        new URL(request.url).searchParams.get('acrossApps') === 'true'
          ? ok(
              activity({
                otherApps: [
                  { appId: BLOG, slug: 'blog' },
                  { appId: 'not-a-uuid', slug: 'broken' },
                ],
              }),
            )
          : ok(activity()),
    });
    const router = renderRoute(PATH);
    const user = userEvent.setup();
    await user.click(await loaded());

    expect(await screen.findByText(/^Also in:/)).toBeInTheDocument();
    expect(searchOf(router)).toEqual({ acrossApps: 'true' });
    expect(queryOf(sent(ACTIVITY)[1])).toEqual({ limit: '50', acrossApps: 'true' });
    expect(screen.getByRole('checkbox', { name: /Also in other applications/ })).toBeChecked();
    expect(screen.getByRole('link', { name: 'blog' })).toHaveAttribute(
      'href',
      `/apps/${BLOG}/actors/${ACTOR}`,
    );
    expect(screen.queryByRole('link', { name: 'broken' })).not.toBeInTheDocument();
    expect(screen.queryByText('broken')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Also in other applications/ }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(await loaded()).not.toBeChecked();
    expect(screen.queryByText(/^Also in:/)).not.toBeInTheDocument();
  });

  it('says when the user is in no other application', async () => {
    withApi();
    renderRoute(`${PATH}?acrossApps=true`);
    expect(await loaded()).toBeChecked();
    expect(screen.getByText('Not found in another application.')).toBeInTheDocument();
  });

  it('goes to older events with the cursor, keeping the other applications, and back', async () => {
    const { sent } = withApi({
      [ACTIVITY]: (request) =>
        new URL(request.url).searchParams.get('cursor') === 'cursor-2'
          ? ok(activity({}, [summary(2, 'user.signed_up')]))
          : ok(activity({}, [summary(1, 'user.signed_in')], 'cursor-2')),
    });
    const router = renderRoute(`${PATH}?acrossApps=true`);
    const user = userEvent.setup();
    await loaded();

    expect(screen.getByRole('button', { name: 'Newest' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByRole('cell', { name: 'user.signed_up' })).toBeInTheDocument();
    expect(searchOf(router)).toEqual({ acrossApps: 'true', cursor: 'cursor-2' });
    expect(queryOf(sent(ACTIVITY)[1])).toEqual({
      limit: '50',
      cursor: 'cursor-2',
      acrossApps: 'true',
    });
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Newest' }));
    expect(await screen.findByRole('cell', { name: 'user.signed_in' })).toBeInTheDocument();
    expect(searchOf(router)).toEqual({ acrossApps: 'true' });
  });

  it('explains a failure and retries', async () => {
    let attempt = 0;
    withApi({
      [ACTIVITY]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(activity())),
    });
    renderRoute(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await loaded()).toBeInTheDocument();
  });

  it.each([
    ['an application id that is not a uuid', `/apps/shop/actors/${ACTOR}`],
    ['a user id with characters ids never have', `/apps/${SHOP}/actors/a%20b`],
  ])('answers not found for %s, without asking the API', async (_case, path) => {
    signedInAs(admin);
    const { fetchMock } = stubFetch({});
    renderRoute(path);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing to erase either.
    expect(screen.queryByRole('heading', { name: 'Right to erasure' })).not.toBeInTheDocument();
  });
});

describe('ActorPage, a user blocked after an erasure', () => {
  it('says since when and up to when, and shows only what came after', async () => {
    const blocked: SubjectActivity = {
      ...activity({ firstSeenAt: LAST, devices: 1 }),
      blockedSince: FIRST,
      blockedThrough: SIGN_IN,
    };
    withApi({ [ACTIVITY]: () => ok(blocked) });
    renderRoute(PATH);
    expect(
      await screen.findByText(
        `Blocked since ${formatDateTime(FIRST)}, after an erasure: what is kept of what occurred up to ${formatDateTime(SIGN_IN)} stays pseudonymous and is shown to nobody for this person, unless a legal hold names them; it is deleted at the end of its retention. Below, only what came after.`,
      ),
    ).toHaveRole('status');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('says nothing of a block for a user who has none', async () => {
    withApi();
    renderRoute(PATH);
    await loaded();
    expect(screen.queryByText(/^Blocked since/)).toBeNull();
  });
});

describe('ActorPage, right to erasure', () => {
  const erased = () => ok({ personalDeleted: 1_234, locationDeleted: 5, held: 2 });
  const reauthenticate = () =>
    failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });
  const RESULT =
    'Erased the personal data of 1,234 events and 5 locations; 2 kept by a legal hold. The events stay, pseudonymous.';

  beforeEach(() => {
    signedInAs(admin);
  });

  async function startErasure() {
    await screen.findByRole('heading', { name: 'Right to erasure' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Erase personal data…' }));
    return user;
  }

  it('asks for a confirmation, and can be cancelled', async () => {
    const { sent } = withApi();
    renderRoute(PATH);
    const user = await startErasure();
    expect(screen.getByRole('button', { name: 'Erase their personal data' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Erase personal data…' })).toBeInTheDocument();
    expect(sent(ERASE)).toHaveLength(0);
  });

  it('erases after a step-up, and says what was erased', async () => {
    let attempt = 0;
    const second = deferred<Response>();
    const { sent } = withApi({
      [ERASE]: () => (attempt++ === 0 ? reauthenticate() : second.promise),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(PATH);
    const user = await startErasure();
    await user.click(screen.getByRole('button', { name: 'Erase their personal data' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(screen.getByRole('button', { name: 'Erasing…' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
    await user.type(within(dialog).getByLabelText('Code'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sent(ERASE)).toHaveLength(2);
    });
    await expect(sent(ERASE)[1]?.json()).resolves.toEqual({ scope: 'personal' });
    expect(screen.getByRole('button', { name: 'Erasing…' })).toBeDisabled();
    second.resolve(erased());

    expect(await screen.findByText(RESULT)).toHaveRole('status');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Back to the first step, the result above it.
    expect(screen.getByRole('button', { name: 'Erase personal data…' })).toBeInTheDocument();
    expect(sent(ERASE)[0]?.headers.get('Authorization')).toBe('Bearer token-1');
    expect(sent(ERASE)[1]?.headers.get('Authorization')).toBe('Bearer token-2');
    await expect(sent(STEP_UP)[0]?.json()).resolves.toEqual({
      password: 'admin-password',
      code: '123456',
    });
  });

  it('erases their events too when asked, and says how many and how many follow', async () => {
    const { sent } = withApi({
      [ERASE]: () =>
        ok({
          personalDeleted: 10,
          locationDeleted: 0,
          held: 0,
          eventsDeleted: 8,
          eventsPending: 2,
        }),
    });
    renderRoute(PATH);
    const user = await startErasure();
    await user.click(screen.getByRole('radio', { name: /Their events too/ }));
    await user.click(screen.getByRole('button', { name: 'Erase their personal data and events' }));
    expect(
      await screen.findByText(
        'Erased the personal data of 10 events and 0 locations; 0 kept by a legal hold. 8 events deleted; 2 more within a day, once sealed.',
      ),
    ).toHaveRole('status');
    await expect(sent(ERASE)[0]?.json()).resolves.toEqual({ scope: 'events' });
    // Back to the personal data alone.
    await user.click(screen.getByRole('radio', { name: /Their personal data/ }));
    await user.click(screen.getByRole('button', { name: 'Erase personal data…' }));
    expect(screen.getByRole('button', { name: 'Erase their personal data' })).toBeEnabled();
  });

  it('erases nothing when the step-up is cancelled', async () => {
    const { sent } = withApi({ [ERASE]: reauthenticate });
    renderRoute(PATH);
    const user = await startErasure();
    await user.click(screen.getByRole('button', { name: 'Erase their personal data' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing was erased: erasure needs you to confirm it is you.',
    );
    expect(sent(ERASE)).toHaveLength(1);
    expect(sent(STEP_UP)).toHaveLength(0);
  });

  it('explains a failure, and clears it on the next attempt', async () => {
    let attempt = 0;
    withApi({ [ERASE]: () => (attempt++ === 0 ? failure(404, 'No such user') : erased()) });
    renderRoute(PATH);
    const user = await startErasure();
    await user.click(screen.getByRole('button', { name: 'Erase their personal data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');

    await user.click(screen.getByRole('button', { name: 'Erase personal data…' }));
    await user.click(screen.getByRole('button', { name: 'Erase their personal data' }));
    expect(await screen.findByText(RESULT)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
