import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { type ApiResult, call, describeFailure, failedField } from '../../api/errors';
import { forgetVisibleApps } from '../../audit/apps';
import { Badge } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { formatDateTime, formatNumber, words } from '../../audit/format';
import { isUuid } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { OffsetPager } from '../../audit/Pager';
import { SecretOnce } from '../../audit/SecretOnce';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { ConnectedApp } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

const RESPONSE_ACTIONS = ['revoke_sessions', 'require_password_change', 'disable_account'] as const;
const DELIVERIES_PAGE = 20;
/** Calls of the deletion one click makes while it answers "deleting" (10 seconds each at most). */
const DELETION_ROUNDS = 6;

/** The API's field names (a 400 starts with one) as the settings form labels them. */
const SETTING_LABELS: Record<string, string> = {
  name: 'Name',
  status: 'Status',
  webhookUrl: 'Webhook URL',
  heartbeatTimeoutSec: 'Heartbeat timeout (seconds)',
  rateLimitPerMinute: 'Rate limit (events a minute)',
  correlationEnabled: 'Correlate its users',
  acceptedResponseActions: 'Response actions it accepts',
  requireActionApproval: 'A second administrator approves',
};

type Outcome = { ok: boolean; text: string } | null;

/** A failure in words; a cancelled step-up says nothing happened. */
function failureText(failure: Parameters<typeof describeFailure>[0]): string {
  return isReauthenticationRequired(failure)
    ? 'Nothing changed: it needs you to confirm it is you.'
    : describeFailure(failure);
}

// One connected application, for administrators: its settings, its signing
// keys and webhook secret (rotated after a step-up, shown once), its webhook
// deliveries, and the end of its service (its audit log deleted, the
// application retired).
export function AppDetailPage() {
  const { appId = '' } = useParams();
  const [version, setVersion] = useState(0);
  const { state, retry } = useLoader(
    () =>
      isUuid(appId)
        ? call(api.GET('/api/connected-apps/{id}', { params: { path: { id: appId } } }))
        : Promise.resolve({ ok: false as const, failure: { status: 404, message: 'Not an id' } }),
    `${appId}/${String(version)}`,
  );
  const reload = () => {
    setVersion((current) => current + 1);
  };
  return (
    <section className="stack" aria-labelledby="app-heading">
      <p>
        <Link to="/apps">← Applications</Link>
      </p>
      <LoadView state={state} retry={retry} label="the application">
        {(app) => (
          <>
            <div className="page-header">
              <h1 id="app-heading">{app.name}</h1>
              <Badge kind="status" value={app.status} />
            </div>
            <p className="actions">
              <span className="mono">{app.slug}</span>
              <span>{app.environment}</span>
              <Link to={`/events?appId=${app.id}`}>Events</Link>
              <Link to={`/security?appId=${app.id}`}>Security</Link>
              <Link to={`/retention?appId=${app.id}`}>Retention</Link>
            </p>
            {app.status === 'retired' ? (
              <Alert tone="info">
                Retired: its audit log was deleted at the end of its service, with what Audit Hub
                derived from it. Its seals, its catalog and the records of the deletion stay, so the
                integrity verification still passes; nothing it sends is accepted.
              </Alert>
            ) : (
              <>
                <Settings key={`settings-${String(version)}`} app={app} onSaved={reload} />
                <Keys app={app} onChanged={reload} />
                <Webhook app={app} />
                <EndOfService key={`end-${String(version)}`} app={app} onRetired={reload} />
              </>
            )}
          </>
        )}
      </LoadView>
    </section>
  );
}

function Settings({ app, onSaved }: { app: ConnectedApp; onSaved: () => void }) {
  const stepUp = useStepUp();
  const [name, setName] = useState(app.name);
  const [status, setStatus] = useState<string>(app.status);
  const [webhookUrl, setWebhookUrl] = useState(app.webhookUrl ?? '');
  const [heartbeat, setHeartbeat] = useState(String(app.heartbeatTimeoutSec));
  const [rate, setRate] = useState(String(app.rateLimitPerMinute));
  const [correlation, setCorrelation] = useState(app.correlationEnabled);
  const [accepted, setAccepted] = useState<string[]>(app.acceptedResponseActions);
  const [approval, setApproval] = useState(app.requireActionApproval);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save() {
    const body = {
      ...(name.trim() === app.name ? {} : { name: name.trim() }),
      ...(status === app.status ? {} : { status: status as 'active' | 'suspended' }),
      ...(webhookUrl === (app.webhookUrl ?? '')
        ? {}
        : { webhookUrl: webhookUrl === '' ? null : webhookUrl }),
      ...(Number(heartbeat) === app.heartbeatTimeoutSec
        ? {}
        : { heartbeatTimeoutSec: Number(heartbeat) }),
      ...(Number(rate) === app.rateLimitPerMinute ? {} : { rateLimitPerMinute: Number(rate) }),
      ...(correlation === app.correlationEnabled ? {} : { correlationEnabled: correlation }),
      ...(accepted.join() === app.acceptedResponseActions.join()
        ? {}
        : { acceptedResponseActions: accepted as (typeof RESPONSE_ACTIONS)[number][] }),
      ...(approval === app.requireActionApproval ? {} : { requireActionApproval: approval }),
    };
    if (Object.keys(body).length === 0) {
      setOutcome({ ok: true, text: 'Nothing to save.' });
      return;
    }
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(api.PATCH('/api/connected-apps/{id}', { params: { path: { id: app.id } }, body })),
    );
    setBusy(false);
    if (result.ok) {
      forgetVisibleApps();
      onSaved();
      return;
    }
    const field = failedField(result.failure);
    setOutcome({
      ok: false,
      text:
        field === undefined
          ? failureText(result.failure)
          : `Check "${SETTING_LABELS[field] ?? words(field)}".`,
    });
  }

  return (
    <section className="card stack" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="stack auth-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Name"
          name="name"
          maxLength={100}
          value={name}
          onChange={setName}
          error={null}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            ['active', 'active: its events are accepted'],
            ['suspended', 'suspended: its events are refused'],
          ]}
        />
        <TextField
          label="Webhook URL"
          name="webhookUrl"
          value={webhookUrl}
          onChange={setWebhookUrl}
          error={null}
        />
        <TextField
          label="Heartbeat timeout (seconds)"
          name="heartbeatTimeoutSec"
          inputMode="numeric"
          value={heartbeat}
          onChange={setHeartbeat}
          error={null}
        />
        <TextField
          label="Rate limit (events a minute)"
          name="rateLimitPerMinute"
          inputMode="numeric"
          value={rate}
          onChange={setRate}
          error={null}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={correlation}
            onChange={(event) => {
              setCorrelation(event.target.checked);
            }}
          />
          Correlate its users with other applications (by email pseudonym)
        </label>
        <fieldset className="stack">
          <legend>Response actions it accepts</legend>
          {RESPONSE_ACTIONS.map((action) => (
            <label key={action} className="checkbox">
              <input
                type="checkbox"
                checked={accepted.includes(action)}
                onChange={(event) => {
                  setAccepted((current) =>
                    event.target.checked
                      ? RESPONSE_ACTIONS.filter(
                          (value) => value === action || current.includes(value),
                        )
                      : current.filter((value) => value !== action),
                  );
                }}
              />
              {words(action)}
            </label>
          ))}
        </fieldset>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={approval}
            onChange={(event) => {
              setApproval(event.target.checked);
            }}
          />
          A second administrator approves each response action
        </label>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Keys({ app, onChanged }: { app: ConnectedApp; onChanged: () => void }) {
  const stepUp = useStepUp();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [shown, setShown] = useState<Record<string, unknown> | null>(null);

  async function run<T>(send: () => Promise<ApiResult<T>>, done: (data: T) => void) {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(send);
    setBusy(false);
    if (result.ok) done(result.data);
    else setOutcome({ ok: false, text: failureText(result.failure) });
  }

  if (shown !== null) {
    return (
      <section className="card stack" aria-labelledby="keys-heading">
        <h2 id="keys-heading">New signing key</h2>
        <SecretOnce
          variables={shown}
          onDone={() => {
            setShown(null);
            onChanged();
          }}
        />
      </section>
    );
  }

  return (
    <section className="card stack" aria-labelledby="keys-heading">
      <h2 id="keys-heading">Signing keys</h2>
      <p className="muted">
        A new key works next to the old ones: deploy it to the application, then revoke the old one.
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Created</th>
              <th scope="col">Last used</th>
              <th scope="col">Expires</th>
              <th scope="col">Revoked</th>
              <th scope="col">
                <span className="muted">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {app.keys.map((key) => (
              <tr key={key.id}>
                <td className="mono">{key.id}</td>
                <td>{formatDateTime(key.createdAt)}</td>
                <td>{formatDateTime(key.lastUsedAt)}</td>
                <td>{formatDateTime(key.expiresAt)}</td>
                <td>{formatDateTime(key.revokedAt)}</td>
                <td>
                  {key.revokedAt === null && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            call(
                              api.DELETE('/api/connected-apps/{id}/keys/{keyId}', {
                                params: { path: { id: app.id, keyId: key.id } },
                              }),
                            ),
                          onChanged,
                        )
                      }
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                call(
                  api.POST('/api/connected-apps/{id}/keys', { params: { path: { id: app.id } } }),
                ),
              (data) => {
                setShown(data.variables);
              },
            )
          }
        >
          New signing key
        </button>
      </div>
    </section>
  );
}

function Webhook({ app }: { app: ConnectedApp }) {
  const stepUp = useStepUp();
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [secret, setSecret] = useState<Record<string, unknown> | null>(null);
  const deliveries = useLoader(
    () =>
      call(
        api.GET('/api/connected-apps/{id}/webhook-deliveries', {
          params: { path: { id: app.id }, query: { limit: DELIVERIES_PAGE, offset } },
        }),
      ),
    `${app.id}/${String(offset)}/${String(reload)}`,
  );

  async function test() {
    setBusy(true);
    setOutcome(null);
    const result = await call(
      api.POST('/api/connected-apps/{id}/webhook-test', { params: { path: { id: app.id } } }),
    );
    setBusy(false);
    setOutcome(
      result.ok
        ? { ok: true, text: 'A test webhook is on its way: its delivery shows below.' }
        : { ok: false, text: describeFailure(result.failure) },
    );
    setReload((current) => current + 1);
  }

  async function rotate() {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/connected-apps/{id}/webhook-secret', { params: { path: { id: app.id } } }),
      ),
    );
    setBusy(false);
    if (result.ok) setSecret(result.data.variables);
    else setOutcome({ ok: false, text: failureText(result.failure) });
  }

  return (
    <section className="card stack" aria-labelledby="webhook-heading">
      <h2 id="webhook-heading">Webhooks</h2>
      {secret !== null ? (
        <SecretOnce
          variables={secret}
          onDone={() => {
            setSecret(null);
          }}
        />
      ) : (
        <>
          <p>
            {app.webhookUrl === null ? (
              'No webhook URL: alerts and response actions do not reach the application.'
            ) : (
              <>
                To <span className="mono">{app.webhookUrl}</span>, signed with its webhook secret.
              </>
            )}
          </p>
          {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || app.webhookUrl === null}
              onClick={() => void test()}
            >
              Send a test
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void rotate()}
            >
              New webhook secret
            </button>
          </div>
        </>
      )}
      <h3>Deliveries</h3>
      <LoadView state={deliveries.state} retry={deliveries.retry} label="deliveries">
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Created</th>
                      <th scope="col">Type</th>
                      <th scope="col">To</th>
                      <th scope="col">Status</th>
                      <th scope="col">Attempts</th>
                      <th scope="col">Last answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((delivery) => (
                      <tr key={delivery.id}>
                        <td>{formatDateTime(delivery.createdAt)}</td>
                        <td className="mono">{delivery.type}</td>
                        <td>{delivery.target}</td>
                        <td>
                          <Badge kind="status" value={delivery.status} />
                        </td>
                        <td>{delivery.attempts}</td>
                        <td>
                          {[
                            delivery.lastStatus === null
                              ? null
                              : `HTTP ${String(delivery.lastStatus)}`,
                            delivery.lastError,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <OffsetPager
                total={page.total}
                limit={DELIVERIES_PAGE}
                offset={offset}
                onChange={setOffset}
              />
            </>
          )
        }
      </LoadView>
    </section>
  );
}

/**
 * The end of a suspended application's service: its audit log deleted (never
 * what a legal hold keeps), then what Audit Hub derived from it, and the
 * application retired, after typing its slug and a step-up. Each call deletes
 * for at most 10 seconds; one click goes on while the answer is "deleting".
 */
function EndOfService({ app, onRetired }: { app: ConnectedApp; onRetired: () => void }) {
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const suspended = app.status === 'suspended';

  async function deleteLog() {
    setBusy(true);
    setOutcome(null);
    let deleted = 0;
    for (let round = 0; round < DELETION_ROUNDS; round += 1) {
      const result = await stepUp.recent(() =>
        call(
          api.POST('/api/connected-apps/{id}/deletion', {
            params: { path: { id: app.id } },
            body: { confirm: typed.trim() },
          }),
        ),
      );
      if (!result.ok) {
        setBusy(false);
        setOutcome({
          ok: false,
          text:
            result.failure.status === 400
              ? `Type its slug, ${app.slug}, exactly.`
              : result.failure.status === 409
                ? 'Suspend it first: its log is deleted once ingestion stopped.'
                : failureText(result.failure),
        });
        return;
      }
      const progress = result.data;
      deleted += progress.deleted;
      if (progress.status === 'deleted') {
        setBusy(false);
        forgetVisibleApps();
        onRetired();
        return;
      }
      if (progress.status === 'held') {
        setBusy(false);
        setOutcome({
          ok: false,
          text: `${formatNumber(deleted)} events deleted. A legal hold keeps ${formatNumber(progress.held)} of them, or names the application: release it (Retention), then continue.`,
        });
        return;
      }
      if (progress.status === 'waiting') {
        setBusy(false);
        setOutcome({
          ok: true,
          text: `${formatNumber(deleted)} events deleted. ${formatNumber(progress.waiting)} wait for their seal, within 2 minutes: continue then.`,
        });
        return;
      }
      setOutcome({ ok: true, text: `Deleting: ${formatNumber(deleted)} events so far.` });
    }
    setBusy(false);
    setOutcome({
      ok: true,
      text: `${formatNumber(deleted)} events deleted so far: continue to delete the rest.`,
    });
  }

  return (
    <section className="card stack" aria-labelledby="end-heading">
      <h2 id="end-heading">End of service</h2>
      <p>
        Deletes this application's whole audit log, then what Audit Hub derived from it (alerts,
        response actions, what the rules remember, its keys), and retires it for good. Its seals,
        its catalog and the records of the deletion stay, so the integrity verification still
        passes. What a legal hold keeps is not deleted. It cannot be undone.
      </p>
      {!suspended && (
        <p className="muted">
          Suspend it first (Settings): its log is deleted once ingestion stopped.
        </p>
      )}
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      {confirming ? (
        <form
          className="stack auth-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void deleteLog();
          }}
        >
          <TextField
            label={`Type its slug, ${app.slug}, to confirm`}
            name="confirm"
            maxLength={64}
            value={typed}
            onChange={setTyped}
            error={null}
          />
          <div className="actions">
            <button type="submit" disabled={busy || typed.trim() === ''}>
              {busy ? 'Deleting…' : outcome?.ok === true ? 'Continue' : 'Delete its audit log'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setTyped('');
                setOutcome(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p>
          <button
            type="button"
            className="secondary"
            disabled={!suspended}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete its audit log…
          </button>
        </p>
      )}
    </section>
  );
}
