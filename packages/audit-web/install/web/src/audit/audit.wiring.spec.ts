import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetForTests, setSession } from '../auth/session';
import { member } from '../test/fixtures';
import { failure, ok, stubFetch } from '../test/http';
import { outcomeOf, startAudit } from './audit.wiring';
import { reportAudit } from './report';

// The connector's adapter in the web app (audit.wiring.ts) against the API
// stubbed with fetch: the route, the session's token, the page going away.
// Created once by `pnpm connector add --kind spa`; the project's own code
// from then on.

const ROUTE = 'POST /api/audit/client-events';

beforeEach(() => {
  resetForTests();
});
afterEach(() => {
  visibility('visible');
  resetForTests();
});

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The page is hidden (and may be going away): the reporter sends what it has. */
async function pageHide(calls: Request[], count: number) {
  visibility('hidden');
  await expect.poll(() => calls.length).toBe(count);
}

describe('the SPA connector in the app', () => {
  it("sends the page's events for the signed-in user, with the session's token, kept alive", async () => {
    const { calls } = stubFetch({ [ROUTE]: () => ok({ results: [] }) });
    setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
    const stop = startAudit();
    reportAudit('client.navigation.return_path_rejected');
    await pageHide(calls, 1);

    const [request] = calls;
    expect(request?.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request?.keepalive).toBe(true);
    const body = (await request?.json()) as { events: { action: string }[] };
    expect(body.events.map((event) => event.action)).toEqual([
      'client.navigation.return_path_rejected',
    ]);
    stop();
  });

  it('keeps the events when the API cannot take them now, and drops them when it refuses', async () => {
    let answer = () => failure(503, 'Unavailable');
    const { calls } = stubFetch({ [ROUTE]: () => answer() });
    setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
    const stop = startAudit();
    reportAudit('client.navigation.return_path_rejected');
    await pageHide(calls, 1);
    answer = () => failure(404, 'Not found');
    await pageHide(calls, 2);
    visibility('hidden');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
    stop();
  });

  it('sends nothing signed out', async () => {
    const { calls } = stubFetch({});
    const stop = startAudit();
    reportAudit('client.navigation.return_path_rejected');
    visibility('hidden');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
    stop();
  });

  it('reads a failure as later or refused', () => {
    expect([0, 401, 429, 500, 503].map(outcomeOf)).toEqual([
      'later',
      'later',
      'later',
      'later',
      'later',
    ]);
    expect([400, 403, 404, 413].map(outcomeOf)).toEqual([
      'refused',
      'refused',
      'refused',
      'refused',
    ]);
  });
});
