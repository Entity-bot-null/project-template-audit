import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '../../audit/format';
import type { ExportJob, ExportJobPage } from '../../audit/types';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// The exports made: their filters, their rows and the digest of what was sent.

const LIST = 'GET /api/exports';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const DIGEST = 'n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=';
const queryOf = (request: Request | undefined) =>
  Object.fromEntries(new URL(request?.url ?? '').searchParams);

const auditor: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'auditor@example.com',
  name: 'Auditor',
  role: 'auditor',
};

const job = (overrides: Partial<ExportJob> = {}): ExportJob => ({
  id: '0190b6a1-0000-7000-8000-0000000000e1',
  requestedById: admin.id,
  format: 'csv',
  status: 'completed',
  rowCap: 100000,
  rowCount: 1234,
  digest: DIGEST,
  filters: { appId: APP_ID, category: 'security' },
  startedAt: '2026-10-15T09:00:00.000Z',
  finishedAt: '2026-10-15T09:00:05.000Z',
  ...overrides,
});

const page = (items: ExportJob[], total = items.length): ExportJobPage => ({ items, total });

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'admin-token', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('ExportsPage', () => {
  it('lists the exports with their rows, digest and filters', async () => {
    const { calls } = stubFetch({
      [LIST]: () =>
        ok(
          page([
            job(),
            job({
              id: '0190b6a1-0000-7000-8000-0000000000e2',
              format: 'jsonl',
              status: 'running',
              rowCount: null,
              digest: null,
              filters: {},
              finishedAt: null,
            }),
          ]),
        ),
    });
    renderRoute('/exports');

    const items = await screen.findAllByRole('listitem');
    const done = within(items[0]!);
    expect(
      done.getByText(`${formatDateTime('2026-10-15T09:00:00.000Z')} · CSV`),
    ).toBeInTheDocument();
    expect(done.getByText('completed')).toHaveClass('badge', 'status-completed');
    expect(done.getByText('1,234 (at most 100,000)')).toBeInTheDocument();
    expect(done.getByText(DIGEST)).toBeInTheDocument();
    expect(done.getByText(formatDateTime('2026-10-15T09:00:05.000Z'))).toBeInTheDocument();
    // Its filters, as JSON.
    expect(done.getByText('"category"')).toHaveClass('json-key');
    expect(done.getByText(JSON.stringify(APP_ID))).toHaveClass('json-string');
    expect(done.getByText('0190b6a1-0000-7000-8000-0000000000e1')).toBeInTheDocument();

    const running = within(items[1]!);
    expect(
      running.getByText(`${formatDateTime('2026-10-15T09:00:00.000Z')} · JSON Lines`),
    ).toBeInTheDocument();
    expect(running.getByText('— (at most 100,000)')).toBeInTheDocument();
    expect(running.getAllByText('—')).toHaveLength(2);
    expect(running.getByText('{}')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'New export from the explorer' })).toHaveAttribute(
      'href',
      '/events',
    );
    expect(queryOf(calls[0])).toEqual({ limit: '20', offset: '0' });
  });

  it('pages through the exports in the URL', async () => {
    const { calls } = stubFetch({ [LIST]: () => ok(page([job()], 45)) });
    const router = renderRoute('/exports');
    const user = userEvent.setup();

    await screen.findByText('1–20 of 45');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?offset=20');
    });
    await screen.findByText('21–40 of 45');
    expect(queryOf(calls.at(-1))).toEqual({ limit: '20', offset: '20' });

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    await screen.findByText('1–20 of 45');
  });

  it('starts from the first page when the offset of the URL is wrong', async () => {
    const { calls } = stubFetch({ [LIST]: () => ok(page([job()])) });
    renderRoute('/exports?offset=abc');
    await screen.findByText('1–1 of 1');
    expect(queryOf(calls[0])).toEqual({ limit: '20', offset: '0' });
  });

  it('says there is none yet', async () => {
    stubFetch({ [LIST]: () => ok(page([])) });
    renderRoute('/exports');
    expect(await screen.findByText('None yet.')).toBeInTheDocument();
  });

  it('is open to auditors', async () => {
    setSession({ accessToken: 'auditor-token', expiresIn: 900, user: auditor });
    const { calls } = stubFetch({ [LIST]: () => ok(page([job()])) });
    renderRoute('/exports');
    expect(await screen.findByText(DIGEST)).toBeInTheDocument();
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer auditor-token');
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stubFetch({
      [LIST]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(page([job()]))),
    });
    renderRoute('/exports');

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(DIGEST)).toBeInTheDocument();
  });
});
