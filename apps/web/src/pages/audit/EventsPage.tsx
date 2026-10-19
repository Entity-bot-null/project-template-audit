import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, type operations } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { useVisibleApps } from '../../audit/apps';
import { AppPicker } from '../../audit/AppPicker';
import { downloadExport } from '../../audit/download';
import { EventTable } from '../../audit/EventTable';
import { type FilterName, type Filters, FILTER_NAMES, filtersOf } from '../../audit/event-filters';
import { DateTimeField, SelectField } from '../../audit/fields';
import { asOptions, fromLocalInput, toLocalInput } from '../../audit/format';
import { LoadView } from '../../audit/LoadView';
import { CursorPager } from '../../audit/Pager';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

type EventQuery = NonNullable<operations['ExplorerController_search']['parameters']['query']>;

const CATEGORIES = ['security', 'audit', 'access', 'system', 'audit_access'] as const;
const OUTCOMES = ['success', 'failure', 'denied'] as const;
const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
const CLIENT_TYPES = ['web', 'ios', 'android', 'api', 'job'] as const;
/** Risk scores from the ingest (0–100): a severity's weight, and more for its outcome and signals. */
const RISK_LEVELS = [
  ['30', '30 or more (medium)'],
  ['60', '60 or more (high)'],
  ['80', '80 or more (critical)'],
] as const;
const PAGE_SIZE = 50;

// The audit log, searched: every filter is in the URL (a search can be
// shared, reloaded and gone back to), newest first a page at a time. The API
// decides which applications the person sees, and records every search by
// the names of its filters (never their values).
export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersOf(params);
  const cursor = params.get('cursor');
  const key = params.toString();
  const { state, retry } = useLoader(
    () =>
      call(
        api.GET('/api/events', {
          params: {
            // The API validates every value: a wrong one answers 400.
            query: {
              ...filters,
              ...(cursor === null ? {} : { cursor }),
              limit: PAGE_SIZE,
            } as EventQuery,
          },
        }),
      ),
    key,
  );

  const go = (next: Filters, nextCursor?: string) => {
    const search = new URLSearchParams();
    for (const name of FILTER_NAMES) {
      const value = next[name];
      if (value !== undefined && value !== '') search.set(name, value);
    }
    if (nextCursor !== undefined) search.set('cursor', nextCursor);
    setParams(search);
  };

  return (
    <section className="stack" aria-labelledby="events-heading">
      <h1 id="events-heading">Events</h1>
      <EventFilters key={key} filters={filters} onSearch={go} />
      {/* Keyed by the search: an export's message belongs to the filters it ran with. */}
      <ExportButtons key={`export?${key}`} filters={filters} />
      <LoadView state={state} retry={retry} label="events">
        {(page) => (
          <>
            {page.blocked === true && (
              <Alert tone="info">
                The person searched for is blocked after an erasure in some of these applications:
                their events there are left out.
              </Alert>
            )}
            <EventTable events={page.items} caption="Newest first" />
            <CursorPager
              nextCursor={page.nextCursor}
              atNewest={cursor === null}
              onNewest={() => {
                go(filters);
              }}
              onOlder={(next) => {
                go(filters, next);
              }}
            />
          </>
        )}
      </LoadView>
    </section>
  );
}

function EventFilters({
  filters,
  onSearch,
}: {
  filters: Filters;
  onSearch: (filters: Filters) => void;
}) {
  const apps = useVisibleApps();
  const [draft, setDraft] = useState<Filters>(filters);
  const [emailError, setEmailError] = useState<string | null>(null);
  const set = (name: FilterName) => (value: string) => {
    setDraft((current) => ({ ...current, [name]: value }));
  };
  const text = (name: FilterName) => draft[name] ?? '';
  const more = [
    'actorId',
    'email',
    'ip',
    'country',
    'clientType',
    'resourceType',
    'resourceId',
    'requestId',
  ].some((name) => filters[name as FilterName] !== undefined);

  return (
    <form
      className="stack"
      aria-label="Filters"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (text('email') !== '' && text('appId') === '') {
          setEmailError('Choose an application: an email is searched by its pseudonym there.');
          return;
        }
        setEmailError(null);
        onSearch(draft);
      }}
    >
      <div className="filters">
        {apps.state.kind === 'loaded' && (
          <AppPicker
            apps={apps.state.data.items}
            value={text('appId')}
            onChange={set('appId')}
            allLabel="Every application"
          />
        )}
        <DateTimeField
          label="From"
          value={toLocalInput(draft.from ?? null)}
          onChange={(value) => {
            set('from')(fromLocalInput(value) ?? '');
          }}
        />
        <DateTimeField
          label="To"
          value={toLocalInput(draft.to ?? null)}
          onChange={(value) => {
            set('to')(fromLocalInput(value) ?? '');
          }}
        />
        <TextField
          label="Action"
          name="action"
          value={text('action')}
          onChange={set('action')}
          error={null}
        />
        <SelectField
          label="Outcome"
          value={text('outcome')}
          onChange={set('outcome')}
          options={asOptions(OUTCOMES)}
          anyLabel="Any"
        />
        <SelectField
          label="Severity"
          value={text('severity')}
          onChange={set('severity')}
          options={asOptions(SEVERITIES)}
          anyLabel="Any"
        />
        <SelectField
          label="Risk"
          value={text('minRisk')}
          onChange={set('minRisk')}
          options={RISK_LEVELS}
          anyLabel="Any"
        />
        <SelectField
          label="Category"
          value={text('category')}
          onChange={set('category')}
          options={asOptions(CATEGORIES)}
          anyLabel="Any"
        />
      </div>
      <details open={more || emailError !== null}>
        <summary>More filters</summary>
        <div className="filters">
          <TextField
            label="Actor id"
            name="actorId"
            value={text('actorId')}
            onChange={set('actorId')}
            error={null}
          />
          <TextField
            label="Email"
            type="email"
            name="email"
            value={text('email')}
            onChange={set('email')}
            error={emailError}
          />
          <TextField
            label="IP address"
            name="ip"
            value={text('ip')}
            onChange={set('ip')}
            error={null}
          />
          <TextField
            label="Country"
            name="country"
            maxLength={2}
            value={text('country')}
            onChange={set('country')}
            error={null}
          />
          <SelectField
            label="Client"
            value={text('clientType')}
            onChange={set('clientType')}
            options={asOptions(CLIENT_TYPES)}
            anyLabel="Any"
          />
          <TextField
            label="Resource type"
            name="resourceType"
            value={text('resourceType')}
            onChange={set('resourceType')}
            error={null}
          />
          <TextField
            label="Resource id"
            name="resourceId"
            value={text('resourceId')}
            onChange={set('resourceId')}
            error={null}
          />
          <TextField
            label="Request id"
            name="requestId"
            value={text('requestId')}
            onChange={set('requestId')}
            error={null}
          />
        </div>
      </details>
      <div className="actions">
        <button type="submit">Search</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setDraft({});
            setEmailError(null);
            onSearch({});
          }}
        >
          Clear
        </button>
      </div>
    </form>
  );
}

/** Administrators and auditors export what the filters match, after a step-up. */
function ExportButtons({ filters }: { filters: Filters }) {
  const auth = useAuth();
  const stepUp = useStepUp();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  if (auth.status !== 'authenticated' || !['admin', 'auditor'].includes(auth.user.role))
    return null;

  async function exportAs(format: 'csv' | 'jsonl') {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      downloadExport({ ...filters, format } as Parameters<typeof downloadExport>[0]),
    );
    setBusy(false);
    if (result.ok) {
      setOutcome({
        ok: true,
        text: 'Exported. Its digest, to check a copy later, is under Exports.',
      });
    } else if (isReauthenticationRequired(result.failure)) {
      setOutcome({
        ok: false,
        text: 'Nothing was exported: an export needs you to confirm it is you.',
      });
    } else {
      setOutcome({ ok: false, text: describeFailure(result.failure) });
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void exportAs('csv')}
        >
          Export CSV
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void exportAs('jsonl')}
        >
          Export JSON Lines
        </button>
        {busy && <span role="status">Exporting…</span>}
      </div>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
    </div>
  );
}
