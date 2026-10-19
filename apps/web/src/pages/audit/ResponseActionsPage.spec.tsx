import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetVisibleApps } from '../../audit/apps';
import type { ResponseAction, ResponseActionPage, VisibleApps } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// What Audit Hub asked applications to do, and their approval: another
// administrator approves (after a step-up), anyone cancels.

const LIST = 'GET /api/response-actions';
const APPS = 'GET /api/account/apps';
const STEP_UP = 'POST /api/account/step-up';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const HUB_ID = '0190b6a1-0000-7000-8000-0000000000a0';
const ALERT_ID = '0190b6a1-0000-7000-8000-0000000000b1';
const OTHERS = '0190b6a1-0000-7000-8000-0000000000d1';
const MINE = '0190b6a1-0000-7000-8000-0000000000d2';
const DONE = '0190b6a1-0000-7000-8000-0000000000d3';
const APPROVE = `POST /api/response-actions/${OTHERS}/approve`;
const CANCEL = `POST /api/response-actions/${OTHERS}/cancel`;
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
const queryOf = (request: Request | undefined) =>
  Object.fromEntries(new URL(request?.url ?? '').searchParams);
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });

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
      appId: HUB_ID,
      slug: 'audit-hub',
      name: 'Audit Hub',
      environment: 'production',
      status: 'active',
      system: true,
    },
  ],
};

const action = (overrides: Partial<ResponseAction> = {}): ResponseAction => ({
  id: OTHERS,
  appId: APP_ID,
  subject: 'user-42',
  action: 'revoke_sessions',
  reason: 'Account takeover suspected',
  status: 'pending_approval',
  alertId: null,
  requestedById: '0190b6a1-0000-7000-8000-000000000009',
  approvedById: null,
  approvedAt: null,
  expiresAt: '2026-10-16T09:30:00.000Z',
  completedAt: null,
  createdAt: '2026-10-15T09:30:00.000Z',
  ...overrides,
});

const page = (items: ResponseAction[], total = items.length): ResponseActionPage => ({
  items,
  total,
});

const card = (text: string) => screen.getByText(text).closest('li')!;

function stub(handlers: Parameters<typeof stubFetch>[0]) {
  return stubFetch({ [APPS]: () => ok(visible), ...handlers });
}

async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
  await user.type(within(dialog).getByLabelText('Code'), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  resetForTests();
  forgetVisibleApps();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('ResponseActionsPage', () => {
  it('lists the actions: who asked, about whom, and what can still be decided', async () => {
    const { calls } = stub({
      [LIST]: () =>
        ok(
          page([
            action(),
            action({
              id: MINE,
              action: 'require_password_change',
              reason: 'Password found in a leak',
              requestedById: admin.id,
            }),
            action({
              id: DONE,
              action: 'disable_account',
              reason: 'Confirmed fraud on the account',
              status: 'succeeded',
              subject: 'not an id',
              alertId: ALERT_ID,
              approvedById: admin.id,
              approvedAt: '2026-10-15T09:40:00.000Z',
              completedAt: '2026-10-15T09:41:00.000Z',
            }),
          ]),
        ),
    });
    renderRoute('/response-actions');

    await screen.findByText('Account takeover suspected');
    const others = within(card('Account takeover suspected'));
    expect(others.getByText('revoke sessions')).toBeInTheDocument();
    expect(others.getByText('pending approval')).toHaveClass('badge', 'status-pending_approval');
    expect(others.getByRole('link', { name: 'user-42' })).toHaveAttribute(
      'href',
      `/apps/${APP_ID}/actors/user-42`,
    );
    expect(others.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(others.getByRole('button', { name: 'Cancel it' })).toBeEnabled();
    expect(others.queryByText(/\(by you\)/)).toBeNull();
    expect(others.queryByRole('link', { name: 'Open the alert' })).toBeNull();

    // Their own request: someone else approves it.
    const mine = within(card('Password found in a leak'));
    expect(mine.getByText(/\(by you\)/)).toBeInTheDocument();
    expect(mine.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(mine.getByRole('button', { name: 'Cancel it' })).toBeInTheDocument();

    const done = within(card('Confirmed fraud on the account'));
    expect(done.queryByRole('button')).toBeNull();
    expect(done.getByRole('link', { name: 'Open the alert' })).toHaveAttribute(
      'href',
      `/alerts/${ALERT_ID}`,
    );
    expect(done.getByText('not an id')).toBeInTheDocument();
    expect(done.queryByRole('link', { name: 'not an id' })).toBeNull();

    expect(queryOf(callsTo(calls, LIST)[0])).toEqual({ limit: '25', offset: '0' });
    const picker = await screen.findByRole('combobox', { name: 'Application' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every application', 'Shop (production)']);
  });

  it('asks with the application, the status and the offset of the URL', async () => {
    const { calls } = stub({ [LIST]: () => ok(page([action({ status: 'failed' })], 30)) });
    renderRoute(`/response-actions?appId=${APP_ID}&status=failed&offset=25`);

    await screen.findByText('26–30 of 30');
    expect(queryOf(callsTo(calls, LIST)[0])).toEqual({
      appId: APP_ID,
      status: 'failed',
      limit: '25',
      offset: '25',
    });
    expect(screen.getByLabelText('Status')).toHaveValue('failed');
    expect(await screen.findByRole('combobox', { name: 'Application' })).toHaveValue(APP_ID);
  });

  it('leaves out a status it does not know and a wrong offset', async () => {
    const { calls } = stub({ [LIST]: () => ok(page([action()])) });
    renderRoute('/response-actions?status=bogus&offset=-3');

    await screen.findByText('Account takeover suspected');
    expect(queryOf(callsTo(calls, LIST)[0])).toEqual({ limit: '25', offset: '0' });
    expect(screen.getByLabelText('Status')).toHaveValue('');
  });

  it('filters by application and status in the URL, back on the first page', async () => {
    const { calls } = stub({ [LIST]: () => ok(page([action()], 60)) });
    const router = renderRoute('/response-actions?offset=25');
    const user = userEvent.setup();

    await screen.findByText('Account takeover suspected');
    const picker = await screen.findByRole('combobox', { name: 'Application' });
    await user.selectOptions(picker, 'Shop (production)');
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe(`?appId=${APP_ID}`);
    });
    await user.selectOptions(screen.getByLabelText('Status'), 'pending approval');
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe(`?appId=${APP_ID}&status=pending_approval`);
    });
    await user.selectOptions(picker, 'Every application');
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?status=pending_approval');
    });
    await user.selectOptions(picker, 'Shop (production)');
    await user.selectOptions(screen.getByLabelText('Status'), 'Any');
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe(`?appId=${APP_ID}`);
    });
    await user.selectOptions(screen.getByLabelText('Status'), 'expired');
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe(`?appId=${APP_ID}&status=expired`);
    });
    await vi.waitFor(() => {
      expect(queryOf(callsTo(calls, LIST).at(-1))).toEqual({
        appId: APP_ID,
        status: 'expired',
        limit: '25',
        offset: '0',
      });
    });
  });

  it('pages through the actions', async () => {
    const { calls } = stub({ [LIST]: () => ok(page([action()], 30)) });
    const router = renderRoute('/response-actions?status=pending_approval');
    const user = userEvent.setup();

    await screen.findByText('1–25 of 30');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?status=pending_approval&offset=25');
    });
    await screen.findByText('26–30 of 30');
    expect(queryOf(callsTo(calls, LIST).at(-1)).offset).toBe('25');
  });

  it('says when there is none', async () => {
    stub({ [LIST]: () => ok(page([])) });
    renderRoute('/response-actions');
    expect(await screen.findByText('None.')).toBeInTheDocument();
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stub({ [LIST]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(page([action()]))) });
    renderRoute('/response-actions');

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Account takeover suspected')).toBeInTheDocument();
  });
});

describe('deciding on an action', () => {
  it('approves after the step-up, then lists the actions again', async () => {
    let attempt = 0;
    let listed = 0;
    const { calls } = stub({
      [LIST]: () =>
        listed++ === 0
          ? ok(page([action()]))
          : ok(page([action({ status: 'dispatched', approvedById: admin.id })])),
      [APPROVE]: () => (attempt++ === 0 ? reauthenticate() : ok(action({ status: 'dispatched' }))),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute('/response-actions');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await confirmItIsYou(user);

    expect(await screen.findByText('dispatched', { selector: '.badge' })).toHaveClass(
      'badge',
      'status-dispatched',
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    const sent = callsTo(calls, APPROVE);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');
    expect(callsTo(calls, LIST)).toHaveLength(2);
  });

  it('approves nothing when the step-up is cancelled', async () => {
    const { calls } = stub({ [LIST]: () => ok(page([action()])), [APPROVE]: reauthenticate });
    renderRoute('/response-actions');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not approved: approving needs you to confirm it is you.',
    );
    expect(callsTo(calls, APPROVE)).toHaveLength(1);
    expect(callsTo(calls, STEP_UP)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('says when it changed meanwhile, or was requested by the same person', async () => {
    stub({
      [LIST]: () => ok(page([action()])),
      [APPROVE]: () => failure(409, 'The requester cannot approve'),
    });
    renderRoute('/response-actions');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'It changed meanwhile, or you requested it yourself: another administrator approves it.',
    );
  });

  it('cancels without a step-up, then lists the actions again', async () => {
    let listed = 0;
    const { calls } = stub({
      [LIST]: () =>
        listed++ === 0 ? ok(page([action()])) : ok(page([action({ status: 'cancelled' })])),
      [CANCEL]: () => ok(action({ status: 'cancelled' })),
    });
    renderRoute('/response-actions');

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel it' }));

    expect(await screen.findByText('cancelled', { selector: '.badge' })).toHaveClass(
      'badge',
      'status-cancelled',
    );
    expect(callsTo(calls, CANCEL)).toHaveLength(1);
    expect(callsTo(calls, STEP_UP)).toHaveLength(0);
  });

  it('explains a cancellation that failed', async () => {
    stub({
      [LIST]: () => ok(page([action()])),
      [CANCEL]: () => failure(404, 'No such response action'),
    });
    renderRoute('/response-actions');

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(screen.getByRole('button', { name: 'Cancel it' })).toBeEnabled();
  });
});
