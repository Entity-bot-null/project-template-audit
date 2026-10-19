import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDateTime } from '../../audit/format';
import type { IntegrityStatus } from '../../audit/types';
import { resetForTests, setSession } from '../../auth/session';
import { admin } from '../../test/fixtures';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

// Whether the audit log is intact: the verifications, the last checkpoint and
// every stream's sealing.

const STATUS = 'GET /api/integrity/status';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const HUB_ID = '0190b6a1-0000-7000-8000-0000000000a0';

const status: IntegrityStatus = {
  verifications: [
    {
      id: 'run-2',
      trigger: 'scheduled',
      outcome: 'failed',
      sealsChecked: 1500,
      eventsChecked: '120000',
      failures: 2,
      failureSample: [
        { stream: 'shop/security', sealNo: '41', problem: 'digest_mismatch' },
        { stream: 'shop/audit', sealNo: '7', problem: 'missing_event' },
      ],
      startedAt: '2026-10-15T02:00:00.000Z',
      finishedAt: '2026-10-15T02:05:00.000Z',
    },
    {
      id: 'run-1',
      trigger: 'on_demand',
      outcome: 'passed',
      sealsChecked: 1490,
      eventsChecked: '119000',
      failures: 0,
      failureSample: null,
      startedAt: '2026-10-14T02:00:00.000Z',
      finishedAt: '2026-10-14T02:04:00.000Z',
    },
    {
      id: 'run-0',
      trigger: 'scheduled',
      outcome: 'error',
      sealsChecked: 0,
      eventsChecked: '0',
      failures: 0,
      failureSample: null,
      startedAt: '2026-10-13T02:00:00.000Z',
      finishedAt: '2026-10-13T02:00:01.000Z',
    },
  ],
  lastCheckpoint: {
    id: 'checkpoint-1',
    digest: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    createdAt: '2026-10-15T03:00:00.000Z',
  },
  streams: [
    {
      appId: APP_ID,
      slug: 'shop',
      category: 'audit_access',
      lastSealNo: '41',
      sealedThrough: '2026-10-15T01:00:00.000Z',
      unsealedEvents: 0,
    },
    {
      appId: HUB_ID,
      slug: 'audit-hub',
      category: 'security',
      lastSealNo: null,
      sealedThrough: null,
      unsealedEvents: 1200,
    },
  ],
};

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'admin-token', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('IntegrityPage', () => {
  it('shows each verification, a failed one with a sample of what failed', async () => {
    stubFetch({ [STATUS]: () => ok(status) });
    renderRoute('/integrity');

    const region = within(await screen.findByRole('region', { name: 'Verifications' }));
    // The runs, not the items of a failure sample's list.
    const list = region.getAllByRole('list')[0]!;
    const runs = region.getAllByRole('listitem').filter((item) => item.parentElement === list);
    expect(runs).toHaveLength(3);
    const [failed, passed, errored] = runs.map((run) => within(run));
    expect(failed!.getByText('failure', { selector: '.badge' })).toHaveClass('outcome-failure');
    expect(runs[0]).toHaveTextContent(
      `failed · ${formatDateTime('2026-10-15T02:05:00.000Z')} · 1,500 seals, 120000 events (scheduled)`,
    );
    expect(failed!.getByText('2 failures')).toBeInTheDocument();
    expect(failed!.getByText('"digest_mismatch"')).toHaveClass('json-string');
    expect(failed!.getByText('"missing_event"')).toHaveClass('json-string');

    expect(passed!.getByText('success', { selector: '.badge' })).toHaveClass('outcome-success');
    expect(runs[1]).toHaveTextContent('passed');
    expect(runs[1]).toHaveTextContent('(on demand)');
    expect(passed!.queryByText(/failures/)).toBeNull();
    expect(errored!.getByText('failure', { selector: '.badge' })).toBeInTheDocument();
    expect(runs[2]).toHaveTextContent('error');
  });

  it('shows the last checkpoint and every stream', async () => {
    stubFetch({ [STATUS]: () => ok(status) });
    renderRoute('/integrity');

    const checkpoint = await screen.findByRole('region', { name: 'Last checkpoint' });
    expect(checkpoint).toHaveTextContent(
      `${formatDateTime('2026-10-15T03:00:00.000Z')}: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`,
    );

    const streams = within(screen.getByRole('region', { name: 'Streams' }));
    const sealed = within(streams.getByRole('row', { name: /shop/ }));
    expect(sealed.getByText('audit access')).toBeInTheDocument();
    expect(sealed.getByText('41')).toBeInTheDocument();
    expect(sealed.getByText(formatDateTime('2026-10-15T01:00:00.000Z'))).toBeInTheDocument();
    expect(sealed.getByText('0')).not.toHaveClass('outcome-error');
    const behind = streams.getByRole('row', { name: /audit-hub/ });
    expect(within(behind).getAllByText('—')).toHaveLength(2);
    expect(within(behind).getByText('1,200')).toHaveClass('outcome-error');
  });

  it('says when nothing ran yet', async () => {
    stubFetch({
      [STATUS]: () => ok({ verifications: [], lastCheckpoint: null, streams: [] }),
    });
    renderRoute('/integrity');

    expect(
      await screen.findByText('None yet: the first one runs within a day.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Last checkpoint' })).getByText('None yet.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Streams' })).getAllByRole('row'),
    ).toHaveLength(1);
  });

  it('explains a failure and retries on demand', async () => {
    let attempt = 0;
    stubFetch({ [STATUS]: () => (attempt++ === 0 ? failure(503, 'Unavailable') : ok(status)) });
    renderRoute('/integrity');

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Verifications' })).toBeInTheDocument();
  });
});
