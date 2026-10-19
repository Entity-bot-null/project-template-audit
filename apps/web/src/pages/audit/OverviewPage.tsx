import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { Sparkline } from '../../audit/charts';
import { Badge } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { formatDateTime, formatNumber, words } from '../../audit/format';
import { LoadView } from '../../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { Overview } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

const fetchOverview = () => call(api.GET('/api/overview'));
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
/** The API's HIGH_RISK_SCORE: a high severity's weight. */
const HIGH_RISK = 60;
/** ID_PATTERN of the contract: an application's user id. */
const SUBJECT = /^[A-Za-z0-9._:-]{1,128}$/;
const ACTIONS = [
  ['revoke_sessions', 'Revoke sessions'],
  ['require_password_change', 'Force a password change'],
  ['disable_account', 'Disable the account'],
] as const;

type App = Overview['apps'][number];

/**
 * Every application the person may see, at a glance: the log's integrity,
 * open alerts and high-risk events first, then each application's activity,
 * alerts and ingestion health. Administrators also get the quick response
 * actions on an application's user.
 */
export function OverviewPage() {
  const auth = useAuth();
  const { state, retry } = useLoader(fetchOverview);
  const admin = auth.status === 'authenticated' && auth.user.role === 'admin';
  return (
    <section className="stack" aria-labelledby="overview-heading">
      <h1 id="overview-heading">Overview</h1>
      <LoadView state={state} retry={retry} label="the overview">
        {(overview) => (
          <>
            <Summary overview={overview} admin={admin} />
            {admin && overview.apps.some((app) => app.status === 'active') && (
              <QuickActions apps={overview.apps.filter((app) => app.status === 'active')} />
            )}
            <section className="stack" aria-labelledby="apps-heading">
              <h2 id="apps-heading">Applications</h2>
              {overview.apps.length === 0 ? (
                <p>
                  {admin ? (
                    <>
                      No application sends its audit log yet.{' '}
                      <Link to="/apps/new">Register an application</Link>.
                    </>
                  ) : (
                    'No application is assigned to you yet: ask an administrator.'
                  )}
                </p>
              ) : (
                <div className="cards">
                  {overview.apps.map((app) => (
                    <AppCard key={app.appId} app={app} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </LoadView>
    </section>
  );
}

/** The three figures that say whether anything needs attention now. */
function Summary({ overview, admin }: { overview: Overview; admin: boolean }) {
  const openBySeverity = SEVERITIES.flatMap((severity) => {
    const open = overview.apps.reduce((sum, app) => sum + (app.openAlerts[severity] ?? 0), 0);
    return open > 0 ? [{ severity, open }] : [];
  });
  const openAlerts = openBySeverity.reduce((sum, { open }) => sum + open, 0);
  const highRisk = overview.apps.reduce((sum, app) => sum + app.highRisk24h, 0);
  return (
    <section className="stack" aria-labelledby="glance-heading">
      <h2 id="glance-heading">At a glance</h2>
      <div className="summary-cards">
        <article className="card stack" aria-labelledby="integrity-heading">
          <h3 id="integrity-heading">Log integrity</h3>
          <IntegrityFigure integrity={overview.integrity} />
          {admin && (
            <p>
              <Link to="/integrity">Integrity</Link>
            </p>
          )}
        </article>
        <article className="card stack" aria-labelledby="alerts-heading">
          <h3 id="alerts-heading">Open alerts</h3>
          <p className={openAlerts > 0 ? 'stat outcome-failure' : 'stat'}>
            {formatNumber(openAlerts)}
          </p>
          {openBySeverity.length > 0 && (
            <p className="actions">
              {openBySeverity.map(({ severity, open }) => (
                <span key={severity}>
                  <Badge kind="sev" value={severity} /> {formatNumber(open)}
                </span>
              ))}
            </p>
          )}
          <p>
            <Link to="/alerts">Alerts</Link>
          </p>
        </article>
        <article className="card stack" aria-labelledby="risk-heading">
          <h3 id="risk-heading">High-risk events, 24 h</h3>
          <p className={highRisk > 0 ? 'stat outcome-denied' : 'stat'}>{formatNumber(highRisk)}</p>
          <p className="muted">{`Risk score ${String(HIGH_RISK)} or more.`}</p>
          <p>
            <Link
              to={`/events?from=${encodeURIComponent(overview.since)}&minRisk=${String(HIGH_RISK)}`}
            >
              See them
            </Link>
          </p>
        </article>
      </div>
    </section>
  );
}

function IntegrityFigure({ integrity }: { integrity: Overview['integrity'] }) {
  if (integrity === null) {
    return <p className="stat muted">Not verified yet</p>;
  }
  const checked = (
    <p className="muted">{`Last verification ${formatDateTime(integrity.finishedAt)}.`}</p>
  );
  if (integrity.outcome === 'passed') {
    return (
      <>
        <p className="stat outcome-success">Verified</p>
        {checked}
      </>
    );
  }
  return (
    <>
      <p
        className={integrity.outcome === 'failed' ? 'stat outcome-failure' : 'stat outcome-denied'}
      >
        {integrity.outcome === 'failed' ? 'Failed' : 'Not finished'}
      </p>
      {checked}
      <p>
        {integrity.outcome === 'failed'
          ? 'The verification found the log changed or incomplete: an administrator looks into it.'
          : 'The verification could not finish: it runs again on its schedule.'}
      </p>
    </>
  );
}

/**
 * Administrators only (the API checks): ask an application to act on one of
 * its users at once, after a step-up. The application receives a signed
 * webhook; a second administrator approves it first where the application
 * requires it (the default).
 */
function QuickActions({ apps }: { apps: App[] }) {
  const stepUp = useStepUp();
  const first = apps[0]?.appId ?? '';
  const [appId, setAppId] = useState(first);
  const [subject, setSubject] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ subject: string | null; reason: string | null }>({
    subject: null,
    reason: null,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function request(action: (typeof ACTIONS)[number][0]) {
    const found = {
      subject: SUBJECT.test(subject.trim()) ? null : "Enter the user's id in that application.",
      reason:
        reason.trim().length >= 10
          ? null
          : 'Say why, in 10 characters or more: it is recorded with the request.',
    };
    setErrors(found);
    if (found.subject !== null || found.reason !== null) return;
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/response-actions', {
          body: { appId, subject: subject.trim(), action, reason: reason.trim() },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      setSubject('');
      setReason('');
      setOutcome({
        ok: true,
        text:
          result.data.status === 'pending_approval'
            ? 'Requested: another administrator approves it under Response actions.'
            : `Requested: ${words(result.data.status)}.`,
      });
    } else if (isReauthenticationRequired(result.failure)) {
      setOutcome({ ok: false, text: 'Nothing was requested: it needs you to confirm it is you.' });
    } else if (result.failure.status === 409) {
      setOutcome({
        ok: false,
        text: 'The application does not accept this action, or has no webhook URL: see its settings.',
      });
    } else {
      setOutcome({ ok: false, text: describeFailure(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="respond-heading">
      <h2 id="respond-heading">Respond quickly</h2>
      <p className="muted">
        Ask an application to act on one of its users. It needs you to confirm it is you, and, where
        the application requires it, a second administrator&apos;s approval (
        <Link to="/response-actions">Response actions</Link>).
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="stack"
        noValidate
        aria-labelledby="respond-heading"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="filters">
          <SelectField
            label="Application"
            value={appId}
            onChange={setAppId}
            options={apps.map((app) => [app.appId, app.name] as const)}
          />
          <TextField
            label="User id"
            name="subject"
            autoComplete="off"
            maxLength={128}
            value={subject}
            onChange={setSubject}
            error={errors.subject}
          />
          <TextField
            label="Reason"
            name="reason"
            maxLength={500}
            value={reason}
            onChange={setReason}
            error={errors.reason}
          />
        </div>
        <div className="actions">
          {ACTIONS.map(([action, label]) => (
            <button key={action} type="button" disabled={busy} onClick={() => void request(action)}>
              {label}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}

function AppCard({ app }: { app: App }) {
  const alerts = SEVERITIES.flatMap((severity) => {
    const open = app.openAlerts[severity] ?? 0;
    return open > 0 ? [{ severity, open }] : [];
  });
  const query = `?appId=${app.appId}`;
  return (
    <article className="card stack" aria-labelledby={`app-${app.appId}`}>
      <div className="page-header">
        <h3 id={`app-${app.appId}`}>{app.name}</h3>
        <Badge kind="status" value={app.status} />
      </div>
      <dl className="details-grid">
        <dt>Events, 24 h</dt>
        <dd>
          {formatNumber(app.events24h)}{' '}
          <Sparkline values={app.trend} label="Events per hour, last 24 hours" />
        </dd>
        <dt>High risk, 24 h</dt>
        <dd>{formatNumber(app.highRisk24h)}</dd>
        <dt>Rejected, 24 h</dt>
        <dd>{formatNumber(app.rejected24h)}</dd>
        <dt>Open alerts</dt>
        <dd>
          {alerts.length === 0
            ? 'none'
            : alerts.map(({ severity, open }) => (
                <span key={severity}>
                  <Badge kind="sev" value={severity} /> {formatNumber(open)}{' '}
                </span>
              ))}
        </dd>
        <dt>Last heartbeat</dt>
        <dd>{formatDateTime(app.lastHeartbeatAt)}</dd>
        <dt>Connector queue</dt>
        <dd>{formatNumber(app.queueSize)}</dd>
        <dt>Missing events</dt>
        <dd className={app.openGaps > 0 ? 'outcome-failure' : undefined}>
          {app.openGaps > 0 ? `${formatNumber(app.openGaps)} open gaps` : 'none'}
        </dd>
      </dl>
      <p className="actions">
        <Link to={`/events${query}`}>Events</Link>
        <Link to={`/security${query}`}>Security</Link>
        <Link to={`/alerts${query}`}>Alerts</Link>
      </p>
    </article>
  );
}
