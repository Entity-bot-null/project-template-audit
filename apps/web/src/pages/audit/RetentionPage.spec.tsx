import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetVisibleApps } from '../../audit/apps';
import { formatDateTime } from '../../audit/format';
import type { LegalHolds, RetentionPolicies, VisibleApps } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, json, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// How long each application's records are kept, and the legal holds that keep
// them longer: every change after a step-up.

const APPS = 'GET /api/account/apps';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const OTHER_ID = '0190b6a1-0000-7000-8000-0000000000a2';
const HUB_ID = '0190b6a1-0000-7000-8000-0000000000a0';
const HOLD_ID = '0190b6a1-0000-7000-8000-0000000000f1';
const policiesOf = (appId: string) => `GET /api/connected-apps/${appId}/retention`;
const holdsOf = (appId: string) => `GET /api/connected-apps/${appId}/legal-holds`;
const SET_POLICY = `PUT /api/connected-apps/${APP_ID}/retention/audit_access`;
const RELEASE = `POST /api/legal-holds/${HOLD_ID}/release`;
const CREATE_HOLD = 'POST /api/legal-holds';
const STEP_UP = 'POST /api/account/step-up';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });

const shop = {
  appId: APP_ID,
  slug: 'shop',
  name: 'Shop',
  environment: 'production',
  status: 'active',
  system: false,
};
const visible: VisibleApps = {
  items: [
    { ...shop, appId: HUB_ID, slug: 'audit-hub', name: 'Audit Hub', system: true },
    shop,
    { ...shop, appId: OTHER_ID, slug: 'shop-staging', environment: 'staging' },
  ],
};

const policies: RetentionPolicies = [
  { class: 'security', minimumDays: 365, days: 730, custom: true },
  { class: 'audit_access', minimumDays: 365, days: 365, custom: false },
];

type Hold = LegalHolds[number];
const hold = (overrides: Partial<Hold> = {}): Hold => ({
  id: HOLD_ID,
  appId: APP_ID,
  caseRef: 'CASE-2026-001',
  reason: 'Litigation with a former customer',
  actorId: 'user-42',
  byEmail: true,
  resourceType: 'invoice',
  resourceId: null,
  fromAt: '2026-01-01T00:00:00.000Z',
  toAt: '2026-06-30T00:00:00.000Z',
  createdById: admin.id,
  createdAt: '2026-10-01T10:00:00.000Z',
  release: null,
  ...overrides,
});

function stub(handlers: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    [APPS]: () => ok(visible),
    [policiesOf(APP_ID)]: () => ok(policies),
    [holdsOf(APP_ID)]: () => ok([]),
    ...handlers,
  });
}

async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
  await user.type(within(dialog).getByLabelText('Code'), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

async function cancelStepUp(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
}

const policiesRegion = async () =>
  within(await screen.findByRole('region', { name: 'How long records are kept' }));
const holdsRegion = async () => within(await screen.findByRole('region', { name: 'Legal holds' }));
const DAYS = 'Days to keep audit access records';

beforeEach(() => {
  resetForTests();
  forgetVisibleApps();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('RetentionPage', () => {
  it('says there is no application yet: its own log is not one to choose', async () => {
    stubFetch({ [APPS]: () => ok({ items: [visible.items[0]] }) });
    renderRoute('/retention');
    expect(await screen.findByText('No application yet.')).toBeInTheDocument();
  });

  it('explains applications that could not be loaded and retries', async () => {
    let attempt = 0;
    stub({ [APPS]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(visible)) });
    renderRoute('/retention');

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Application' })).toHaveValue(APP_ID);
  });

  it('opens the first application, or the one of the URL, and switches in the URL', async () => {
    const { calls } = stub({
      [policiesOf(OTHER_ID)]: () => ok(policies),
      [holdsOf(OTHER_ID)]: () => ok([]),
    });
    const router = renderRoute(`/retention?appId=${OTHER_ID}`);
    const user = userEvent.setup();

    const picker = await screen.findByRole('combobox', { name: 'Application' });
    expect(picker).toHaveValue(OTHER_ID);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Shop (production)', 'Shop (staging)']);
    await user.selectOptions(picker, 'Shop (production)');
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe(`?appId=${APP_ID}`);
    });
    await vi.waitFor(() => {
      expect(callsTo(calls, policiesOf(APP_ID))).toHaveLength(1);
    });
    expect(callsTo(calls, holdsOf(APP_ID))).toHaveLength(1);
  });

  it('opens the first application when the URL names one it cannot choose', async () => {
    const { calls } = stub();
    renderRoute(`/retention?appId=${HUB_ID}`);

    expect(await screen.findByRole('combobox', { name: 'Application' })).toHaveValue(APP_ID);
    await (await policiesRegion()).findByLabelText(DAYS);
    expect(callsTo(calls, policiesOf(APP_ID))).toHaveLength(1);
  });

  it('explains policies and holds that could not be loaded', async () => {
    stub({
      [policiesOf(APP_ID)]: () => failure(503, 'Unavailable'),
      [holdsOf(APP_ID)]: () => failure(404, 'No such application'),
    });
    renderRoute('/retention');

    await vi.waitFor(() => {
      expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
        'The service is unavailable. Try again later.',
        'Not found.',
      ]);
    });
  });
});

describe('the retention policies', () => {
  it('shows how long each kind of record is kept, and its minimum', async () => {
    stub();
    renderRoute('/retention');
    const scope = await policiesRegion();

    const security = within(await scope.findByRole('row', { name: /security/ }));
    expect(security.getByRole('textbox')).toHaveValue('730');
    expect(security.queryByText(/default/)).toBeNull();
    const access = within(scope.getByRole('row', { name: /audit access/ }));
    expect(access.getByLabelText(DAYS)).toHaveValue('365');
    expect(access.getByText(/\(default\)/)).toBeInTheDocument();
    expect(access.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it.each([['364'], ['3651'], ['400.5'], ['many']])(
    'refuses %s days without asking',
    async (days) => {
      const { calls } = stub();
      renderRoute('/retention');
      const user = userEvent.setup();
      const scope = await policiesRegion();

      await user.clear(await scope.findByLabelText(DAYS));
      await user.type(scope.getByLabelText(DAYS), days);
      await user.click(
        within(scope.getByRole('row', { name: /audit access/ })).getByRole('button'),
      );

      expect(scope.getByRole('alert')).toHaveTextContent('audit access: from 365 to 3650 days.');
      expect(callsTo(calls, SET_POLICY)).toHaveLength(0);
    },
  );

  it('saves a policy after the step-up, then shows the policies again', async () => {
    let attempt = 0;
    let loaded = 0;
    const { calls } = stub({
      [policiesOf(APP_ID)]: () =>
        ok(
          loaded++ === 0
            ? policies
            : [policies[0], { class: 'audit_access', minimumDays: 365, days: 400, custom: true }],
        ),
      [SET_POLICY]: () => (attempt++ === 0 ? reauthenticate() : ok(policies)),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await policiesRegion();

    await user.clear(await scope.findByLabelText(DAYS));
    await user.type(scope.getByLabelText(DAYS), '400');
    await user.click(within(scope.getByRole('row', { name: /audit access/ })).getByRole('button'));
    await confirmItIsYou(user);

    await vi.waitFor(() => {
      expect(callsTo(calls, policiesOf(APP_ID))).toHaveLength(2);
    });
    const sent = callsTo(calls, SET_POLICY);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({ days: 400 });
    const access = within((await policiesRegion()).getByRole('row', { name: /audit access/ }));
    expect(await access.findByLabelText(DAYS)).toHaveValue('400');
    expect(access.queryByText(/\(default\)/)).toBeNull();
    // The holds are asked again with them.
    expect(callsTo(calls, holdsOf(APP_ID))).toHaveLength(2);
  });

  it('changes nothing when the step-up is cancelled', async () => {
    stub({ [SET_POLICY]: reauthenticate });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await policiesRegion();

    await user.clear(await scope.findByLabelText(DAYS));
    await user.type(scope.getByLabelText(DAYS), '400');
    await user.click(within(scope.getByRole('row', { name: /audit access/ })).getByRole('button'));
    await cancelStepUp(user);

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Nothing changed: it needs you to confirm it is you.',
    );
    expect(scope.getByLabelText(DAYS)).toHaveValue('400');
  });

  it('explains any other failure', async () => {
    stub({ [SET_POLICY]: () => failure(400, 'days: below the legal minimum') });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await policiesRegion();

    await user.clear(await scope.findByLabelText(DAYS));
    await user.type(scope.getByLabelText(DAYS), '400');
    await user.click(within(scope.getByRole('row', { name: /audit access/ })).getByRole('button'));

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Check the highlighted data and try again.',
    );
  });
});

describe('the legal holds', () => {
  it('says there is none', async () => {
    stub();
    renderRoute('/retention');
    expect(await (await holdsRegion()).findByText('None.')).toBeInTheDocument();
  });

  it('lists active and released holds, with what each keeps', async () => {
    stub({
      [holdsOf(APP_ID)]: () =>
        ok([
          hold(),
          hold({
            id: '0190b6a1-0000-7000-8000-0000000000f2',
            caseRef: 'CASE-2026-002',
            actorId: null,
            byEmail: false,
            resourceType: null,
            fromAt: null,
            toAt: null,
          }),
          hold({
            id: '0190b6a1-0000-7000-8000-0000000000f3',
            caseRef: 'CASE-2025-009',
            actorId: null,
            byEmail: false,
            resourceType: 'order',
            resourceId: 'order-7',
            fromAt: '2025-01-01T00:00:00.000Z',
            toAt: null,
            release: {
              reason: 'The case was closed',
              releasedById: admin.id,
              releasedAt: '2026-09-01T10:00:00.000Z',
            },
          }),
        ]),
    });
    renderRoute('/retention');
    const scope = await holdsRegion();

    const items = await scope.findAllByRole('listitem');
    const [active, everything, released] = items.map((item) => within(item));
    expect(active!.getByText('active')).toBeInTheDocument();
    expect(active!.getByText(/^Keeps:/)).toHaveTextContent(
      `Keeps: user user-42; an email (pseudonymized); invoice (any); ${formatDateTime(
        '2026-01-01T00:00:00.000Z',
      )} to ${formatDateTime('2026-06-30T00:00:00.000Z')}`,
    );
    expect(active!.getByText('Litigation with a former customer')).toBeInTheDocument();
    expect(active!.getByRole('button', { name: 'Release…' })).toBeInTheDocument();

    expect(everything!.getByText(/^Keeps:/)).toHaveTextContent(
      'Keeps: everything of the application',
    );

    expect(
      released!.getByText(`released ${formatDateTime('2026-09-01T10:00:00.000Z')}`),
    ).toBeInTheDocument();
    expect(released!.getByText(/^Keeps:/)).toHaveTextContent(
      `Keeps: order order-7; ${formatDateTime('2025-01-01T00:00:00.000Z')} to —`,
    );
    expect(released!.queryByRole('button')).toBeNull();
  });

  it('releases a hold with a reason, after the step-up', async () => {
    let attempt = 0;
    let loaded = 0;
    const { calls } = stub({
      [holdsOf(APP_ID)]: () =>
        ok(
          loaded++ === 0
            ? [hold()]
            : [
                hold({
                  release: {
                    reason: 'The case was closed',
                    releasedById: admin.id,
                    releasedAt: '2026-10-15T10:00:00.000Z',
                  },
                }),
              ],
        ),
      [RELEASE]: () => (attempt++ === 0 ? reauthenticate() : ok(hold())),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await holdsRegion();

    await user.click(await scope.findByRole('button', { name: 'Release…' }));
    // Changed their mind, then came back.
    await user.click(scope.getByRole('button', { name: 'Cancel' }));
    expect(scope.queryByLabelText('Why release it')).toBeNull();
    await user.click(scope.getByRole('button', { name: 'Release…' }));

    await user.type(scope.getByLabelText('Why release it'), 'too short');
    await user.click(scope.getByRole('button', { name: 'Release' }));
    expect(scope.getByRole('alert')).toHaveTextContent('Say why, in 10 characters or more.');
    expect(callsTo(calls, RELEASE)).toHaveLength(0);

    await user.clear(scope.getByLabelText('Why release it'));
    await user.type(scope.getByLabelText('Why release it'), '  The case was closed ');
    await user.click(scope.getByRole('button', { name: 'Release' }));
    await confirmItIsYou(user);

    expect(
      await screen.findByText(`released ${formatDateTime('2026-10-15T10:00:00.000Z')}`),
    ).toBeInTheDocument();
    const sent = callsTo(calls, RELEASE);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({ reason: 'The case was closed' });
  });

  it('explains a release that failed', async () => {
    stub({
      [holdsOf(APP_ID)]: () => ok([hold()]),
      [RELEASE]: reauthenticate,
    });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await holdsRegion();

    await user.click(await scope.findByRole('button', { name: 'Release…' }));
    await user.type(scope.getByLabelText('Why release it'), 'The case was closed');
    await user.click(scope.getByRole('button', { name: 'Release' }));
    await cancelStepUp(user);

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Nothing changed: it needs you to confirm it is you.',
    );
    expect(scope.getByLabelText('Why release it')).toHaveValue('The case was closed');
  });
});

describe('a new legal hold', () => {
  const form = async () => {
    const scope = await holdsRegion();
    await userEvent.setup().click(await scope.findByRole('button', { name: 'New legal hold…' }));
    return within(scope.getByRole('form', { name: 'New legal hold' }));
  };

  it('can be put away without creating anything', async () => {
    stub();
    renderRoute('/retention');
    const scope = await form();

    await userEvent.setup().click(scope.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New legal hold' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New legal hold…' })).toBeInTheDocument();
  });

  it('needs a case reference and a reason of 10 characters or more', async () => {
    const { calls } = stub();
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await form();

    await user.type(scope.getByLabelText('Reason'), 'A reason long enough');
    await user.click(scope.getByRole('button', { name: 'Create the hold' }));
    expect(scope.getByRole('alert')).toHaveTextContent(
      'A case reference, and why in 10 characters or more.',
    );
    await user.type(scope.getByLabelText('Case reference'), 'CASE-1');
    await user.clear(scope.getByLabelText('Reason'));
    await user.type(scope.getByLabelText('Reason'), 'short');
    await user.click(scope.getByRole('button', { name: 'Create the hold' }));
    expect(scope.getByRole('alert')).toHaveTextContent(
      'A case reference, and why in 10 characters or more.',
    );
    expect(callsTo(calls, CREATE_HOLD)).toHaveLength(0);
  });

  // Types into every field of the form: slow under coverage instrumentation.
  it('creates a hold with every field, after the step-up, then lists it', async () => {
    let attempt = 0;
    let loaded = 0;
    const { calls } = stub({
      [holdsOf(APP_ID)]: () => ok(loaded++ === 0 ? [] : [hold({ caseRef: 'CASE-2026-003' })]),
      [CREATE_HOLD]: () =>
        attempt++ === 0 ? reauthenticate() : json(201, { data: hold(), message: 'Created' }),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await form();

    await user.type(scope.getByLabelText('Case reference'), '  CASE-2026-003 ');
    await user.type(scope.getByLabelText('Reason'), '  Regulator inquiry, keep it all ');
    await user.type(scope.getByLabelText('User id'), 'user-42');
    await user.type(scope.getByLabelText('Email'), 'someone@example.com');
    await user.type(scope.getByLabelText('Resource type'), 'invoice');
    await user.type(scope.getByLabelText('Resource id'), 'inv-9');
    fireEvent.change(scope.getByLabelText('From'), { target: { value: '2026-01-01T09:30' } });
    fireEvent.change(scope.getByLabelText('To'), { target: { value: '2026-03-31T18:00' } });
    await user.click(scope.getByRole('button', { name: 'Create the hold' }));
    await confirmItIsYou(user);

    expect(await screen.findByText('CASE-2026-003')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New legal hold' })).toBeNull();
    const sent = callsTo(calls, CREATE_HOLD);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({
      appId: APP_ID,
      caseRef: 'CASE-2026-003',
      reason: 'Regulator inquiry, keep it all',
      actorId: 'user-42',
      actorEmail: 'someone@example.com',
      resourceType: 'invoice',
      resourceId: 'inv-9',
      // The viewer's local time, sent as an instant.
      fromAt: new Date('2026-01-01T09:30').toISOString(),
      toAt: new Date('2026-03-31T18:00').toISOString(),
    });
  }, 15_000);

  it('sends only the case and the reason for a hold on the whole application', async () => {
    const { calls } = stub({
      [CREATE_HOLD]: () => json(201, { data: hold(), message: 'Created' }),
    });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await form();

    await user.type(scope.getByLabelText('Case reference'), 'CASE-1');
    await user.type(scope.getByLabelText('Reason'), 'Keep everything for now');
    await user.click(scope.getByRole('button', { name: 'Create the hold' }));

    await vi.waitFor(() => {
      expect(callsTo(calls, CREATE_HOLD)).toHaveLength(1);
    });
    await expect(callsTo(calls, CREATE_HOLD)[0]?.json()).resolves.toEqual({
      appId: APP_ID,
      caseRef: 'CASE-1',
      reason: 'Keep everything for now',
    });
  });

  it.each([
    [400, 'actorEmail: Invalid email address', 'Check "Email".'],
    [400, 'Something is wrong', 'Check the highlighted data and try again.'],
    [503, 'Unavailable', 'The service is unavailable. Try again later.'],
  ])('explains a %i: %s', async (status, message, shown) => {
    stub({ [CREATE_HOLD]: () => failure(status, message) });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await form();

    await user.type(scope.getByLabelText('Case reference'), 'CASE-1');
    await user.type(scope.getByLabelText('Reason'), 'Keep everything for now');
    await user.type(scope.getByLabelText('Email'), 'not-an-email');
    await user.click(scope.getByRole('button', { name: 'Create the hold' }));

    expect(await scope.findByRole('alert')).toHaveTextContent(shown);
    expect(scope.getByLabelText('Case reference')).toHaveValue('CASE-1');
  });

  it('creates nothing when the step-up is cancelled', async () => {
    const { calls } = stub({ [CREATE_HOLD]: reauthenticate });
    renderRoute('/retention');
    const user = userEvent.setup();
    const scope = await form();

    await user.type(scope.getByLabelText('Case reference'), 'CASE-1');
    await user.type(scope.getByLabelText('Reason'), 'Keep everything for now');
    await user.click(scope.getByRole('button', { name: 'Create the hold' }));
    await cancelStepUp(user);

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Nothing changed: it needs you to confirm it is you.',
    );
    expect(callsTo(calls, CREATE_HOLD)).toHaveLength(1);
  });
});
