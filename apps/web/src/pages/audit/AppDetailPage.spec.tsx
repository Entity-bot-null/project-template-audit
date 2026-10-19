import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedApp, WebhookDeliveries } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, json, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// One connected application: its settings (only what changed is sent), its
// signing keys and webhook secret (shown once), and its webhook deliveries.

const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const GET = `GET /api/connected-apps/${APP_ID}`;
const PATCH = `PATCH /api/connected-apps/${APP_ID}`;
const DELIVERIES = `GET /api/connected-apps/${APP_ID}/webhook-deliveries`;
const NEW_KEY = `POST /api/connected-apps/${APP_ID}/keys`;
const REVOKE = `DELETE /api/connected-apps/${APP_ID}/keys/key-1`;
const PING = `POST /api/connected-apps/${APP_ID}/webhook-test`;
const NEW_SECRET = `POST /api/connected-apps/${APP_ID}/webhook-secret`;
const DELETION = `POST /api/connected-apps/${APP_ID}/deletion`;
const STEP_UP = 'POST /api/account/step-up';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });

const app = (overrides: Partial<ConnectedApp> = {}): ConnectedApp => ({
  id: APP_ID,
  slug: 'shop',
  name: 'Shop',
  environment: 'production',
  status: 'active',
  webhookUrl: 'https://shop.example.com/api/audit/webhooks',
  correlationEnabled: true,
  acceptedResponseActions: ['revoke_sessions'],
  requireActionApproval: false,
  heartbeatTimeoutSec: 900,
  rateLimitPerMinute: 6000,
  createdAt: '2026-09-01T10:00:00.000Z',
  keys: [
    {
      id: 'key-1',
      createdAt: '2026-09-01T10:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: '2026-10-15T09:00:00.000Z',
    },
    {
      id: 'key-0',
      createdAt: '2026-08-01T10:00:00.000Z',
      expiresAt: '2026-12-01T10:00:00.000Z',
      revokedAt: '2026-09-01T10:00:00.000Z',
      lastUsedAt: null,
    },
  ],
  ...overrides,
});

type Delivery = WebhookDeliveries['items'][number];
const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  id: 'delivery-1',
  target: 'app',
  type: 'alert.opened',
  status: 'delivered',
  attempts: 1,
  lastStatus: 200,
  lastError: null,
  nextAttemptAt: '2026-10-15T09:00:00.000Z',
  deliveredAt: '2026-10-15T09:00:01.000Z',
  expiresAt: '2026-10-22T09:00:00.000Z',
  createdAt: '2026-10-15T09:00:00.000Z',
  ...overrides,
});
const deliveries = (items: Delivery[], total = items.length): WebhookDeliveries => ({
  items,
  total,
});

const variables = (name: string) => ({ [name]: 'shown-once-value' });

function stub(handlers: Parameters<typeof stubFetch>[0]) {
  return stubFetch({
    [GET]: () => ok(app()),
    [DELIVERIES]: () => ok(deliveries([])),
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

const settings = async () => within(await screen.findByRole('region', { name: 'Settings' }));
const webhooks = async () => within(await screen.findByRole('region', { name: 'Webhooks' }));
const endOfService = async () =>
  within(await screen.findByRole('region', { name: 'End of service' }));
const progress = (status: string, deleted: number, held = 0, waiting = 0) =>
  ok({ status, deleted, held, waiting });

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('AppDetailPage', () => {
  it('says an id that is not one is not found, without asking', async () => {
    const { fetchMock } = stubFetch({});
    renderRoute('/apps/not-an-id');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '← Applications' })).toHaveAttribute('href', '/apps');
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stub({ [GET]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(app())) });
    renderRoute(`/apps/${APP_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Shop', level: 1 })).toBeInTheDocument();
  });

  it('shows the application, its links, its keys and its deliveries', async () => {
    stub({
      [DELIVERIES]: () =>
        ok(
          deliveries([
            delivery(),
            delivery({
              id: 'delivery-2',
              type: 'response_action.requested',
              status: 'failed',
              attempts: 5,
              lastStatus: 500,
              lastError: 'Internal Server Error',
            }),
            delivery({
              id: 'delivery-3',
              type: 'alert.escalated',
              target: 'slack',
              status: 'pending',
              lastStatus: null,
              lastError: 'connection refused',
            }),
            delivery({
              id: 'delivery-4',
              type: 'alert.resolved',
              status: 'sending',
              lastStatus: null,
              lastError: null,
            }),
          ]),
        ),
    });
    renderRoute(`/apps/${APP_ID}`);

    expect(await screen.findByRole('heading', { name: 'Shop', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('shop', { selector: '.mono' })).toBeInTheDocument();
    for (const [name, path] of [
      ['Events', '/events'],
      ['Security', '/security'],
      ['Retention', '/retention'],
    ] as const) {
      expect(within(screen.getByRole('main')).getByRole('link', { name })).toHaveAttribute(
        'href',
        `${path}?appId=${APP_ID}`,
      );
    }

    const keys = within(screen.getByRole('region', { name: 'Signing keys' }));
    const active = within(keys.getByRole('row', { name: /key-1/ }));
    expect(active.getByRole('button', { name: 'Revoke' })).toBeEnabled();
    expect(keys.getByRole('row', { name: /key-0/ })).not.toContainElement(
      keys.queryByRole('button', { name: 'Revoke' }),
    );
    expect(keys.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);

    const hooks = await webhooks();
    expect(hooks.getByText('https://shop.example.com/api/audit/webhooks')).toBeInTheDocument();
    expect(await hooks.findByRole('row', { name: /alert\.opened/ })).toHaveTextContent('HTTP 200');
    expect(hooks.getByRole('row', { name: /response_action\.requested/ })).toHaveTextContent(
      'HTTP 500 · Internal Server Error',
    );
    expect(hooks.getByRole('row', { name: /slack/ })).toHaveTextContent('connection refused');
    expect(hooks.getByRole('row', { name: /sending/ })).toHaveTextContent('—');
  });

  it('pages through the deliveries', async () => {
    const { calls } = stub({ [DELIVERIES]: () => ok(deliveries([delivery()], 45)) });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const hooks = await webhooks();

    await hooks.findByText('1–20 of 45');
    await user.click(hooks.getByRole('button', { name: 'Next' }));
    await hooks.findByText('21–40 of 45');
    const query = new URL(callsTo(calls, DELIVERIES).at(-1)?.url ?? '').searchParams;
    expect(Object.fromEntries(query)).toEqual({ limit: '20', offset: '20' });
    await user.click(hooks.getByRole('button', { name: 'Previous' }));
    await hooks.findByText('1–20 of 45');
  });

  it('explains deliveries that could not be loaded and retries them', async () => {
    let attempt = 0;
    stub({
      [DELIVERIES]: () =>
        attempt++ === 0 ? failure(503, 'Unavailable') : ok(deliveries([delivery()])),
    });
    renderRoute(`/apps/${APP_ID}`);
    const hooks = await webhooks();

    expect(await hooks.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(hooks.getByRole('button', { name: 'Retry' }));
    expect(await hooks.findByRole('row', { name: /alert\.opened/ })).toBeInTheDocument();
  });

  it('says there are none yet', async () => {
    stub({});
    renderRoute(`/apps/${APP_ID}`);
    expect(await (await webhooks()).findByText('None yet.')).toBeInTheDocument();
  });
});

describe('the settings', () => {
  it('sends nothing when nothing changed', async () => {
    const { calls } = stub({});
    renderRoute(`/apps/${APP_ID}`);
    const scope = await settings();

    await userEvent.setup().click(scope.getByRole('button', { name: 'Save' }));
    expect(scope.getByRole('status')).toHaveTextContent('Nothing to save.');
    expect(callsTo(calls, PATCH)).toHaveLength(0);
  });

  it('sends only what changed, after the step-up, then shows the application again', async () => {
    let attempt = 0;
    let loaded = 0;
    const { calls } = stub({
      [GET]: () => ok(loaded++ === 0 ? app() : app({ name: 'Shop EU' })),
      [PATCH]: () => (attempt++ === 0 ? reauthenticate() : ok(app({ name: 'Shop EU' }))),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const scope = await settings();

    await user.clear(scope.getByLabelText('Name'));
    await user.type(scope.getByLabelText('Name'), ' Shop EU ');
    await user.click(scope.getByRole('button', { name: 'Save' }));
    await confirmItIsYou(user);

    expect(await screen.findByRole('heading', { name: 'Shop EU', level: 1 })).toBeInTheDocument();
    const sent = callsTo(calls, PATCH);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({ name: 'Shop EU' });
    expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');
    expect((await settings()).getByLabelText('Name')).toHaveValue('Shop EU');
  });

  it('sends every field that changed', async () => {
    const { calls } = stub({ [PATCH]: () => ok(app()) });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const scope = await settings();

    await user.selectOptions(scope.getByLabelText('Status'), 'suspended');
    await user.clear(scope.getByLabelText('Webhook URL'));
    await user.clear(scope.getByLabelText('Heartbeat timeout (seconds)'));
    await user.type(scope.getByLabelText('Heartbeat timeout (seconds)'), '600');
    await user.clear(scope.getByLabelText('Rate limit (events a minute)'));
    await user.type(scope.getByLabelText('Rate limit (events a minute)'), '1000');
    await user.click(
      scope.getByRole('checkbox', {
        name: 'Correlate its users with other applications (by email pseudonym)',
      }),
    );
    await user.click(scope.getByRole('checkbox', { name: 'disable account' }));
    await user.click(scope.getByRole('checkbox', { name: 'require password change' }));
    await user.click(scope.getByRole('checkbox', { name: 'revoke sessions' }));
    await user.click(
      scope.getByRole('checkbox', {
        name: 'A second administrator approves each response action',
      }),
    );
    await user.click(scope.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(callsTo(calls, GET)).toHaveLength(2);
    });
    await expect(callsTo(calls, PATCH)[0]?.json()).resolves.toEqual({
      status: 'suspended',
      webhookUrl: null,
      heartbeatTimeoutSec: 600,
      rateLimitPerMinute: 1000,
      correlationEnabled: false,
      // In the contract's order, whatever the order they were ticked in.
      acceptedResponseActions: ['require_password_change', 'disable_account'],
      requireActionApproval: true,
    });
  });

  it('gives an application without a webhook URL one, and offers no test meanwhile', async () => {
    const { calls } = stub({
      [GET]: () => ok(app({ webhookUrl: null })),
      [PATCH]: () => ok(app()),
    });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const hooks = await webhooks();

    expect(
      hooks.getByText('No webhook URL: alerts and response actions do not reach the application.'),
    ).toBeInTheDocument();
    expect(hooks.getByRole('button', { name: 'Send a test' })).toBeDisabled();

    const scope = await settings();
    await user.type(scope.getByLabelText('Webhook URL'), 'https://shop.example.com/hooks');
    await user.click(scope.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(callsTo(calls, PATCH)).toHaveLength(1);
    });
    await expect(callsTo(calls, PATCH)[0]?.json()).resolves.toEqual({
      webhookUrl: 'https://shop.example.com/hooks',
    });
  });

  it('names the field the API refused', async () => {
    stub({
      [PATCH]: () => failure(400, 'heartbeatTimeoutSec: Too small: expected number to be >=60'),
    });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const scope = await settings();

    await user.clear(scope.getByLabelText('Heartbeat timeout (seconds)'));
    await user.type(scope.getByLabelText('Heartbeat timeout (seconds)'), '5');
    await user.click(scope.getByRole('button', { name: 'Save' }));

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Check "Heartbeat timeout (seconds)".',
    );
    expect(scope.getByLabelText('Heartbeat timeout (seconds)')).toHaveValue('5');
  });

  it('changes nothing when the step-up is cancelled', async () => {
    const { calls } = stub({ [PATCH]: reauthenticate });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const scope = await settings();

    await user.selectOptions(scope.getByLabelText('Status'), 'suspended');
    await user.click(scope.getByRole('button', { name: 'Save' }));
    await cancelStepUp(user);

    expect(await scope.findByRole('alert')).toHaveTextContent(
      'Nothing changed: it needs you to confirm it is you.',
    );
    expect(callsTo(calls, PATCH)).toHaveLength(1);
    expect(callsTo(calls, GET)).toHaveLength(1);
  });

  it('explains any other failure', async () => {
    stub({ [PATCH]: () => failure(503, 'Unavailable') });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const scope = await settings();

    await user.selectOptions(scope.getByLabelText('Status'), 'suspended');
    await user.click(scope.getByRole('button', { name: 'Save' }));
    expect(await scope.findByRole('alert')).toHaveTextContent('The service is unavailable');
  });
});

describe('the signing keys', () => {
  it('makes a new key after the step-up, shows it once, then the keys again', async () => {
    let attempt = 0;
    const { calls } = stub({
      [NEW_KEY]: () =>
        attempt++ === 0
          ? reauthenticate()
          : json(201, { data: { variables: variables('AUDIT_HUB_SIGNING_KEY') }, message: 'OK' }),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New signing key' }));
    await confirmItIsYou(user);

    const shown = within(await screen.findByRole('region', { name: 'New signing key' }));
    expect(shown.getByTestId('secret-variables')).toHaveTextContent(
      'AUDIT_HUB_SIGNING_KEY=shown-once-value',
    );
    await user.click(shown.getByRole('checkbox', { name: 'I have stored them' }));
    await user.click(shown.getByRole('button', { name: 'Done' }));

    expect(await screen.findByRole('region', { name: 'Signing keys' })).toBeInTheDocument();
    expect(screen.queryByTestId('secret-variables')).toBeNull();
    expect(callsTo(calls, NEW_KEY)).toHaveLength(2);
    expect(callsTo(calls, GET)).toHaveLength(2);
  });

  it('revokes a key, then shows the keys again', async () => {
    const { calls } = stub({ [REVOKE]: () => new Response(null, { status: 204 }) });
    renderRoute(`/apps/${APP_ID}`);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Revoke' }));
    await vi.waitFor(() => {
      expect(callsTo(calls, GET)).toHaveLength(2);
    });
    expect(callsTo(calls, REVOKE)).toHaveLength(1);
  });

  it('explains a key that could not be revoked', async () => {
    const { calls } = stub({ [REVOKE]: () => failure(404, 'No such key') });
    renderRoute(`/apps/${APP_ID}`);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Revoke' }));
    const keys = within(screen.getByRole('region', { name: 'Signing keys' }));
    expect(await keys.findByRole('alert')).toHaveTextContent('Not found.');
    expect(keys.getByRole('button', { name: 'Revoke' })).toBeEnabled();
    expect(callsTo(calls, GET)).toHaveLength(1);
  });
});

describe('the webhook', () => {
  it('sends a test, then shows the deliveries again', async () => {
    let listed = 0;
    const { calls } = stub({
      [PING]: () => json(202, { data: { id: 'delivery-9' }, message: 'Accepted' }),
      [DELIVERIES]: () =>
        ok(deliveries(listed++ === 0 ? [] : [delivery({ id: 'delivery-9', type: 'ping' })])),
    });
    renderRoute(`/apps/${APP_ID}`);
    const hooks = await webhooks();

    await userEvent.setup().click(hooks.getByRole('button', { name: 'Send a test' }));
    expect(await hooks.findByRole('status')).toHaveTextContent(
      'A test webhook is on its way: its delivery shows below.',
    );
    expect(await hooks.findByRole('row', { name: /ping/ })).toBeInTheDocument();
    expect(callsTo(calls, PING)).toHaveLength(1);
    expect(callsTo(calls, STEP_UP)).toHaveLength(0);
  });

  it('explains a test that could not be sent', async () => {
    stub({ [PING]: () => failure(429, 'Too many requests') });
    renderRoute(`/apps/${APP_ID}`);
    const hooks = await webhooks();

    await userEvent.setup().click(hooks.getByRole('button', { name: 'Send a test' }));
    expect(await hooks.findByRole('alert')).toHaveTextContent('Too many attempts.');
  });

  it('makes a new secret after the step-up and shows it once', async () => {
    let attempt = 0;
    stub({
      [NEW_SECRET]: () =>
        attempt++ === 0
          ? reauthenticate()
          : json(201, {
              data: { variables: variables('AUDIT_HUB_WEBHOOK_SECRET') },
              message: 'OK',
            }),
      [STEP_UP]: () => session('token-2', admin),
    });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const hooks = await webhooks();

    await user.click(hooks.getByRole('button', { name: 'New webhook secret' }));
    await confirmItIsYou(user);

    expect(await hooks.findByTestId('secret-variables')).toHaveTextContent(
      'AUDIT_HUB_WEBHOOK_SECRET=shown-once-value',
    );
    expect(hooks.queryByRole('button', { name: 'Send a test' })).toBeNull();
    await user.click(hooks.getByRole('checkbox', { name: 'I have stored them' }));
    await user.click(hooks.getByRole('button', { name: 'Done' }));

    expect(await hooks.findByRole('button', { name: 'New webhook secret' })).toBeEnabled();
    expect(screen.queryByTestId('secret-variables')).toBeNull();
  });

  it('makes no new secret when the step-up is cancelled', async () => {
    stub({ [NEW_SECRET]: reauthenticate });
    renderRoute(`/apps/${APP_ID}`);
    const user = userEvent.setup();
    const hooks = await webhooks();

    await user.click(hooks.getByRole('button', { name: 'New webhook secret' }));
    await cancelStepUp(user);

    expect(await hooks.findByRole('alert')).toHaveTextContent(
      'Nothing changed: it needs you to confirm it is you.',
    );
  });

  describe('the end of its service', () => {
    it('deletes the log of a suspended application after its slug and a step-up, going on while it says deleting, then shows it retired', async () => {
      let attempt = 0;
      let loaded = 0;
      const answers = [reauthenticate(), progress('deleting', 5000), progress('deleted', 1200)];
      const { calls } = stub({
        [GET]: () => ok(loaded++ === 0 ? app({ status: 'suspended' }) : app({ status: 'retired' })),
        [DELETION]: () => answers[attempt++] ?? failure(500, 'Unexpected'),
        [STEP_UP]: () => session('token-2', admin),
      });
      renderRoute(`/apps/${APP_ID}`);
      const user = userEvent.setup();
      const scope = await endOfService();
      await user.click(scope.getByRole('button', { name: 'Delete its audit log…' }));
      expect(scope.getByRole('button', { name: 'Delete its audit log' })).toBeDisabled();
      await user.type(scope.getByLabelText('Type its slug, shop, to confirm'), ' shop ');
      await user.click(scope.getByRole('button', { name: 'Delete its audit log' }));
      await confirmItIsYou(user);

      expect(await screen.findByText(/Retired: its audit log was deleted/)).toBeInTheDocument();
      const sent = callsTo(calls, DELETION);
      expect(sent).toHaveLength(3);
      for (const request of sent)
        await expect(request.json()).resolves.toEqual({ confirm: 'shop' });
      expect(sent[2]?.headers.get('Authorization')).toBe('Bearer token-2');
      // Nothing left to change on a retired application.
      expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Signing keys' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Webhooks' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'End of service' })).not.toBeInTheDocument();
    });

    it('offers no deletion while the application is active', async () => {
      stub({});
      renderRoute(`/apps/${APP_ID}`);
      const scope = await endOfService();
      expect(scope.getByText(/Suspend it first/)).toBeInTheDocument();
      expect(scope.getByRole('button', { name: 'Delete its audit log…' })).toBeDisabled();
    });

    it('says what stops it: a wrong slug, a legal hold, events waiting for their seal, too long a run', async () => {
      const answers = [
        failure(400, "confirm: type the application's slug to delete its log"),
        progress('held', 10, 3),
        progress('waiting', 4, 0, 2),
        ...Array.from({ length: 6 }, () => progress('deleting', 5000)),
        failure(409, 'Suspend the application first'),
      ];
      let attempt = 0;
      stub({
        [GET]: () => ok(app({ status: 'suspended' })),
        [DELETION]: () => answers[attempt++] ?? failure(500, 'Unexpected'),
        [STEP_UP]: () => session('token-2', admin),
      });
      renderRoute(`/apps/${APP_ID}`);
      const user = userEvent.setup();
      const scope = await endOfService();
      await user.click(scope.getByRole('button', { name: 'Delete its audit log…' }));
      await user.type(scope.getByLabelText('Type its slug, shop, to confirm'), 'Shop');
      const submit = () =>
        user.click(scope.getByRole('button', { name: /^(Delete its audit log|Continue)$/ }));
      await submit();
      expect(await scope.findByRole('alert')).toHaveTextContent('Type its slug, shop, exactly.');
      await submit();
      expect(await scope.findByRole('alert')).toHaveTextContent(
        '10 events deleted. A legal hold keeps 3 of them, or names the application',
      );
      await submit();
      expect(await scope.findByRole('status')).toHaveTextContent(
        '4 events deleted. 2 wait for their seal, within 2 minutes: continue then.',
      );
      await submit();
      expect(await scope.findByRole('status')).toHaveTextContent(
        '30,000 events deleted so far: continue to delete the rest.',
      );
      await user.click(scope.getByRole('button', { name: 'Continue' }));
      expect(await scope.findByRole('alert')).toHaveTextContent('Suspend it first');
      await user.click(scope.getByRole('button', { name: 'Cancel' }));
      expect(scope.getByRole('button', { name: 'Delete its audit log…' })).toBeEnabled();
    });

    it('deletes nothing when the step-up is cancelled', async () => {
      const { calls } = stub({
        [GET]: () => ok(app({ status: 'suspended' })),
        [DELETION]: () => reauthenticate(),
      });
      renderRoute(`/apps/${APP_ID}`);
      const user = userEvent.setup();
      const scope = await endOfService();
      await user.click(scope.getByRole('button', { name: 'Delete its audit log…' }));
      await user.type(scope.getByLabelText('Type its slug, shop, to confirm'), 'shop');
      await user.click(scope.getByRole('button', { name: 'Delete its audit log' }));
      await cancelStepUp(user);
      expect(await scope.findByRole('alert')).toHaveTextContent(
        'Nothing changed: it needs you to confirm it is you.',
      );
      expect(callsTo(calls, DELETION)).toHaveLength(1);
    });
  });
});
