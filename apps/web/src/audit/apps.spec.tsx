import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, resetForTests, setSession } from '../auth/session';
import { admin, member } from '../test/fixtures';
import { deferred, failure, ok, stubFetch } from '../test/http';
import { forgetVisibleApps, useVisibleApps } from './apps';
import type { VisibleApp } from './types';

const APPS = 'GET /api/account/apps';
const SHOP: VisibleApp = {
  appId: '0190b6a1-0000-7000-8000-00000000000a',
  slug: 'shop',
  name: 'Shop',
  environment: 'production',
  status: 'active',
  system: false,
};
const answer = (...apps: VisibleApp[]) => ok({ items: apps });

function Apps() {
  const { state } = useVisibleApps();
  if (state.kind === 'loading') return <p>Loading</p>;
  if (state.kind === 'failed') return <p>Failed {state.failure.status}</p>;
  return <p>Apps: {state.data.items.map((app) => app.name).join(', ') || 'none'}</p>;
}

/** Mounts a page that asks for the applications, and waits for its answer. */
async function visit(text: RegExp) {
  const { unmount } = render(<Apps />);
  expect(await screen.findByText(text)).toBeInTheDocument();
  unmount();
}

const signedInAs = (user: typeof member) => {
  setSession({ accessToken: 'token-1', expiresIn: 900, user });
};

beforeEach(() => {
  resetForTests();
  forgetVisibleApps();
  signedInAs(member);
});
afterEach(() => {
  resetForTests();
  forgetVisibleApps();
});

describe('useVisibleApps', () => {
  it('asks once per person, every page after the first reusing the answer', async () => {
    const { calls } = stubFetch({ [APPS]: () => answer(SHOP) });
    await visit(/^Apps: Shop$/);
    await visit(/^Apps: Shop$/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('asks again for another person', async () => {
    let next = 0;
    const { calls } = stubFetch({ [APPS]: () => (next++ === 0 ? answer(SHOP) : answer()) });
    await visit(/^Apps: Shop$/);
    signedInAs(admin);
    await visit(/^Apps: none$/);
    expect(calls).toHaveLength(2);
  });

  it('asks again after a change, once forgotten', async () => {
    let next = 0;
    const renamed = { ...SHOP, name: 'Shop EU' };
    const { calls } = stubFetch({
      [APPS]: () => (next++ === 0 ? answer(SHOP) : answer(renamed)),
    });
    await visit(/^Apps: Shop$/);
    forgetVisibleApps();
    await visit(/^Apps: Shop EU$/);
    await visit(/^Apps: Shop EU$/);
    expect(calls).toHaveLength(2);
  });

  it('does not keep a failed answer: the next page asks again', async () => {
    let next = 0;
    const { calls } = stubFetch({
      [APPS]: () => (next++ === 0 ? failure(503, 'Database unreachable') : answer(SHOP)),
    });
    await visit(/^Failed 503$/);
    await visit(/^Apps: Shop$/);
    await visit(/^Apps: Shop$/);
    expect(calls).toHaveLength(2);
  });

  it('keeps a newer answer when an older, forgotten request fails late', async () => {
    const late = deferred<Response>();
    let next = 0;
    const { calls } = stubFetch({
      [APPS]: () => (next++ === 0 ? late.promise : answer(SHOP)),
    });
    const first = render(<Apps />);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    forgetVisibleApps();
    await visit(/^Apps: Shop$/);

    late.resolve(failure(503, 'Database unreachable'));
    expect(await screen.findByText(/^Failed 503$/)).toBeInTheDocument();
    first.unmount();
    await visit(/^Apps: Shop$/);
    expect(calls).toHaveLength(2);
  });

  it('asks for no one in particular when signed out', async () => {
    clearSession();
    const { calls } = stubFetch({ [APPS]: () => failure(401, 'Not authenticated') });
    await visit(/^Failed 401$/);
    expect(calls[0]!.headers.get('Authorization')).toBeNull();
  });
});
