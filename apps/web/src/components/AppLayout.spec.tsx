import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCapabilitiesForTests } from '../auth/capabilities';
import { clearSession, getState, resetForTests, setSession } from '../auth/session';
import type { AuthUser, Role } from '../auth';
import { admin, member } from '../test/fixtures';
import { ok, stubFetch } from '../test/http';
import { renderRoute } from '../test/render';
import { AppLayout } from './AppLayout';

const OVERVIEW = 'GET /api/overview';
const USERS: Record<Role, AuthUser> = {
  member,
  admin,
  viewer: {
    id: '0190b6a1-0000-7000-8000-000000000003',
    email: 'viewer@example.com',
    name: 'Viewer',
    role: 'viewer',
  },
  auditor: {
    id: '0190b6a1-0000-7000-8000-000000000004',
    email: 'auditor@example.com',
    name: 'Auditor',
    role: 'auditor',
  },
};
const userWith = (role: Role) => USERS[role];

const READING = ['Overview', 'Events', 'Security', 'Alerts', 'SOC view', 'Detection rules'];
const MENUS: [Role, string[]][] = [
  ['member', ['Home', 'Account']],
  ['viewer', [...READING, 'Account']],
  ['auditor', [...READING, 'Exports', 'Account']],
  [
    'admin',
    [
      ...READING,
      'Response actions',
      'Exports',
      'Applications',
      'Retention',
      'Integrity',
      'Users',
      'Invitations',
      'Account',
    ],
  ],
];

beforeEach(() => {
  resetForTests();
  resetCapabilitiesForTests();
});
afterEach(() => {
  resetForTests();
});

async function signedInAt(role: Role, path = '/') {
  const fetched = stubFetch({
    [OVERVIEW]: () => ok({ since: '2026-10-14T09:00:00.000Z', integrity: null, apps: [] }),
  });
  setSession({ accessToken: 'token-1', expiresIn: 900, user: userWith(role) });
  const router = renderRoute(path);
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  return { ...fetched, router, nav };
}

const linksOf = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('AppLayout', () => {
  it.each(MENUS)('shows a %s the links to what they may open', async (role, links) => {
    const { nav } = await signedInAt(role);
    expect(linksOf(nav)).toEqual(links);
    // The page under it settles: the welcome or the overview.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('links every item to its page, the current one marked', async () => {
    const { nav } = await signedInAt('admin');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/',
      '/events',
      '/security',
      '/alerts',
      '/soc',
      '/detection-rules',
      '/response-actions',
      '/exports',
      '/apps',
      '/retention',
      '/integrity',
      '/admin/users',
      '/admin/invitations',
      '/account',
    ]);
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('marks Home only on the home page itself', async () => {
    stubFetch({
      'GET /api/account/mfa': () => ok({ confirmedAt: null, recoveryCodesLeft: 0 }),
      'GET /api/auth/capabilities': () => ok({ passwordReset: false, signUp: false }),
    });
    setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
    renderRoute('/account');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByText('Not set up.')).toBeInTheDocument();
  });

  it('shows who is signed in, and signs them out', async () => {
    const { router } = await signedInAt('member');
    expect(within(screen.getByRole('banner')).getByText(member.email)).toBeInTheDocument();
    stubFetch({
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
      'GET /api/auth/capabilities': () => ok({ passwordReset: false, signUp: false }),
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    await vi.waitFor(() => {
      expect(getState()).toEqual({ status: 'anonymous', user: null, signedOut: 'done' });
    });
  });

  it('shows nothing without a signed-in person', () => {
    clearSession();
    const router = createMemoryRouter([{ path: '/', element: <AppLayout /> }]);
    const { container } = render(<RouterProvider router={router} />);
    expect(container).toBeEmptyDOMElement();
  });
});
