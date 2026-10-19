import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSession, resetForTests, setSession } from '../auth/session';
import type { AuthUser } from '../auth';
import { admin, member } from '../test/fixtures';
import { ok, stubFetch } from '../test/http';
import { renderRoute } from '../test/render';
import { IndexPage } from './IndexPage';

const OVERVIEW = 'GET /api/overview';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000003',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const signedInAs = (user: AuthUser) => {
  setSession({ accessToken: 'token-1', expiresIn: 900, user });
};

beforeEach(() => {
  resetForTests();
});
afterEach(() => {
  resetForTests();
});

describe('IndexPage', () => {
  it('welcomes a member, who reads no audit data', async () => {
    const { fetchMock } = stubFetch({});
    signedInAs(member);
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: `Welcome, ${member.name}` })).toBeVisible();
    expect(screen.getByText(member.email, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the overview to those who read audit data', async () => {
    const { calls } = stubFetch({
      [OVERVIEW]: () => ok({ since: '2026-10-14T09:00:00.000Z', integrity: null, apps: [] }),
    });
    signedInAs(viewer);
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(
      await screen.findByText('No application is assigned to you yet: ask an administrator.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Welcome/ })).toBeNull();
    expect(calls.map(routeOf)).toEqual([OVERVIEW]);
  });

  it('offers an admin to register the first application', async () => {
    stubFetch({
      [OVERVIEW]: () => ok({ since: '2026-10-14T09:00:00.000Z', integrity: null, apps: [] }),
    });
    signedInAs(admin);
    renderRoute('/');
    expect(await screen.findByRole('link', { name: 'Register an application' })).toHaveAttribute(
      'href',
      '/apps/new',
    );
  });

  it('shows nothing without a signed-in person', () => {
    clearSession();
    const { container } = render(<IndexPage />);
    expect(container).toBeEmptyDOMElement();
  });
});
