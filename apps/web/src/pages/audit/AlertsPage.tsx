import { lazy, Suspense, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type operations } from '../../api/client';
import { call } from '../../api/errors';
import { useVisibleApps } from '../../audit/apps';
import { AppPicker } from '../../audit/AppPicker';
import { Badge, PersonName } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { asOptions, formatDateTime, formatNumber } from '../../audit/format';
import { alertPath } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { OffsetPager } from '../../audit/Pager';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

type AlertQuery = NonNullable<operations['AlertsController_list']['parameters']['query']>;

const STATUSES = ['open', 'in_review', 'resolved', 'false_positive'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const NAMES = ['appId', 'status', 'severity', 'rule'] as const;
const PAGE_SIZE = 25;

// The detail's code loads with the first drawer opened.
const AlertDrawer = lazy(() =>
  import('../../audit/AlertDrawer').then((module) => ({ default: module.AlertDrawer })),
);

// The detection rules' alerts, most recent activity first, filtered in the
// URL: at a glance who each is about and how serious it is; why it fired,
// what its events show and its history in a drawer when asked for.
export function AlertsPage() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(
    NAMES.flatMap((name) => {
      const value = params.get(name);
      return value === null || value === '' ? [] : [[name, value]];
    }),
  ) as Partial<Record<(typeof NAMES)[number], string>>;
  const offset = Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0);
  const { state, retry } = useLoader(
    () =>
      call(
        api.GET('/api/alerts', {
          // The API validates every value: a wrong one answers 400.
          params: { query: { ...filters, limit: PAGE_SIZE, offset } as AlertQuery },
        }),
      ),
    params.toString(),
  );
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  const go = (next: typeof filters, nextOffset = 0) => {
    const search = new URLSearchParams();
    for (const name of NAMES) {
      const value = next[name];
      if (value !== undefined && value !== '') search.set(name, value);
    }
    if (nextOffset > 0) search.set('offset', String(nextOffset));
    setParams(search);
  };

  return (
    <section className="stack" aria-labelledby="alerts-heading">
      <h1 id="alerts-heading">Alerts</h1>
      <AlertFilters key={params.toString()} filters={filters} onSearch={go} />
      <LoadView state={state} retry={retry} label="alerts">
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">No alerts match.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Severity</th>
                      <th scope="col">Alert</th>
                      <th scope="col">Application</th>
                      <th scope="col">Status</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Occurrences</th>
                      <th scope="col">Last seen</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((alert, index) => {
                      const link = alertPath(alert.id);
                      // The button's name is its row's words (by id): no value
                      // of the alert is ever put in an attribute.
                      const row = `${base}-${String(index)}`;
                      return (
                        <tr key={alert.id}>
                          <td>
                            <Badge kind="sev" value={alert.severity} />
                          </td>
                          <td>
                            <span id={`${row}-what`}>
                              {link === null ? alert.title : <Link to={link}>{alert.title}</Link>}
                            </span>
                          </td>
                          <td>{alert.appSlug}</td>
                          <td>
                            <Badge kind="status" value={alert.status} />
                          </td>
                          <td>
                            <PersonName
                              appId={alert.appId}
                              id={alert.subject}
                              label={alert.subjectLabel}
                              fallback={<span className="muted">—</span>}
                            />
                          </td>
                          <td>{formatNumber(alert.occurrences)}</td>
                          <td id={`${row}-when`}>{formatDateTime(alert.lastSeenAt)}</td>
                          <td>
                            {link !== null && (
                              <button
                                id={`${row}-details`}
                                type="button"
                                className="link-button"
                                aria-labelledby={`${row}-details ${row}-what ${row}-when`}
                                onClick={() => {
                                  setOpen(alert.id);
                                }}
                              >
                                View details
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <OffsetPager
                total={page.total}
                limit={PAGE_SIZE}
                offset={offset}
                onChange={(next) => {
                  go(filters, next);
                }}
              />
              {open !== null && (
                <Suspense
                  fallback={
                    <div className="drawer-backdrop">
                      <p className="drawer" role="status">
                        Loading the alert…
                      </p>
                    </div>
                  }
                >
                  <AlertDrawer
                    alertId={open}
                    onClose={() => {
                      setOpen(null);
                    }}
                  />
                </Suspense>
              )}
            </>
          )
        }
      </LoadView>
    </section>
  );
}

function AlertFilters({
  filters,
  onSearch,
}: {
  filters: Partial<Record<(typeof NAMES)[number], string>>;
  onSearch: (filters: Partial<Record<(typeof NAMES)[number], string>>) => void;
}) {
  const apps = useVisibleApps();
  const [draft, setDraft] = useState(filters);
  const set = (name: (typeof NAMES)[number]) => (value: string) => {
    setDraft((current) => ({ ...current, [name]: value }));
  };
  return (
    <form
      className="filters"
      aria-label="Filters"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft);
      }}
    >
      {apps.state.kind === 'loaded' && (
        <AppPicker
          apps={apps.state.data.items.filter((app) => !app.system)}
          value={draft.appId ?? ''}
          onChange={set('appId')}
          allLabel="Every application"
        />
      )}
      <SelectField
        label="Status"
        value={draft.status ?? ''}
        onChange={set('status')}
        options={asOptions(STATUSES)}
        anyLabel="Any"
      />
      <SelectField
        label="Severity"
        value={draft.severity ?? ''}
        onChange={set('severity')}
        options={asOptions(SEVERITIES)}
        anyLabel="Any"
      />
      <TextField
        label="Rule"
        name="rule"
        value={draft.rule ?? ''}
        onChange={set('rule')}
        error={null}
      />
      <div className="actions">
        <button type="submit">Filter</button>
      </div>
    </form>
  );
}
