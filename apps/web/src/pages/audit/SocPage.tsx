import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { useVisibleApps } from '../../audit/apps';
import { Badge } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { formatNumber, formatWhen, words } from '../../audit/format';
import { useLive, useLiveRefresh } from '../../audit/live/LiveContext';
import { LiveControls } from '../../audit/live/LiveControls';
import { alertPath } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import type { Source } from '../../audit/types';
import { useLoader } from '../../hooks/useLoader';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

const SOURCE_WORDS: Record<Source['status'], string> = {
  active: 'Active',
  idle: 'Idle: heartbeats, no recent events',
  delayed: 'Delayed: events queued',
  disconnected: 'Disconnected: no heartbeat',
  never: 'Never connected',
};

const SOURCES_REFRESH_MS = 30_000;

// The security operations view: one screen, full screen if asked, to watch
// and act from. What is unresolved by severity, the critical and high alerts
// waiting, what changed just now, the sources (connected, delayed, idle,
// disconnected, with their queues, refusals and missing events) and the log's
// integrity, for one application or environment or all. Live: the stream
// updates it; nothing here is polled faster than every 30 seconds.
export function SocPage() {
  const live = useLive();
  const apps = useVisibleApps();
  const [appId, setAppId] = useState('');
  const [environment, setEnvironment] = useState('');
  const screen = useRef<HTMLElement>(null);
  const visible =
    apps.state.kind === 'loaded' ? apps.state.data.items.filter((app) => !app.system) : [];
  const environments = [...new Set(visible.map((app) => app.environment))].sort();
  const inScope = (id: string) => {
    if (appId !== '') return id === appId;
    if (environment === '') return true;
    return visible.some((app) => app.appId === id && app.environment === environment);
  };

  const summary = useLoader(
    () =>
      call(api.GET('/api/alerts/summary', { params: { query: appId === '' ? {} : { appId } } })),
    `summary/${appId}`,
  );
  const urgent = useLoader(
    () =>
      call(
        api.GET('/api/alerts', {
          params: {
            query: {
              status: ['open', 'in_review'],
              severity: ['critical', 'high'],
              sort: 'severity',
              order: 'desc',
              limit: 25,
              ...(appId === '' ? {} : { appId }),
            },
          },
        }),
      ),
    `urgent/${appId}`,
  );
  const sources = useLoader(() => call(api.GET('/api/sources')), 'sources');
  const integrity = useLoader(() => call(api.GET('/api/overview')), 'integrity');

  useLiveRefresh(() => {
    void summary.refresh();
    void urgent.refresh();
  });
  useLiveRefresh(
    () => void sources.refresh(),
    (event) =>
      event.alert.rule.startsWith('source_') ||
      event.alert.rule === 'ingest_rejections' ||
      event.alert.rule === 'coverage_gap',
  );
  useInterval(() => void sources.refresh(), SOURCES_REFRESH_MS);

  const activity = live.recent.filter((event) => inScope(event.alert.appId)).slice(0, 15);

  return (
    <section ref={screen} className="soc stack" aria-labelledby="soc-heading">
      <div className="soc-header">
        <h1 id="soc-heading">Security operations</h1>
        <LiveControls announce={false} />
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (document.fullscreenElement === null)
              void screen.current?.requestFullscreen().catch(() => undefined);
            else void document.exitFullscreen();
          }}
        >
          Full screen
        </button>
      </div>
      <form
        className="filters"
        aria-label="Scope"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <SelectField
          label="Application"
          value={appId}
          onChange={setAppId}
          options={visible.map((app) => [app.appId, `${app.name} (${app.environment})`] as const)}
          anyLabel="Every application"
        />
        <SelectField
          label="Environment"
          value={environment}
          onChange={setEnvironment}
          options={environments.map((name) => [name, name] as const)}
          anyLabel="Every environment"
        />
      </form>

      <section aria-labelledby="unresolved-heading" className="stack">
        <h2 id="unresolved-heading">Unresolved alerts</h2>
        <LoadView state={summary.state} retry={summary.retry} label="the counts">
          {(counts) => (
            <div className="summary-cards">
              {SEVERITIES.map((severity) => (
                <div key={severity} className={`card soc-tile soc-tile-${severity}`}>
                  <p className="muted">
                    <Badge kind="sev" value={severity} />
                  </p>
                  <p className="stat">{formatNumber(counts.open[severity])}</p>
                  <p className="muted">
                    open · {formatNumber(counts.inReview[severity])} in review
                  </p>
                </div>
              ))}
              <div className="card soc-tile">
                <p className="muted">Waiting longest</p>
                <p className="stat">
                  {counts.oldestOpenAt === null ? '—' : formatWhen(counts.oldestOpenAt)}
                </p>
                <p className="muted">{formatNumber(counts.muted)} silenced</p>
              </div>
            </div>
          )}
        </LoadView>
      </section>

      <div className="soc-columns">
        <section aria-labelledby="urgent-heading" className="stack">
          <h2 id="urgent-heading">Critical and high, unresolved</h2>
          <LoadView state={urgent.state} retry={urgent.retry} label="the alerts">
            {(page) =>
              page.items.filter((alert) => inScope(alert.appId)).length === 0 ? (
                <p className="muted">None.</p>
              ) : (
                <ul className="soc-list">
                  {page.items
                    .filter((alert) => inScope(alert.appId))
                    .map((alert) => {
                      const path = alertPath(alert.id);
                      return (
                        <li key={alert.id}>
                          <Badge kind="sev" value={alert.severity} />{' '}
                          {path === null ? alert.title : <Link to={path}>{alert.title}</Link>}
                          <span className="muted">
                            {' '}
                            · {alert.appSlug} · {words(alert.status)}
                            {alert.mutedUntil === null ? '' : ' · silenced'} · last{' '}
                            {formatWhen(alert.lastSeenAt)}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )
            }
          </LoadView>
        </section>

        <section aria-labelledby="activity-heading" className="stack">
          <h2 id="activity-heading">Just now</h2>
          {activity.length === 0 ? (
            <p className="muted">Nothing since this page opened.</p>
          ) : (
            <ol className="soc-list">
              {activity.map(({ alert }) => {
                const path = alertPath(alert.id);
                return (
                  <li key={`${alert.id}-${alert.updatedAt}`}>
                    <span className="muted">{formatWhen(alert.updatedAt)}</span>{' '}
                    <Badge kind="sev" value={alert.severity} />{' '}
                    {path === null ? alert.title : <Link to={path}>{alert.title}</Link>}{' '}
                    <span className="muted">· {words(alert.status)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <section aria-labelledby="sources-heading" className="stack">
        <h2 id="sources-heading">Sources</h2>
        <LoadView state={sources.state} retry={sources.retry} label="the sources">
          {(list) => {
            const shown = list.items.filter((source) => inScope(source.appId));
            if (shown.length === 0) return <p className="muted">No active application.</p>;
            return (
              <div className="table-scroll">
                <table>
                  <caption className="muted">As of {formatWhen(list.checkedAt)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Application</th>
                      <th scope="col">State</th>
                      <th scope="col">Last heartbeat</th>
                      <th scope="col">Latest event</th>
                      <th scope="col">Queued</th>
                      <th scope="col">Refused (15 min)</th>
                      <th scope="col">Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((source) => (
                      <tr key={source.appId}>
                        <td>
                          {source.name} <span className="muted">({source.environment})</span>
                        </td>
                        <td>
                          <span className={`source-status source-${source.status}`}>
                            {SOURCE_WORDS[source.status]}
                          </span>
                        </td>
                        <td>
                          {source.lastHeartbeatAt === null
                            ? '—'
                            : formatWhen(source.lastHeartbeatAt)}
                        </td>
                        <td>
                          {source.lastEventAt === null ? '—' : formatWhen(source.lastEventAt)}
                        </td>
                        <td>
                          {formatNumber(source.queueSize)}
                          {source.queueOldestAgeSec === null
                            ? ''
                            : `, oldest ${formatNumber(Math.round(source.queueOldestAgeSec / 60))} min`}
                        </td>
                        <td>{formatNumber(source.rejected15m)}</td>
                        <td>
                          {source.missingEvents === 0 ? '—' : formatNumber(source.missingEvents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </LoadView>
      </section>

      <section aria-labelledby="integrity-heading" className="stack">
        <h2 id="integrity-heading">Integrity of the log</h2>
        <LoadView state={integrity.state} retry={integrity.retry} label="the integrity">
          {(overview) =>
            overview.integrity === null ? (
              <p className="muted">Not verified yet.</p>
            ) : (
              <p>
                <Badge
                  kind="outcome"
                  value={overview.integrity.outcome === 'passed' ? 'success' : 'failure'}
                />{' '}
                The latest verification{' '}
                {overview.integrity.outcome === 'passed'
                  ? 'passed'
                  : words(overview.integrity.outcome)}
                , {formatWhen(overview.integrity.finishedAt)}.
              </p>
            )
          }
        </LoadView>
      </section>
    </section>
  );
}

/** Runs `tick` every `ms` while the page is shown. */
function useInterval(tick: () => void, ms: number) {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      latest.current();
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [ms]);
}
