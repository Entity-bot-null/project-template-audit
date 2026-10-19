import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import type { EventPage, EventSummary } from '../../audit/types';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const SHOP = '0190b6a1-0000-7000-8000-0000000000a1';
const PATH = `/apps/${SHOP}/resources/order/ord-7`;
const HISTORY = `GET /api/connected-apps/${SHOP}/resources/order/ord-7`;

const queryOf = (request: Request | undefined) =>
  Object.fromEntries(new URL(request?.url ?? 'http://localhost/').searchParams);

function summary(index: number, action: string): EventSummary {
  return {
    id: `0190b6a1-0000-7000-8000-00000000e00${String(index)}`,
    eventId: `0190b6a1-0000-7000-8000-00000000f00${String(index)}`,
    appId: SHOP,
    appSlug: 'shop',
    recordedAt: '2026-10-15T08:00:00.000Z',
    occurredAt: '2026-10-15T08:00:00.000Z',
    category: 'audit',
    action,
    outcome: 'success',
    severity: 'info',
    riskScore: 0,
    description: null,
    actor: { type: 'user', id: 'user-42', role: 'customer', label: null },
    resource: { type: 'order', id: 'ord-7' },
    requestId: 'req-1',
    httpStatus: 200,
    clientType: 'web',
    country: 'ES',
    ipScope: 'public',
  };
}
const page = (items: EventSummary[], nextCursor: string | null = null): EventPage => ({
  items,
  nextCursor,
});

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: viewer });
});
afterEach(() => {
  resetForTests();
});

describe('ResourcePage', () => {
  it("shows the resource's history, newest first", async () => {
    const { calls } = stubFetch({ [HISTORY]: () => ok(page([summary(1, 'order.created')])) });
    renderRoute(PATH);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('order ord-7');
    const table = await screen.findByRole('table', { name: 'Newest first' });
    expect(within(table).getByRole('cell', { name: 'order.created' })).toBeInTheDocument();
    // Each event's detail opens from its row.
    expect(within(table).getByRole('button', { name: /^View details/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Events' })).toHaveAttribute('href', '/events');
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    expect(queryOf(calls[0])).toEqual({ limit: '50' });
  });

  it('says when nothing happened to it', async () => {
    stubFetch({ [HISTORY]: () => ok(page([])) });
    renderRoute(PATH);
    expect(await screen.findByText('No events match.')).toBeInTheDocument();
  });

  it('goes to older events with the cursor, and back to the newest', async () => {
    const { calls } = stubFetch({
      [HISTORY]: (request) =>
        new URL(request.url).searchParams.get('cursor') === 'cursor-2'
          ? ok(page([summary(2, 'order.paid')]))
          : ok(page([summary(1, 'order.created')], 'cursor-2')),
    });
    const router = renderRoute(PATH);
    const user = userEvent.setup();
    await screen.findByRole('cell', { name: 'order.created' });

    expect(screen.getByRole('button', { name: 'Newest' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByRole('cell', { name: 'order.paid' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?cursor=cursor-2');
    expect(queryOf(calls[1])).toEqual({ limit: '50', cursor: 'cursor-2' });
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Newest' }));
    expect(await screen.findByRole('cell', { name: 'order.created' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('explains a failure and retries', async () => {
    let attempt = 0;
    stubFetch({
      [HISTORY]: () =>
        attempt++ === 0 ? failure(503, 'Unavailable') : ok(page([summary(1, 'order.created')])),
    });
    renderRoute(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('cell', { name: 'order.created' })).toBeInTheDocument();
  });

  it.each([
    ['an application id that is not a uuid', '/apps/shop/resources/order/ord-7'],
    ['a resource type that is not snake_case', `/apps/${SHOP}/resources/Order/ord-7`],
    ['a resource id with characters ids never have', `/apps/${SHOP}/resources/order/a%20b`],
  ])('answers not found for %s, without asking the API', async (_case, path) => {
    const { fetchMock } = stubFetch({});
    renderRoute(path);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
