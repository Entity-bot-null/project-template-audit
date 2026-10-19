import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDateTime } from '../../audit/format';
import type { ConnectedApp } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// The connected applications, for administrators.

const LIST = 'GET /api/connected-apps';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';

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
      expiresAt: null,
      revokedAt: '2026-09-01T10:00:00.000Z',
      lastUsedAt: null,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'admin-token', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('AppsPage', () => {
  it('lists the applications, each linked to its page, with its active keys', async () => {
    stubFetch({
      [LIST]: () =>
        ok([
          app(),
          app({
            id: '0190b6a1-0000-7000-8000-0000000000a2',
            slug: 'shop-staging',
            environment: 'staging',
            status: 'suspended',
            keys: [],
          }),
        ]),
    });
    renderRoute('/apps');

    const rows = await screen.findAllByRole('link', { name: 'Shop' });
    expect(rows.map((link) => link.getAttribute('href'))).toEqual([
      `/apps/${APP_ID}`,
      '/apps/0190b6a1-0000-7000-8000-0000000000a2',
    ]);
    const first = within(screen.getByRole('row', { name: /shop production/ }));
    expect(first.getByText('1 active')).toBeInTheDocument();
    expect(first.getByText('active', { selector: '.badge' })).toHaveClass('status-active');
    expect(first.getByText(formatDateTime('2026-09-01T10:00:00.000Z'))).toBeInTheDocument();
    const second = within(screen.getByRole('row', { name: /shop-staging/ }));
    expect(second.getByText('0 active')).toBeInTheDocument();
    expect(second.getByText('suspended')).toHaveClass('badge', 'status-suspended');
    expect(screen.getByRole('link', { name: 'Register an application' })).toHaveAttribute(
      'href',
      '/apps/new',
    );
  });

  it('invites to register the first one', async () => {
    stubFetch({ [LIST]: () => ok([]) });
    renderRoute('/apps');
    expect(
      await screen.findByText(
        'No application yet: register the first one to receive its audit log.',
      ),
    ).toBeInTheDocument();
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stubFetch({ [LIST]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok([app()])) });
    renderRoute('/apps');

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Shop' })).toBeInTheDocument();
  });
});
