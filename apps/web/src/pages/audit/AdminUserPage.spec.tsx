import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { operations } from '../../api/client';
import { formatDateTime } from '../../audit/format';
import type { ConnectedApp, UserAccess } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// One person, for administrators: their role, the applications an auditor or
// a viewer sees, a reset of their second factor, whether their account may
// sign in, and their removal. Every change after a step-up.

type Person =
  operations['UsersController_findOne']['responses'][200]['content']['application/json']['data'];

const USER_ID = '0190b6a1-0000-7000-8000-000000000007';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const STAGING_ID = '0190b6a1-0000-7000-8000-0000000000a2';
const ACCESS = `GET /api/users/${USER_ID}/access`;
const PERSON = `GET /api/users/${USER_ID}`;
const APPS = 'GET /api/connected-apps';
const ROLE = `PATCH /api/users/${USER_ID}/role`;
const ASSIGN = `PUT /api/users/${USER_ID}/apps`;
const MFA_RESET = `POST /api/users/${USER_ID}/mfa-reset`;
const STATUS = `PATCH /api/users/${USER_ID}/status`;
const REMOVE = `DELETE /api/users/${USER_ID}`;
const AT = '2026-10-16T09:00:00.000Z';
const STEP_UP = 'POST /api/account/step-up';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });
const noContent = () => new Response(null, { status: 204 });

const person: Person = {
  id: USER_ID,
  email: 'grace@example.com',
  name: 'Grace',
  role: 'viewer',
  disabledAt: null,
  removedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
};

const access = (overrides: Partial<UserAccess> = {}): UserAccess => ({
  userId: USER_ID,
  role: 'viewer',
  mfaConfirmedAt: '2026-09-02T10:00:00.000Z',
  disabledAt: null,
  removedAt: null,
  apps: [{ appId: APP_ID, slug: 'shop', name: 'Shop' }],
  ...overrides,
});

const connected = (id: string, environment: string): ConnectedApp => ({
  id,
  slug: environment === 'production' ? 'shop' : `shop-${environment}`,
  name: 'Shop',
  environment,
  status: 'active',
  webhookUrl: null,
  correlationEnabled: false,
  acceptedResponseActions: [],
  requireActionApproval: false,
  heartbeatTimeoutSec: 900,
  rateLimitPerMinute: 6000,
  createdAt: '2026-09-01T10:00:00.000Z',
  keys: [],
});

/** The access answered in turn: the first load, then each reload. */
function answers(...versions: UserAccess[]) {
  let index = 0;
  return () => ok(versions[Math.min(index++, versions.length - 1)]);
}

function stub(handlers: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    [PERSON]: () => ok(person),
    [ACCESS]: () => ok(access()),
    [APPS]: () => ok([connected(APP_ID, 'production'), connected(STAGING_ID, 'staging')]),
    ...handlers,
  });
}

async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
  await user.type(within(dialog).getByLabelText('Code'), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

const region = async (name: string) => within(await screen.findByRole('region', { name }));

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('AdminUserPage', () => {
  it('says an id that is not one is not found, without asking for it', async () => {
    const { calls } = stub();
    renderRoute('/admin/users/not-an-id');

    await waitFor(() => {
      expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
        'Not found.',
        'Not found.',
      ]);
    });
    expect(calls.map(routeOf)).toEqual([APPS]);
    expect(screen.getByRole('link', { name: '← Users' })).toHaveAttribute('href', '/admin/users');
  });

  it('shows who they are, their role and their second factor', async () => {
    stub({ [ACCESS]: () => ok(access({ role: 'member', apps: [] })) });
    renderRoute(`/admin/users/${USER_ID}`);

    expect(await screen.findByRole('heading', { name: 'Grace', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
    const role = await region('Role');
    expect(role.getByLabelText('Role')).toHaveValue('member');
    expect(role.getByRole('button', { name: 'Change role' })).toBeDisabled();
    // Members and administrators see no application list to choose.
    expect(screen.queryByRole('region', { name: 'Applications they see' })).toBeNull();
    // A member is refused at sign-in: the page says so.
    expect(
      screen.getByText('A member cannot sign in to the panel: choose another role to let them in.'),
    ).toBeInTheDocument();
    const mfa = await region('Second factor');
    expect(
      mfa.getByText(`Set up ${formatDateTime('2026-09-02T10:00:00.000Z')}.`),
    ).toBeInTheDocument();
    expect(mfa.getByRole('button', { name: 'Reset their second factor' })).toBeInTheDocument();
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stub({ [ACCESS]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(access())) });
    renderRoute(`/admin/users/${USER_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Role' })).toBeInTheDocument();
  });
});

describe('their role', () => {
  it('changes after the step-up, then shows their access again', async () => {
    let attempt = 0;
    const { calls } = stub({
      [ACCESS]: answers(
        access({ role: 'member', apps: [] }),
        access({ role: 'auditor', apps: [] }),
      ),
      [ROLE]: () => (attempt++ === 0 ? reauthenticate() : ok(access({ role: 'auditor' }))),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const role = await region('Role');

    await user.selectOptions(
      role.getByLabelText('Role'),
      'auditor: reads, reviews alerts, exports',
    );
    await user.click(role.getByRole('button', { name: 'Change role' }));
    await confirmItIsYou(user);

    // An auditor sees chosen applications: the list to choose them appears.
    expect(
      await screen.findByRole('region', { name: 'Applications they see' }),
    ).toBeInTheDocument();
    expect((await region('Role')).getByLabelText('Role')).toHaveValue('auditor');
    const sent = callsTo(calls, ROLE);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({ role: 'auditor' });
    expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');
    expect(callsTo(calls, ACCESS)).toHaveLength(2);
    expect(callsTo(calls, PERSON)).toHaveLength(1);
  });

  it('keeps the last administrator one', async () => {
    stub({
      [ACCESS]: () => ok(access({ role: 'admin', apps: [] })),
      [ROLE]: () => failure(409, 'At least one administrator'),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const role = await region('Role');

    await user.selectOptions(role.getByLabelText('Role'), 'member: cannot sign in');
    await user.click(role.getByRole('button', { name: 'Change role' }));

    expect(await role.findByRole('alert')).toHaveTextContent(
      'Audit Hub needs at least one administrator: promote someone else first.',
    );
    expect(role.getByLabelText('Role')).toHaveValue('member');
  });

  it('changes nothing when the step-up is cancelled', async () => {
    const { calls } = stub({ [ROLE]: reauthenticate });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const role = await region('Role');

    await user.selectOptions(role.getByLabelText('Role'), 'admin: everything');
    await user.click(role.getByRole('button', { name: 'Change role' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await role.findByRole('alert')).toHaveTextContent(
      'Nothing changed: it needs you to confirm it is you.',
    );
    expect(callsTo(calls, ROLE)).toHaveLength(1);
  });
});

describe('the applications they see', () => {
  it('lists every application, theirs ticked, and saves the new choice', async () => {
    const { calls } = stub({
      [ACCESS]: answers(
        access(),
        access({ apps: [{ appId: STAGING_ID, slug: 'shop-staging', name: 'Shop' }] }),
      ),
      [ASSIGN]: () => ok(access()),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const apps = await region('Applications they see');

    const production = await apps.findByRole('checkbox', { name: 'Shop (production)' });
    const staging = apps.getByRole('checkbox', { name: 'Shop (staging)' });
    expect(production).toBeChecked();
    expect(staging).not.toBeChecked();
    await user.click(staging);
    await user.click(production);
    await user.click(apps.getByRole('button', { name: 'Save applications' }));

    await waitFor(() => {
      expect(callsTo(calls, ACCESS)).toHaveLength(2);
    });
    await expect(callsTo(calls, ASSIGN)[0]?.json()).resolves.toEqual({ appIds: [STAGING_ID] });
    const again = await region('Applications they see');
    expect(await again.findByRole('checkbox', { name: 'Shop (staging)' })).toBeChecked();
    expect(again.getByRole('checkbox', { name: 'Shop (production)' })).not.toBeChecked();
  });

  it('explains a choice that could not be saved', async () => {
    stub({ [ASSIGN]: () => failure(503, 'Unavailable') });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const apps = await region('Applications they see');

    await user.click(await apps.findByRole('button', { name: 'Save applications' }));
    expect(await apps.findByRole('alert')).toHaveTextContent('The service is unavailable');
  });

  it('says an auditor or a viewer without an application cannot sign in', async () => {
    stub({ [ACCESS]: () => ok(access({ role: 'auditor', apps: [] })) });
    renderRoute(`/admin/users/${USER_ID}`);
    expect(
      await screen.findByText(
        'They cannot sign in until they see an application: choose at least one below.',
      ),
    ).toBeInTheDocument();
  });

  it('says there is no application to choose yet', async () => {
    stub({ [APPS]: () => ok([]) });
    renderRoute(`/admin/users/${USER_ID}`);
    expect(
      await (await region('Applications they see')).findByText('No application yet.'),
    ).toBeInTheDocument();
  });

  it('explains applications that could not be loaded, for an auditor too', async () => {
    let attempt = 0;
    stub({
      [ACCESS]: () => ok(access({ role: 'auditor', apps: [] })),
      [APPS]: () =>
        attempt++ === 0 ? failure(503, 'Unavailable') : ok([connected(APP_ID, 'production')]),
    });
    renderRoute(`/admin/users/${USER_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await (
        await region('Applications they see')
      ).findByRole('checkbox', {
        name: 'Shop (production)',
      }),
    ).not.toBeChecked();
  });
});

describe('their second factor', () => {
  it('cannot be reset before it is set up', async () => {
    stub({ [ACCESS]: () => ok(access({ mfaConfirmedAt: null })) });
    renderRoute(`/admin/users/${USER_ID}`);
    const mfa = await region('Second factor');

    expect(mfa.getByText('Not set up: they set it up at their next sign-in.')).toBeInTheDocument();
    expect(mfa.queryByRole('button')).toBeNull();
  });

  it('is not offered for the administrator themself', async () => {
    const ownId = admin.id;
    stubFetch({
      [`GET /api/users/${ownId}`]: () => ok({ ...person, ...admin }),
      [`GET /api/users/${ownId}/access`]: () => ok(access({ userId: ownId, role: 'admin' })),
      [APPS]: () => ok([]),
    });
    renderRoute(`/admin/users/${ownId}`);
    const mfa = await region('Second factor');

    expect(
      mfa.getByText('Your own: make new recovery codes from your account instead.'),
    ).toBeInTheDocument();
    expect(mfa.queryByRole('button')).toBeNull();
  });

  it('needs a reason of 10 characters or more', async () => {
    const { calls } = stub();
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const mfa = await region('Second factor');

    await user.type(mfa.getByLabelText('Why reset it'), '  lost it  ');
    await user.click(mfa.getByRole('button', { name: 'Reset their second factor' }));

    expect(mfa.getByRole('alert')).toHaveTextContent(
      'Say why, in 10 characters or more: it is recorded.',
    );
    expect(callsTo(calls, MFA_RESET)).toHaveLength(0);
  });

  it('resets it after the step-up, then shows it is not set up any more', async () => {
    let attempt = 0;
    const { calls } = stub({
      [ACCESS]: answers(access(), access({ mfaConfirmedAt: null })),
      [MFA_RESET]: () => (attempt++ === 0 ? reauthenticate() : noContent()),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const mfa = await region('Second factor');

    await user.type(mfa.getByLabelText('Why reset it'), '  Lost their phone, checked by call ');
    await user.click(mfa.getByRole('button', { name: 'Reset their second factor' }));
    await confirmItIsYou(user);

    expect(
      await screen.findByText('Not set up: they set it up at their next sign-in.'),
    ).toBeInTheDocument();
    // Said above their access, which the reload replaced.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Second factor reset: their sessions ended, and they set up a new one at their next sign-in.',
    );
    const sent = callsTo(calls, MFA_RESET);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({
      reason: 'Lost their phone, checked by call',
    });
    expect(callsTo(calls, ACCESS)).toHaveLength(2);
  });

  it('explains a reset that failed and keeps the reason', async () => {
    stub({ [MFA_RESET]: () => failure(404, 'No such user') });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const mfa = await region('Second factor');

    await user.type(mfa.getByLabelText('Why reset it'), 'Lost their phone, checked by call');
    await user.click(mfa.getByRole('button', { name: 'Reset their second factor' }));

    expect(await mfa.findByRole('alert')).toHaveTextContent('Not found.');
    expect(mfa.getByLabelText('Why reset it')).toHaveValue('Lost their phone, checked by call');
  });
});

describe('their account', () => {
  it('disables it after a confirmation and the step-up, then says so; enables it again', async () => {
    let attempt = 0;
    const { calls } = stub({
      [ACCESS]: answers(access(), access({ disabledAt: AT }), access()),
      [STATUS]: () => (attempt++ === 0 ? reauthenticate() : ok(access({ disabledAt: AT }))),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const account = await region('Account');
    expect(account.getByText('Active: they can sign in.')).toBeInTheDocument();
    await user.click(account.getByRole('button', { name: 'Disable their account…' }));
    await user.click(account.getByRole('button', { name: 'Disable their account' }));
    await confirmItIsYou(user);

    expect(
      await screen.findByText(
        'Disabled: every session of theirs ended, and they cannot sign in until enabled.',
      ),
    ).toBeInTheDocument();
    const disabled = await region('Account');
    expect(
      disabled.getByText(`Disabled ${formatDateTime(AT)}: they cannot sign in.`),
    ).toBeInTheDocument();
    const sent = callsTo(calls, STATUS);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({ disabled: true });

    await user.click(disabled.getByRole('button', { name: 'Enable their account' }));
    expect(await screen.findByText('Enabled: they can sign in again.')).toBeInTheDocument();
    await expect(callsTo(calls, STATUS)[2]?.json()).resolves.toEqual({ disabled: false });
  });

  it('keeps the last administrator who can sign in, and changes nothing on cancel', async () => {
    stub({ [STATUS]: () => failure(409, 'Audit Hub needs at least one administrator') });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const account = await region('Account');
    await user.click(account.getByRole('button', { name: 'Disable their account…' }));
    await user.click(account.getByRole('button', { name: 'Cancel' }));
    await user.click(account.getByRole('button', { name: 'Disable their account…' }));
    await user.click(account.getByRole('button', { name: 'Disable their account' }));
    expect(await account.findByRole('alert')).toHaveTextContent(
      'Audit Hub needs at least one administrator who can sign in',
    );
  });

  it('is not offered for the administrator themself, nor their removal', async () => {
    stubFetch({
      [`GET /api/users/${admin.id}`]: () =>
        ok({ ...person, id: admin.id, name: admin.name, email: admin.email, role: 'admin' }),
      [`GET /api/users/${admin.id}/access`]: () =>
        ok(access({ userId: admin.id, role: 'admin', apps: [] })),
      [APPS]: () => ok([]),
    });
    renderRoute(`/admin/users/${admin.id}`);
    const account = await region('Account');
    expect(
      account.getByText('Your own: another administrator can disable it.'),
    ).toBeInTheDocument();
    expect(account.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Remove from Audit Hub' })).toBeNull();
  });

  it('explains a change that failed', async () => {
    stub({ [STATUS]: () => failure(404, 'User not found') });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const account = await region('Account');
    await user.click(account.getByRole('button', { name: 'Disable their account…' }));
    await user.click(account.getByRole('button', { name: 'Disable their account' }));
    expect(await account.findByRole('alert')).toHaveTextContent('Not found.');
  });
});

describe('their removal', () => {
  it('removes them after a confirmation and the step-up, then shows the account removed', async () => {
    let attempt = 0;
    let people = 0;
    const { calls } = stub({
      [PERSON]: () =>
        ok(
          people++ === 0
            ? person
            : {
                ...person,
                name: 'Removed user',
                email: `removed+${USER_ID}@users.invalid`,
                role: 'member',
                disabledAt: AT,
                removedAt: AT,
              },
        ),
      [ACCESS]: answers(
        access(),
        access({ role: 'member', apps: [], mfaConfirmedAt: null, disabledAt: AT, removedAt: AT }),
      ),
      [REMOVE]: () => (attempt++ === 0 ? reauthenticate() : noContent()),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const removal = await region('Remove from Audit Hub');
    await user.click(removal.getByRole('button', { name: 'Remove from Audit Hub…' }));
    await user.click(removal.getByRole('button', { name: 'Remove them' }));
    await confirmItIsYou(user);

    expect(
      await screen.findByRole('heading', { name: 'Removed user', level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Removed: nothing of them is left in Audit Hub but their id.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`^Removed ${formatDateTime(AT)}: the account keeps its id`)),
    ).toBeInTheDocument();
    // Nothing left to change.
    for (const name of ['Role', 'Second factor', 'Account', 'Remove from Audit Hub']) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    expect(callsTo(calls, REMOVE)).toHaveLength(2);
    expect(callsTo(calls, REMOVE)[1]?.headers.get('Authorization')).toBe('Bearer token-2');
  });

  it('keeps the last administrator who can sign in, and explains any other failure', async () => {
    let attempt = 0;
    stub({
      [REMOVE]: () =>
        attempt++ === 0
          ? failure(409, 'Audit Hub needs at least one administrator')
          : failure(503, 'Unavailable'),
    });
    renderRoute(`/admin/users/${USER_ID}`);
    const user = userEvent.setup();
    const removal = await region('Remove from Audit Hub');
    await user.click(removal.getByRole('button', { name: 'Remove from Audit Hub…' }));
    await user.click(removal.getByRole('button', { name: 'Remove them' }));
    expect(await removal.findByRole('alert')).toHaveTextContent(
      'Audit Hub needs at least one administrator who can sign in',
    );
    await user.click(removal.getByRole('button', { name: 'Remove from Audit Hub…' }));
    await user.click(removal.getByRole('button', { name: 'Cancel' }));
    await user.click(removal.getByRole('button', { name: 'Remove from Audit Hub…' }));
    await user.click(removal.getByRole('button', { name: 'Remove them' }));
    expect(await removal.findByRole('alert')).toHaveTextContent('The service is unavailable');
  });
});
