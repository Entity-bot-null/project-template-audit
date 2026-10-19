import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreatedApp } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { deferred, failure, json, ok, session, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// Registering an application: checked before sending, sent after a step-up,
// and its secrets shown once before its page.

const CREATE = 'POST /api/connected-apps';
const STEP_UP = 'POST /api/account/step-up';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const callsTo = (calls: Request[], route: string) =>
  calls.filter((call) => routeOf(call) === route);
const reauthenticate = () =>
  failure(403, 'Reauthentication required', { 'Audit-Error': 'reauthentication_required' });

const created: CreatedApp = {
  app: {
    id: APP_ID,
    slug: 'shop',
    name: 'Shop',
    environment: 'staging',
    status: 'active',
    webhookUrl: 'https://shop.example.com/api/audit/webhooks',
    correlationEnabled: false,
    acceptedResponseActions: [],
    requireActionApproval: false,
    heartbeatTimeoutSec: 900,
    rateLimitPerMinute: 6000,
    createdAt: '2026-10-15T10:00:00.000Z',
    keys: [],
  },
  credentials: {
    variables: {
      AUDIT_HUB_APP_ID: APP_ID,
      AUDIT_HUB_SIGNING_KEY: 'signing-key-shown-once',
    },
  },
};

async function fill(
  fields: { name?: string; slug?: string; environment?: string; webhookUrl?: string },
  user = userEvent.setup(),
) {
  await screen.findByRole('heading', { name: 'Register an application' });
  if (fields.name !== undefined) await user.type(screen.getByLabelText('Name'), fields.name);
  if (fields.slug !== undefined) await user.type(screen.getByLabelText('Slug'), fields.slug);
  if (fields.environment !== undefined) {
    await user.clear(screen.getByLabelText('Environment'));
    if (fields.environment !== '') {
      await user.type(screen.getByLabelText('Environment'), fields.environment);
    }
  }
  if (fields.webhookUrl !== undefined) {
    await user.type(screen.getByLabelText('Webhook URL (optional)'), fields.webhookUrl);
  }
  await user.click(screen.getByRole('button', { name: 'Register' }));
  return user;
}

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('AppNewPage', () => {
  it('checks every field before sending anything, and focuses the first wrong one', async () => {
    const { fetchMock } = stubFetch({});
    renderRoute('/apps/new');
    await fill({ name: '   ', slug: 'Shop', environment: 'Prod', webhookUrl: 'shop.example.com' });

    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Lowercase letters, digits and dashes, 2 to 31, starting with a letter. It never changes.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Lowercase letters, digits and dashes, up to 16: production, staging…'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A URL: the application’s POST /api/audit/webhooks.'),
    ).toBeInTheDocument();
    for (const label of ['Name', 'Slug', 'Environment', 'Webhook URL (optional)']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '← Applications' })).toHaveAttribute('href', '/apps');
  });

  it('refuses an empty environment', async () => {
    const { fetchMock } = stubFetch({});
    renderRoute('/apps/new');
    await fill({ name: 'Shop', slug: 'shop', environment: '' });

    expect(
      screen.getByText('Lowercase letters, digits and dashes, up to 16: production, staging…'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers after the step-up, shows its secrets once, then opens its page', async () => {
    let attempt = 0;
    const { calls } = stubFetch({
      [CREATE]: () =>
        attempt++ === 0 ? reauthenticate() : json(201, { data: created, message: 'Created' }),
      [STEP_UP]: () => session('token-2', admin),
      // The application's page, where the person lands.
      [`GET /api/connected-apps/${APP_ID}`]: () => ok(created.app),
      [`GET /api/connected-apps/${APP_ID}/webhook-deliveries`]: () => ok({ items: [], total: 0 }),
    });
    const router = renderRoute('/apps/new');
    const user = await fill({
      name: '  Shop ',
      slug: 'shop',
      environment: 'staging',
      webhookUrl: 'https://shop.example.com/api/audit/webhooks',
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(dialog).getByLabelText('Password'), 'admin-password');
    await user.type(within(dialog).getByLabelText('Code'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('heading', { name: 'Shop is registered' })).toBeInTheDocument();
    expect(screen.getByTestId('secret-variables')).toHaveTextContent(
      `AUDIT_HUB_APP_ID=${APP_ID} AUDIT_HUB_SIGNING_KEY=signing-key-shown-once`,
    );
    const sent = callsTo(calls, CREATE);
    expect(sent).toHaveLength(2);
    await expect(sent[1]?.json()).resolves.toEqual({
      name: 'Shop',
      slug: 'shop',
      environment: 'staging',
      webhookUrl: 'https://shop.example.com/api/audit/webhooks',
    });
    expect(sent[1]?.headers.get('Authorization')).toBe('Bearer token-2');

    const go = screen.getByRole('button', { name: 'Go to the application' });
    expect(go).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I have stored them' }));
    await user.click(go);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/apps/${APP_ID}`);
    });
    // Replaced: going back never shows the form, nor the secrets, again.
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('heading', { name: 'Shop' })).toBeInTheDocument();
  });

  it('sends no webhook URL when none is given, and says it is registering meanwhile', async () => {
    const answer = deferred<Response>();
    const { calls } = stubFetch({ [CREATE]: () => answer.promise });
    renderRoute('/apps/new');
    await fill({ name: 'Shop', slug: 'shop' });

    expect(await screen.findByRole('button', { name: 'Registering…' })).toBeDisabled();
    answer.resolve(json(201, { data: created, message: 'Created' }));
    expect(await screen.findByRole('heading', { name: 'Shop is registered' })).toBeInTheDocument();
    await expect(callsTo(calls, CREATE)[0]?.json()).resolves.toEqual({
      name: 'Shop',
      slug: 'shop',
      environment: 'production',
    });
  });

  it('asks for another slug when it is taken', async () => {
    stubFetch({ [CREATE]: () => failure(409, 'The slug is taken') });
    renderRoute('/apps/new');
    await fill({ name: 'Shop', slug: 'shop' });

    expect(await screen.findByText('This slug is taken: choose another one.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Slug')).toHaveFocus();
    });
  });

  it('says which webhook URLs are accepted when the API refuses it', async () => {
    stubFetch({ [CREATE]: () => failure(400, 'webhookUrl: must be a public https URL') });
    renderRoute('/apps/new');
    await fill({ name: 'Shop', slug: 'shop', webhookUrl: 'http://10.0.0.1/hook' });

    expect(
      await screen.findByText(
        'Use https (http only on this machine) and an address on the internet.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Webhook URL (optional)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('registers nothing when the step-up is cancelled', async () => {
    const { calls } = stubFetch({ [CREATE]: reauthenticate });
    renderRoute('/apps/new');
    const user = await fill({ name: 'Shop', slug: 'shop' });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing was registered: it needs you to confirm it is you.',
    );
    expect(callsTo(calls, CREATE)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled();
  });

  it.each([
    [400, 'name: too long', 'Check the highlighted data and try again.'],
    [503, 'Unavailable', 'The service is unavailable. Try again later.'],
  ])('explains a %i it cannot place on a field', async (status, message, shown) => {
    stubFetch({ [CREATE]: () => failure(status, message) });
    renderRoute('/apps/new');
    await fill({ name: 'Shop', slug: 'shop' });

    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
  });
});
