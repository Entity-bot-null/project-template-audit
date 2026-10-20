import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DetectionRules, EscalationPolicies } from '../../audit/types';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// What raises alerts and when unacknowledged ones escalate: read by everyone
// who reads alerts, tuned by an administrator after a step-up.

const RULES = 'GET /api/detection-rules';
const RULE = 'PUT /api/detection-rules/brute_force';
const POLICIES = 'GET /api/escalation-policies';
const POLICY = 'PUT /api/escalation-policies/critical';
const STEP_UP = 'POST /api/account/step-up';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);

const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000005',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const rules = (enabled = true): DetectionRules => ({
  maxNewAlertsPerHour: 20,
  items: [
    {
      id: 'brute_force',
      name: 'Brute force',
      description: 'Many failed sign-ins of one account, or from one address.',
      kind: 'periodic',
      severity: 'high',
      grouping: 'account or address',
      window: '15 minutes, every 5 minutes',
      autoResolves: false,
      params: [
        {
          name: 'accountFailures',
          label: 'Failed sign-ins of an account',
          unit: 'sign-ins',
          default: 10,
          min: 3,
          max: 1000,
        },
      ],
      settings: {
        enabled,
        severity: null,
        params: enabled ? {} : { accountFailures: 25 },
        updatedById: enabled ? null : admin.id,
        updatedAt: enabled ? null : '2026-10-15T10:00:00.000Z',
      },
    },
    {
      id: 'suspicious_sign_in',
      name: 'Suspicious sign-in',
      description: "A successful sign-in unlike the account's earlier ones.",
      kind: 'realtime',
      severity: null,
      grouping: 'account',
      window: null,
      autoResolves: false,
      params: [],
      settings: { enabled: true, severity: null, params: {}, updatedById: null, updatedAt: null },
    },
  ],
});

const policies: EscalationPolicies = {
  available: { email: true, chat: [] },
  items: [
    {
      severity: 'critical',
      enabled: true,
      firstAfterMinutes: 15,
      repeatEveryMinutes: 30,
      maxEscalations: 3,
      channels: ['email', 'chat'],
      updatedById: null,
      updatedAt: '2026-10-15T09:00:00.000Z',
    },
    {
      severity: 'low',
      enabled: false,
      firstAfterMinutes: 60,
      repeatEveryMinutes: 240,
      maxEscalations: 1,
      channels: [],
      updatedById: null,
      updatedAt: '2026-10-15T09:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('DetectionRulesPage', () => {
  it('shows a viewer every rule and the escalation, with nothing to change', async () => {
    setSession({ accessToken: 'token-1', expiresIn: 900, user: viewer });
    stubFetch({ [RULES]: () => ok(rules()), [POLICIES]: () => ok(policies) });
    renderRoute('/detection-rules');

    const rule = (await screen.findByRole('heading', { name: /Brute force/ })).closest('li')!;
    expect(within(rule).getByText('high')).toHaveClass('badge', 'sev-high');
    expect(within(rule).getByText('Every 5 minutes, over a window')).toBeInTheDocument();
    expect(within(rule).getByText('10 sign-ins (default)')).toBeInTheDocument();
    expect(screen.getByText('severity per detection')).toBeInTheDocument();
    expect(
      screen.getByText(/at most 20 new alerts per application within an hour/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Tune this rule')).toBeNull();

    const escalation = screen.getByRole('region', { name: 'Escalation' });
    expect(within(escalation).getByText(/sends email, and to no chat channel/)).toBeInTheDocument();
    const critical = within(escalation).getByRole('row', { name: /critical/ });
    expect(within(critical).getByText('15 min')).toBeInTheDocument();
    expect(within(critical).getByText('email, chat')).toBeInTheDocument();
    expect(within(escalation).queryByText(/Change the escalation/)).toBeNull();
  });

  it('lets an administrator turn a rule off and set its threshold, within bounds', async () => {
    const { calls } = stubFetch({
      [RULES]: (() => {
        let loads = 0;
        return () => ok(rules(loads++ === 0));
      })(),
      [POLICIES]: () => ok(policies),
      [RULE]: () => ok(rules(false).items[0]),
    });
    renderRoute('/detection-rules');
    const user = userEvent.setup();

    const rule = (await screen.findByRole('heading', { name: /Brute force/ })).closest('li')!;
    await user.click(within(rule).getByText('Tune this rule'));
    const threshold = within(rule).getByLabelText(
      'Failed sign-ins of an account (sign-ins, 3 to 1000)',
    );
    await user.clear(threshold);
    await user.type(threshold, '2');
    await user.click(within(rule).getByRole('button', { name: 'Save' }));
    expect(within(rule).getByRole('alert')).toHaveTextContent(
      'Failed sign-ins of an account: a whole number from 3 to 1000.',
    );
    expect(callsTo(calls, RULE)).toHaveLength(0);

    await user.clear(threshold);
    await user.type(threshold, '25');
    await user.click(within(rule).getByLabelText('On: it raises alerts'));
    expect(within(rule).getByText(/Off, it raises nothing/)).toBeInTheDocument();
    await user.selectOptions(within(rule).getByLabelText('Severity'), 'critical');
    await user.click(within(rule).getByRole('button', { name: 'Save' }));

    expect(await within(rule).findByRole('status')).toHaveTextContent('Saved.');
    await expect(callsTo(calls, RULE)[0]?.json()).resolves.toEqual({
      enabled: false,
      severity: 'critical',
      params: { accountFailures: 25 },
    });
    expect(await within(rule).findByText('25 sign-ins (default 10)')).toBeInTheDocument();
    expect(within(rule).getByText('off')).toBeInTheDocument();
  });

  it('asks an administrator to confirm it is them before changing the escalation', async () => {
    let attempt = 0;
    const { calls } = stubFetch({
      [RULES]: () => ok(rules()),
      [POLICIES]: () => ok(policies),
      [POLICY]: () =>
        attempt++ === 0
          ? failure(403, 'Reauthentication required', {
              'Audit-Error': 'reauthentication_required',
            })
          : ok(policies.items[0]),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute('/detection-rules');
    const user = userEvent.setup();

    await user.click(await screen.findByText('Change the escalation of critical alerts'));
    const form = screen.getByText('Change the escalation of critical alerts').closest('details')!;
    await user.clear(within(form).getByLabelText('First after (minutes)'));
    await user.type(within(form).getByLabelText('First after (minutes)'), '10');
    await user.click(within(form).getByLabelText('Chat (Slack, Teams)'));
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
    await user.type(within(dialog).getByLabelText('Code'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await within(form).findByRole('status')).toHaveTextContent('Saved.');
    const sent = callsTo(calls, POLICY);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({
      enabled: true,
      firstAfterMinutes: 10,
      repeatEveryMinutes: 30,
      maxEscalations: 3,
      channels: ['email'],
    });
    expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');
  });

  it('says nothing was saved when the step-up is cancelled', async () => {
    stubFetch({
      [RULES]: () => ok(rules()),
      [POLICIES]: () => ok(policies),
      [RULE]: () =>
        failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' }),
    });
    renderRoute('/detection-rules');
    const user = userEvent.setup();

    const rule = (await screen.findByRole('heading', { name: /Brute force/ })).closest('li')!;
    await user.click(within(rule).getByText('Tune this rule'));
    await user.click(within(rule).getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await within(rule).findByRole('alert')).toHaveTextContent(
      'Nothing was saved: it needs you to confirm it is you.',
    );
  });
});
