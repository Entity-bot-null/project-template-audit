import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { operations } from '../../api/client';
import { formatDateTime } from '../../audit/format';
import type { AlertDetail } from '../../audit/types';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { ALERT_ID, alertDetail } from '../../test/alerts';
import { SHOP } from '../../test/events';
import { admin } from '../../test/fixtures';
import { deferred, failure, json, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// One alert: why it fired, what its events show, who it is about and who
// works on it by name, its events and history; the review an administrator
// or an auditor does; the response action only an administrator asks for,
// after a step-up.

type RequestedAction =
  operations['ResponseActionsController_request']['responses'][201]['content']['application/json']['data'];

const APP_ID = SHOP;
const GET = `GET /api/alerts/${ALERT_ID}`;
const PATCH = `PATCH /api/alerts/${ALERT_ID}`;
const NOTE = `POST /api/alerts/${ALERT_ID}/notes`;
const ACK = `POST /api/alerts/${ALERT_ID}/acknowledge`;
const MUTES = 'GET /api/alert-mutes';
const MUTE = 'POST /api/alert-mutes';
const MUTE_ID = '0190b6a1-0000-7000-8000-0000000000c1';
const LIFT = `POST /api/alert-mutes/${MUTE_ID}/end`;
const REQUEST = 'POST /api/response-actions';
const STEP_UP = 'POST /api/account/step-up';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
/** The page's requests; a reviewer's page also lists the application's silences (none, unless said). */
const stub = (handlers: Parameters<typeof stubFetch>[0]) =>
  stubFetch({ [MUTES]: () => ok({ items: [] }), ...handlers });
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });

const auditor: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'auditor@example.com',
  name: 'Auditor',
  role: 'auditor',
};
const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000005',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const detail = (overrides: Partial<AlertDetail> = {}): AlertDetail =>
  alertDetail({
    activities: [
      {
        id: 'act-1',
        kind: 'opened',
        userId: null,
        userLabel: null,
        fromStatus: null,
        toStatus: null,
        note: null,
        assigneeLabel: null,
        createdAt: '2026-10-14T08:00:00.000Z',
      },
      {
        id: 'act-2',
        kind: 'status_changed',
        userId: admin.id,
        userLabel: admin.name,
        fromStatus: 'open',
        toStatus: 'false_positive',
        note: 'A load test of ours',
        assigneeLabel: null,
        createdAt: '2026-10-14T09:00:00.000Z',
      },
      {
        id: 'act-3',
        kind: 'note',
        userId: admin.id,
        userLabel: admin.name,
        fromStatus: null,
        toStatus: null,
        note: 'Looking into it',
        assigneeLabel: null,
        createdAt: '2026-10-14T10:00:00.000Z',
      },
    ],
    ...overrides,
  });

const requested = (status: RequestedAction['status']): RequestedAction => ({
  id: '0190b6a1-0000-7000-8000-0000000000c1',
  appId: APP_ID,
  subject: 'user-42',
  action: 'revoke_sessions',
  reason: 'Account takeover suspected',
  status,
  alertId: ALERT_ID,
  requestedById: admin.id,
  approvedById: null,
  approvedAt: null,
  expiresAt: '2026-10-16T09:30:00.000Z',
  completedAt: null,
  createdAt: '2026-10-15T09:30:00.000Z',
});

const signedInAs = (user: AuthUser) => {
  setSession({ accessToken: 'token-1', expiresIn: 900, user });
};

/** The alert answered in turn: the first load, then each reload. */
function answers(...versions: AlertDetail[]) {
  let index = 0;
  return () => ok(versions[Math.min(index++, versions.length - 1)]);
}

/** The silences answered in turn: the first load, then each reload. */
function silences(...lists: unknown[][]) {
  let index = 0;
  return () => ok({ items: lists[Math.min(index++, lists.length - 1)] });
}

async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
  await user.type(within(dialog).getByLabelText('Code'), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  resetForTests();
  signedInAs(admin);
});
afterEach(() => {
  resetForTests();
});

describe('AlertDetailPage', () => {
  it('says an id that is not an alert id is not found, without asking', async () => {
    const { fetchMock } = stub({});
    renderRoute('/alerts/not-an-id');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stub({
      [GET]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(detail())),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { name: 'Many failed sign-ins' }),
    ).toBeInTheDocument();
  });

  it('shows a viewer why it fired, what its events show, the events and its history, nothing to change', async () => {
    signedInAs(viewer);
    stub({ [GET]: () => ok(detail()) });
    renderRoute(`/alerts/${ALERT_ID}`);

    expect(
      await screen.findByRole('heading', { name: 'Many failed sign-ins', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Alerts' })).toHaveAttribute('href', '/alerts');
    // Why it fired, in words: what it saw, and what its rule looks for.
    const why = screen.getByRole('region', { name: 'Why it fired' });
    expect(within(why).getByRole('listitem')).toHaveTextContent(
      '12 failed sign-ins of Ann Example (user-42) within 15 minutes.',
    );
    expect(within(why).getByText('brute_force')).toHaveClass('mono');
    expect(why).toHaveTextContent(
      'Rule brute_force: 10 or more failed sign-ins of one account within 15 minutes.',
    );
    // Who it is about, by name, then by id.
    const who = screen.getByRole('region', { name: 'Who and when' });
    expect(within(who).getByText('Ann Example')).toBeInTheDocument();
    expect(within(who).getByRole('link', { name: 'user-42' })).toHaveAttribute(
      'href',
      `/apps/${APP_ID}/actors/user-42`,
    );
    expect(within(who).getByText('1,234')).toBeInTheDocument();
    expect(within(who).getByText('nobody')).toBeInTheDocument();
    // What the events behind it have in common: how they ended and why.
    const shown = within(screen.getByRole('region', { name: 'What the events show' }));
    const fact = (label: string) => shown.getByText(label).nextElementSibling;
    expect(fact('Events')).toHaveTextContent(
      `2, ${formatDateTime('2026-10-14T07:59:00.000Z')} to ${formatDateTime('2026-10-14T07:59:30.000Z')}`,
    );
    expect(fact('Outcomes')).toHaveTextContent('failure × 2');
    expect(fact('Reasons')).toHaveTextContent('invalid credentials × 1, mfa failed × 1');
    expect(fact('Actions')).toHaveTextContent('Signed in. × 2');
    expect(fact('Accounts')).toHaveTextContent('1');
    expect(fact('Countries')).toHaveTextContent('ES × 2');
    expect(fact('Devices')).toHaveTextContent('Microsoft Edge on Linux × 2');
    // What the rule saw, as data.
    const summary = screen.getByRole('region', { name: 'What the rule saw' });
    expect(within(summary).getByText('"failures"')).toHaveClass('json-key');
    expect(within(summary).getByText('"10 minutes"')).toHaveClass('json-string');

    // The events, as the explorer lists them, each with its detail a click away.
    const events = screen.getByRole('region', { name: 'Events behind it' });
    expect(within(events).getByText('Oldest first: the first 100 are kept')).toBeInTheDocument();
    expect(within(events).getAllByRole('button', { name: /^View details/ })).toHaveLength(2);
    expect(within(events).getByText('Signed in.')).toBeInTheDocument();
    expect(within(events).getByText('auth.sign_in_again')).toBeInTheDocument();

    const history = within(screen.getByRole('region', { name: 'History' })).getAllByRole(
      'listitem',
    );
    expect(history.map((item) => item.textContent)).toEqual([
      `${formatDateTime('2026-10-14T08:00:00.000Z')} · opened`,
      // With why it was closed.
      `${formatDateTime('2026-10-14T09:00:00.000Z')} · status changed by Admin: open → false positive, A load test of ours`,
      `${formatDateTime('2026-10-14T10:00:00.000Z')} · note by Admin: Looking into it`,
    ]);

    expect(screen.queryByRole('heading', { name: 'Review' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ask the application to act' })).toBeNull();
  });

  it('names who works on it: the assignee, who resolved it and each change', async () => {
    signedInAs(viewer);
    const change = {
      kind: 'assigned',
      userId: admin.id,
      userLabel: admin.name,
      fromStatus: null,
      toStatus: null,
      createdAt: '2026-10-15T09:00:00.000Z',
    };
    stub({
      [GET]: () =>
        ok(
          detail({
            assigneeId: auditor.id,
            assigneeLabel: auditor.name,
            resolvedAt: '2026-10-15T10:00:00.000Z',
            resolvedById: admin.id,
            resolvedByLabel: admin.name,
            activities: [
              { ...change, id: 'a1', note: auditor.id, assigneeLabel: auditor.name },
              // An account gone since: its id stays.
              { ...change, id: 'a2', note: viewer.id, assigneeLabel: null },
              { ...change, id: 'a3', note: 'unassigned', assigneeLabel: null },
              {
                ...change,
                id: 'a4',
                kind: 'notified',
                userId: null,
                userLabel: null,
                note: 'webhook, email',
                assigneeLabel: null,
              },
            ],
          }),
        ),
    });
    renderRoute(`/alerts/${ALERT_ID}`);

    const who = within(await screen.findByRole('region', { name: 'Who and when' }));
    expect(who.getByText('Assigned to').nextElementSibling).toHaveTextContent('Auditor');
    expect(who.getByText('Resolved').nextElementSibling).toHaveTextContent(
      `${formatDateTime('2026-10-15T10:00:00.000Z')} by Admin`,
    );
    const at = formatDateTime('2026-10-15T09:00:00.000Z');
    expect(
      within(screen.getByRole('region', { name: 'History' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `${at} · assigned by Admin to Auditor`,
      `${at} · assigned by Admin to ${viewer.id}`,
      `${at} · assigned by Admin to nobody`,
      `${at} · notified: webhook, email`,
    ]);
  });

  it('says so when this version does not describe a rule, and when no event was kept', async () => {
    stub({
      [GET]: () =>
        ok(
          detail({
            rule: 'future_rule',
            explanation: { looksFor: null, saw: [] },
            evidence: {
              events: 0,
              from: null,
              to: null,
              outcomes: [],
              reasons: [],
              actions: [],
              accounts: 0,
              countries: [],
              devices: [],
            },
            events: [],
          }),
        ),
    });
    renderRoute(`/alerts/${ALERT_ID}`);

    const why = await screen.findByRole('region', { name: 'Why it fired' });
    expect(why).toHaveTextContent(
      'This version of Audit Hub does not describe this rule: what it saw is below, as it kept it.',
    );
    expect(within(why).getByText('future_rule').parentElement).toHaveTextContent(
      /^Rule future_rule$/,
    );
    expect(
      within(screen.getByRole('region', { name: 'What the events show' })).getByText('None kept.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Events behind it' })).getByText('None kept.'),
    ).toBeInTheDocument();
  });

  it('keeps the facts it has when some are missing', async () => {
    stub({
      [GET]: () =>
        ok(
          detail({
            subjectLabel: null,
            evidence: {
              events: 1,
              from: null,
              to: null,
              outcomes: [{ value: 'failure', count: 1 }],
              reasons: [],
              actions: [],
              accounts: 0,
              countries: [],
              devices: [],
            },
          }),
        ),
    });
    renderRoute(`/alerts/${ALERT_ID}`);

    const shown = within(await screen.findByRole('region', { name: 'What the events show' }));
    expect(shown.getByText('Events').nextElementSibling).toHaveTextContent(/^1$/);
    expect(shown.queryByText('Reasons')).toBeNull();
    expect(shown.queryByText('Devices')).toBeNull();
    const who = within(screen.getByRole('region', { name: 'Who and when' }));
    expect(who.getByText('Subject').nextElementSibling).toHaveTextContent(/^user-42$/);
  });

  it('shows a subject that is not an id as text, and who it is assigned to', async () => {
    stub({
      [GET]: () =>
        ok(
          detail({
            subject: 'not an id',
            assigneeId: auditor.id,
            resolvedAt: '2026-10-15T10:00:00.000Z',
            events: [],
          }),
        ),
    });
    renderRoute(`/alerts/${ALERT_ID}`);

    expect(await screen.findByText('not an id', { selector: 'dd span' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'not an id' })).toBeNull();
    expect(screen.getByText(auditor.id)).toBeInTheDocument();
    expect(screen.getByText(formatDateTime('2026-10-15T10:00:00.000Z'))).toBeInTheDocument();
    expect(screen.getByText('None kept.')).toBeInTheDocument();
  });

  it('offers no response action for an alert about no one', async () => {
    stub({ [GET]: () => ok(detail({ subject: null, subjectLabel: null })) });
    renderRoute(`/alerts/${ALERT_ID}`);

    await screen.findByRole('heading', { name: 'Review' });
    const details = screen.getByText('Subject').nextElementSibling;
    expect(details).toHaveTextContent('—');
    expect(screen.queryByRole('heading', { name: 'Ask the application to act' })).toBeNull();
  });

  it('lets an auditor review, never ask for a response action', async () => {
    signedInAs(auditor);
    stub({ [GET]: () => ok(detail()) });
    renderRoute(`/alerts/${ALERT_ID}`);

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ask the application to act' })).toBeNull();
  });
});

describe('reviewing an alert', () => {
  it('changes the status with the version it read, then shows it again', async () => {
    const { calls } = stub({
      [GET]: answers(detail(), detail({ status: 'resolved', version: 4 })),
      [PATCH]: () => ok(detail({ status: 'resolved', version: 4 })),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Review' });
    const save = screen.getByRole('button', { name: 'Save status' });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
    expect(save).toBeEnabled();
    await user.type(screen.getByLabelText('How it was resolved'), '  Password reset by the owner ');
    await user.click(save);

    await vi.waitFor(() => {
      expect(callsTo(calls, GET)).toHaveLength(2);
    });
    await expect(callsTo(calls, PATCH)[0]?.json()).resolves.toEqual({
      status: 'resolved',
      reason: 'Password reset by the owner',
      version: 3,
    });
    expect(await screen.findByLabelText('Status')).toHaveValue('resolved');
    expect(screen.getByRole('button', { name: 'Save status' })).toBeDisabled();
  });

  it('sends nothing when the status did not change', async () => {
    const { calls } = stub({ [GET]: () => ok(detail()) });
    renderRoute(`/alerts/${ALERT_ID}`);

    const save = await screen.findByRole('button', { name: 'Save status' });
    fireEvent.submit(save.closest('form')!);
    expect(callsTo(calls, PATCH)).toHaveLength(0);
  });

  it('reloads the alert when someone changed it meanwhile', async () => {
    const { calls } = stub({
      [GET]: answers(detail(), detail({ status: 'in_review', version: 4 })),
      [PATCH]: () => failure(409, 'The alert changed meanwhile'),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Review' });
    await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
    await user.type(screen.getByLabelText('How it was resolved'), 'Password reset by the owner');
    await user.click(screen.getByRole('button', { name: 'Save status' }));

    await vi.waitFor(() => {
      expect(callsTo(calls, GET)).toHaveLength(2);
    });
    // The page shows what the alert is now, why it reloaded, and the status to choose again.
    expect(await screen.findByLabelText('Status')).toHaveValue('in_review');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Someone changed this alert meanwhile: it was reloaded, check it and try again.',
    );
    expect(screen.getByText('in review', { selector: '.badge' })).toBeInTheDocument();
  });

  it('explains any other failure and keeps the choice', async () => {
    const { calls } = stub({
      [GET]: () => ok(detail()),
      [PATCH]: () => failure(503, 'Unavailable'),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Review' });
    await user.selectOptions(screen.getByLabelText('Status'), 'false_positive');
    await user.type(screen.getByLabelText('Why it is a false positive'), 'A load test of ours');
    await user.click(screen.getByRole('button', { name: 'Save status' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    expect(screen.getByLabelText('Status')).toHaveValue('false_positive');
    expect(callsTo(calls, GET)).toHaveLength(1);
  });

  it('asks why before closing it, and sends nothing until said', async () => {
    const { calls } = stub({ [GET]: () => ok(detail()) });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Review' });
    await user.selectOptions(screen.getByLabelText('Status'), 'false_positive');
    await user.type(screen.getByLabelText('Why it is a false positive'), ' too short ');
    await user.click(screen.getByRole('button', { name: 'Save status' }));

    expect(
      screen.getByText('Say why, in 10 characters or more: it is kept in its history.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Why it is a false positive')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(callsTo(calls, PATCH)).toHaveLength(0);
  });

  it('acknowledges an open alert with the version it read: its escalation stops', async () => {
    const { calls } = stub({
      [GET]: answers(
        detail({ escalations: 2, lastEscalatedAt: '2026-10-15T09:45:00.000Z' }),
        detail({
          status: 'in_review',
          acknowledgedAt: '2026-10-15T10:00:00.000Z',
          acknowledgedById: admin.id,
          acknowledgedByLabel: 'Admin',
          escalations: 2,
          version: 4,
        }),
      ),
      [ACK]: () => ok(detail({ status: 'in_review', version: 4 })),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    expect(await screen.findByText(/Nobody has taken it on yet: escalated 2 times/)).toBeVisible();
    expect(
      screen.getByText(`2 times, last ${formatDateTime('2026-10-15T09:45:00.000Z')}`),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(
      await screen.findByText(`${formatDateTime('2026-10-15T10:00:00.000Z')} by Admin`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    await expect(callsTo(calls, ACK)[0]?.json()).resolves.toEqual({ version: 3 });
  });

  it('reopens a closed alert', async () => {
    const { calls } = stub({
      [GET]: answers(
        detail({ status: 'resolved', resolvedAt: '2026-10-15T10:00:00.000Z' }),
        detail({ version: 4 }),
      ),
      [PATCH]: () => ok(detail({ version: 4 })),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Reopen' }));

    expect(await screen.findByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    await expect(callsTo(calls, PATCH)[0]?.json()).resolves.toEqual({
      status: 'open',
      version: 3,
    });
  });

  it('assigns the alert to the reviewer, who can then unassign it', async () => {
    const { calls } = stub({
      [GET]: answers(
        detail(),
        detail({ assigneeId: admin.id, version: 4 }),
        detail({ assigneeId: null, version: 5 }),
      ),
      [PATCH]: () => ok(detail()),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Assign to me' }));
    const unassign = await screen.findByRole('button', { name: 'Unassign me' });
    expect(screen.getByText('you')).toBeInTheDocument();
    await user.click(unassign);
    expect(await screen.findByRole('button', { name: 'Assign to me' })).toBeInTheDocument();
    expect(screen.getByText('nobody')).toBeInTheDocument();

    const sent = callsTo(calls, PATCH);
    await expect(sent[0]?.json()).resolves.toEqual({ assigneeId: admin.id, version: 3 });
    await expect(sent[1]?.json()).resolves.toEqual({ assigneeId: null, version: 4 });
    expect(callsTo(calls, GET)).toHaveLength(3);
  });

  it('adds a trimmed note, then shows the alert again', async () => {
    const { calls } = stub({
      [GET]: () => ok(detail()),
      [NOTE]: () => json(201, { data: detail(), message: 'Created' }),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const add = await screen.findByRole('button', { name: 'Add note' });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText('Note'), '   ');
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText('Note'), 'Checked the addresses ');
    await user.click(add);

    await vi.waitFor(() => {
      expect(callsTo(calls, GET)).toHaveLength(2);
    });
    await expect(callsTo(calls, NOTE)[0]?.json()).resolves.toEqual({
      note: 'Checked the addresses',
    });
    expect(await screen.findByLabelText('Note')).toHaveValue('');
  });

  it('sends no empty note', async () => {
    const { calls } = stub({ [GET]: () => ok(detail()) });
    renderRoute(`/alerts/${ALERT_ID}`);

    const add = await screen.findByRole('button', { name: 'Add note' });
    fireEvent.submit(add.closest('form')!);
    expect(callsTo(calls, NOTE)).toHaveLength(0);
  });

  it('explains a note that could not be added and keeps it', async () => {
    stub({
      [GET]: () => ok(detail()),
      [NOTE]: () => failure(429, 'Too many requests', { 'Retry-After': '30' }),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Note'), 'Checked the addresses');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait 30 seconds and retry.',
    );
    expect(screen.getByLabelText('Note')).toHaveValue('Checked the addresses');
  });
});

describe('silencing', () => {
  const region = () => screen.findByRole('region', { name: 'Silences' });
  const mute = {
    id: MUTE_ID,
    appId: APP_ID,
    appSlug: 'shop',
    rule: 'brute_force',
    reason: 'Load test of the sign-in',
    until: '2026-10-15T12:00:00.000Z',
    createdById: admin.id,
    createdAt: '2026-10-15T10:00:00.000Z',
    endedAt: null,
    endedById: null,
    active: true,
  };

  it("silences the alert's rule in its application for a while, with a reason", async () => {
    const { calls } = stub({
      [GET]: answers(detail(), detail({ mutedUntil: mute.until, version: 4 })),
      [MUTES]: silences([], [mute]),
      [MUTE]: () => json(201, { data: mute, message: 'Created' }),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    expect(await scope.findByText('None in force for shop.')).toBeInTheDocument();
    await user.click(scope.getByRole('button', { name: 'Silence' }));
    expect(scope.getByLabelText('Why silence it')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(calls, MUTE)).toHaveLength(0);

    await user.selectOptions(scope.getByLabelText('For'), '4 hours');
    await user.type(scope.getByLabelText('Why silence it'), ' Load test of the sign-in ');
    await user.click(scope.getByRole('button', { name: 'Silence' }));

    expect(await scope.findByRole('button', { name: 'Lift' })).toBeInTheDocument();
    expect(scope.getByText('Load test of the sign-in')).toBeInTheDocument();
    await expect(callsTo(calls, MUTE)[0]?.json()).resolves.toEqual({
      appId: APP_ID,
      rule: 'brute_force',
      minutes: 240,
      reason: 'Load test of the sign-in',
    });
    expect(new URL(callsTo(calls, MUTES)[0]?.url ?? '').searchParams.get('appId')).toBe(APP_ID);
    expect(await screen.findByText(formatDateTime(mute.until))).toBeInTheDocument();
  });

  it('lifts a silence in force', async () => {
    const { calls } = stub({
      [GET]: () => ok(detail({ mutedUntil: mute.until })),
      [MUTES]: silences([mute], []),
      [LIFT]: () => ok({ ...mute, active: false, endedAt: '2026-10-15T10:30:00.000Z' }),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    await user.click(await scope.findByRole('button', { name: 'Lift' }));

    expect(await scope.findByText('None in force for shop.')).toBeInTheDocument();
    expect(scope.getByRole('status')).toHaveTextContent('Lifted.');
    expect(callsTo(calls, LIFT)).toHaveLength(1);
  });
});

describe('asking the application to act', () => {
  const region = () => screen.findByRole('region', { name: 'Ask the application to act' });

  it('asks for a reason of 10 characters or more before sending anything', async () => {
    const { calls } = stub({ [GET]: () => ok(detail()) });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    expect(scope.getByText('user-42')).toBeInTheDocument();
    expect(scope.getByText(/acts on the user Ann Example \(/)).toBeInTheDocument();
    await user.type(scope.getByLabelText('Reason'), '  too short  ');
    await user.click(scope.getByRole('button', { name: 'Request' }));

    expect(
      scope.getByText('Say why, in 10 characters or more: it is recorded with the request.'),
    ).toBeInTheDocument();
    expect(scope.getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(calls, REQUEST)).toHaveLength(0);
  });

  it('confirms who is asking, then requests it: another administrator approves it', async () => {
    let attempt = 0;
    const { calls } = stub({
      [GET]: () => ok(detail()),
      [REQUEST]: () =>
        attempt++ === 0
          ? reauthenticate()
          : json(201, { data: requested('pending_approval'), message: 'Created' }),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    await user.selectOptions(scope.getByLabelText('Action'), 'disable account');
    await user.type(scope.getByLabelText('Reason'), '  Account takeover suspected ');
    await user.click(scope.getByRole('button', { name: 'Request' }));
    await confirmItIsYou(user);

    expect(await scope.findByRole('status')).toHaveTextContent(
      'Requested: another administrator approves it under Response actions.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(scope.getByLabelText('Reason')).toHaveValue('');
    const sent = callsTo(calls, REQUEST);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({
      appId: APP_ID,
      subject: 'user-42',
      action: 'disable_account',
      reason: 'Account takeover suspected',
      alertId: ALERT_ID,
    });
    await expect(callsTo(calls, STEP_UP)[0]?.json()).resolves.toEqual({
      password: 'admin-password',
      code: '123456',
    });
    expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');
  });

  it('says what became of a request that needs no approval', async () => {
    const answer = deferred<Response>();
    stub({
      [GET]: () => ok(detail()),
      [REQUEST]: () => answer.promise,
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    await user.type(scope.getByLabelText('Reason'), 'Account takeover suspected');
    await user.click(scope.getByRole('button', { name: 'Request' }));
    expect(await scope.findByRole('button', { name: 'Requesting…' })).toBeDisabled();
    answer.resolve(json(201, { data: requested('dispatched'), message: 'Created' }));

    expect(await scope.findByRole('status')).toHaveTextContent('Requested: dispatched.');
  });

  it('requests nothing when the step-up is cancelled', async () => {
    const { calls } = stub({
      [GET]: () => ok(detail()),
      [REQUEST]: reauthenticate,
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    await user.type(scope.getByLabelText('Reason'), 'Account takeover suspected');
    await user.click(scope.getByRole('button', { name: 'Request' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Nothing was requested: it needs you to confirm it is you.',
    );
    expect(callsTo(calls, REQUEST)).toHaveLength(1);
    expect(scope.getByLabelText('Reason')).toHaveValue('Account takeover suspected');
  });

  it('explains a request that failed', async () => {
    stub({
      [GET]: () => ok(detail()),
      [REQUEST]: () => failure(400, 'action: not accepted by the application'),
    });
    renderRoute(`/alerts/${ALERT_ID}`);
    const user = userEvent.setup();

    const scope = within(await region());
    await user.type(scope.getByLabelText('Reason'), 'Account takeover suspected');
    await user.click(scope.getByRole('button', { name: 'Request' }));

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Check the highlighted data and try again.',
    );
    expect(scope.getByRole('button', { name: 'Request' })).toBeEnabled();
  });
});
