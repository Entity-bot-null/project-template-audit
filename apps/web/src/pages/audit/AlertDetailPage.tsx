import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { type ApiResult, call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { AlertView } from '../../audit/AlertView';
import { SelectField } from '../../audit/fields';
import { asOptions, formatDateTime, words } from '../../audit/format';
import { isUuid } from '../../audit/links';
import { useLiveRefresh } from '../../audit/live/LiveContext';
import { LoadView } from '../../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { AlertDetail } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

const STATUSES = ['open', 'in_review', 'resolved', 'false_positive'] as const;
const CLOSED: readonly string[] = ['resolved', 'false_positive'];
const RESPONSE_ACTIONS = ['revoke_sessions', 'require_password_change', 'disable_account'] as const;
const SILENCE_MINUTES = [
  ['15', '15 minutes'],
  ['60', 'an hour'],
  ['240', '4 hours'],
  ['480', '8 hours'],
  ['1440', 'a day'],
  ['10080', 'a week'],
] as const;
const REASON_HINT = 'Say why, in 10 characters or more: it is kept in its history.';

type Outcome = { ok: boolean; text: string } | null;
type Status = (typeof STATUSES)[number];

// One alert (audit/AlertView.tsx): why it fired, what its events show, who
// it is about, the events behind it and its history, kept current while
// shown (the live stream). Administrators and auditors work on it: take it
// on (acknowledge: its escalation stops), review it (status, with a reason
// to close it; assignee; notes), reopen it, and silence its rule or its
// application for a while; an administrator can ask its application to act
// on the user (a response action, after a step-up).
export function AlertDetailPage() {
  const { alertId = '' } = useParams();
  const [version, setVersion] = useState(0);
  // Said above the alert: a reload replaces everything below it.
  const [notice, setNotice] = useState<string | null>(null);
  const { state, retry, refresh } = useLoader(
    () =>
      isUuid(alertId)
        ? call(api.GET('/api/alerts/{id}', { params: { path: { id: alertId } } }))
        : Promise.resolve({
            ok: false as const,
            failure: { status: 404, message: 'Not an alert id' },
          }),
    `${alertId}/${String(version)}`,
  );
  useLiveRefresh(refresh, (event) => event.alert.id === alertId);
  return (
    <section className="stack" aria-labelledby="alert-heading">
      <p>
        <Link to="/alerts">← Alerts</Link>
      </p>
      {notice !== null && <Alert>{notice}</Alert>}
      <LoadView state={state} retry={retry} label="the alert">
        {(alert) => (
          <AlertPageView
            alert={alert}
            onChanged={(reason) => {
              setNotice(reason ?? null);
              setVersion((current) => current + 1);
            }}
            onRefresh={() => void refresh()}
          />
        )}
      </LoadView>
    </section>
  );
}

type OnChanged = (notice?: string) => void;

function AlertPageView({
  alert,
  onChanged,
  onRefresh,
}: {
  alert: AlertDetail;
  onChanged: OnChanged;
  /** Loads the alert again quietly: what is shown stays meanwhile. */
  onRefresh: () => void;
}) {
  const auth = useAuth();
  const role = auth.status === 'authenticated' ? auth.user.role : 'member';
  const reviewer = role === 'admin' || role === 'auditor';
  return (
    <AlertView alert={alert} variant="page" headingId="alert-heading">
      {reviewer && <Review alert={alert} onChanged={onChanged} />}
      {reviewer && <Silences alert={alert} onRefresh={onRefresh} />}
      {role === 'admin' && alert.subject !== null && (
        <RequestAction alert={alert} subject={alert.subject} />
      )}
    </AlertView>
  );
}

/** Sends a change of the alert; a 409 (someone changed it meanwhile) reloads it. */
function useAlertChange(alert: AlertDetail, onChanged: OnChanged) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function send<T>(request: () => Promise<ApiResult<T>>): Promise<boolean> {
    setBusy(true);
    setOutcome(null);
    const result = await request();
    setBusy(false);
    if (result.ok) {
      onChanged();
      return true;
    }
    if (result.failure.status === 409) {
      onChanged('Someone changed this alert meanwhile: it was reloaded, check it and try again.');
      return false;
    }
    setOutcome({ ok: false, text: describeFailure(result.failure) });
    return false;
  }
  const update = (change: { status?: Status; assigneeId?: string | null; reason?: string }) =>
    send(() =>
      call(
        api.PATCH('/api/alerts/{id}', {
          params: { path: { id: alert.id } },
          body: { ...change, version: alert.version },
        }),
      ),
    );
  return { busy, outcome, send, update };
}

function Review({ alert, onChanged }: { alert: AlertDetail; onChanged: OnChanged }) {
  const auth = useAuth();
  const me = auth.status === 'authenticated' ? auth.user.id : null;
  const change = useAlertChange(alert, onChanged);
  const { busy, outcome, update } = change;
  const closed = CLOSED.includes(alert.status);

  return (
    <section className="card stack" aria-labelledby="review-heading">
      <h2 id="review-heading">Review</h2>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      {alert.status === 'open' && alert.acknowledgedAt === null && (
        <div className="stack-tight">
          <p>
            Nobody has taken it on yet
            {alert.escalations > 0 &&
              `: escalated ${String(alert.escalations)} ${alert.escalations === 1 ? 'time' : 'times'}`}
            . Acknowledging it stops its escalation and makes you its assignee when nobody is.
          </p>
          <p className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void change.send(() =>
                  call(
                    api.POST('/api/alerts/{id}/acknowledge', {
                      params: { path: { id: alert.id } },
                      body: { version: alert.version },
                    }),
                  ),
                )
              }
            >
              Acknowledge
            </button>
          </p>
        </div>
      )}
      {/* A new version (a change, here or live) starts the choice again from it. */}
      <StatusForm key={alert.version} alert={alert} busy={busy} onSave={update} />
      <p className="actions">
        {closed && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void update({ status: 'open' })}
          >
            Reopen
          </button>
        )}
        {alert.assigneeId === me ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void update({ assigneeId: null })}
          >
            Unassign me
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={busy || me === null}
            onClick={() => void update({ assigneeId: me })}
          >
            Assign to me
          </button>
        )}
      </p>
      <NoteForm alert={alert} onChanged={onChanged} />
    </section>
  );
}

function StatusForm({
  alert,
  busy,
  onSave,
}: {
  alert: AlertDetail;
  busy: boolean;
  onSave: (change: { status: Status; reason?: string }) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<string>(alert.status);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const closing = CLOSED.includes(status) && status !== alert.status;
  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (status === alert.status) return;
        if (closing && reason.trim().length < 10) {
          setReasonError(REASON_HINT);
          return;
        }
        setReasonError(null);
        void onSave({
          status: status as Status,
          ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        });
      }}
    >
      <div className="filters">
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={asOptions(STATUSES)}
        />
      </div>
      {closing && (
        <TextField
          label={status === 'resolved' ? 'How it was resolved' : 'Why it is a false positive'}
          name="reason"
          maxLength={500}
          value={reason}
          onChange={setReason}
          error={reasonError}
        />
      )}
      <div className="actions">
        <button type="submit" disabled={busy || status === alert.status}>
          Save status
        </button>
      </div>
    </form>
  );
}

function NoteForm({ alert, onChanged }: { alert: AlertDetail; onChanged: OnChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function addNote() {
    if (note.trim().length === 0) return;
    setBusy(true);
    setOutcome(null);
    const result = await call(
      api.POST('/api/alerts/{id}/notes', {
        params: { path: { id: alert.id } },
        body: { note: note.trim() },
      }),
    );
    setBusy(false);
    if (result.ok) {
      setNote('');
      onChanged();
    } else {
      setOutcome({ ok: false, text: describeFailure(result.failure) });
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void addNote();
      }}
    >
      {outcome !== null && <Alert tone="error">{outcome.text}</Alert>}
      <TextField
        label="Note"
        name="note"
        maxLength={2000}
        value={note}
        onChange={setNote}
        error={null}
      />
      <p className="muted">
        For the people working on it: never paste personal data from elsewhere.
      </p>
      <div className="actions">
        <button type="submit" disabled={busy || note.trim().length === 0}>
          Add note
        </button>
      </div>
    </form>
  );
}

/**
 * The silences of the alert's application: those in force (lifted from
 * here) and a new one, of its rule or of every rule of the application,
 * for a while and with a reason.
 */
function Silences({ alert, onRefresh }: { alert: AlertDetail; onRefresh: () => void }) {
  const mutes = useLoader(
    () => call(api.GET('/api/alert-mutes', { params: { query: { appId: alert.appId } } })),
    alert.appId,
  );
  const [scope, setScope] = useState<'rule' | 'app'>('rule');
  const [minutes, setMinutes] = useState<string>(SILENCE_MINUTES[1][0]);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function done<T>(request: Promise<ApiResult<T>>, success: string) {
    setBusy(true);
    setOutcome(null);
    const result = await request;
    setBusy(false);
    if (result.ok) {
      setOutcome({ ok: true, text: success });
      void mutes.refresh();
      onRefresh();
    } else {
      setOutcome({ ok: false, text: describeFailure(result.failure) });
    }
    return result.ok;
  }

  async function silence() {
    if (reason.trim().length < 10) {
      setReasonError(REASON_HINT.replace('its history', 'the silence'));
      return;
    }
    setReasonError(null);
    const ok = await done(
      call(
        api.POST('/api/alert-mutes', {
          body: {
            appId: alert.appId,
            rule: scope === 'rule' ? alert.rule : null,
            minutes: Number(minutes),
            reason: reason.trim(),
          },
        }),
      ),
      'Silenced.',
    );
    if (ok) setReason('');
  }

  return (
    <section className="card stack" aria-labelledby="silences-heading">
      <h2 id="silences-heading">Silences</h2>
      <p className="muted">
        A silence holds the notices, sounds and escalation of the alerts it covers, for a while:
        they still open, count and show here.
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <LoadView state={mutes.state} retry={mutes.retry} label="the silences">
        {(data) => {
          const active = data.items.filter((mute) => mute.active);
          return active.length === 0 ? (
            <p className="muted">None in force for {alert.appSlug}.</p>
          ) : (
            <ul className="stack-tight">
              {active.map((mute) => (
                <li key={mute.id} className="actions">
                  <span>
                    {mute.rule === null ? 'Every rule' : <span className="mono">{mute.rule}</span>}{' '}
                    until {formatDateTime(mute.until)}: <q>{mute.reason}</q>
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void done(
                        call(
                          api.POST('/api/alert-mutes/{id}/end', {
                            params: { path: { id: mute.id } },
                          }),
                        ),
                        'Lifted.',
                      )
                    }
                  >
                    Lift
                  </button>
                </li>
              ))}
            </ul>
          );
        }}
      </LoadView>
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void silence();
        }}
      >
        <div className="filters">
          <SelectField
            label="Silence"
            value={scope}
            onChange={(value) => {
              setScope(value === 'app' ? 'app' : 'rule');
            }}
            options={[
              ['rule', `This rule in ${alert.appSlug}`],
              ['app', `Every rule in ${alert.appSlug}`],
            ]}
          />
          <SelectField
            label="For"
            value={minutes}
            onChange={setMinutes}
            options={SILENCE_MINUTES}
          />
        </div>
        <TextField
          label="Why silence it"
          name="silence-reason"
          maxLength={500}
          value={reason}
          onChange={setReason}
          error={reasonError}
        />
        <div className="actions">
          <button type="submit" className="secondary" disabled={busy}>
            Silence
          </button>
        </div>
      </form>
    </section>
  );
}

function RequestAction({ alert, subject }: { alert: AlertDetail; subject: string }) {
  const stepUp = useStepUp();
  const [action, setAction] = useState<string>(RESPONSE_ACTIONS[0]);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function request() {
    if (reason.trim().length < 10) {
      setReasonError('Say why, in 10 characters or more: it is recorded with the request.');
      return;
    }
    setReasonError(null);
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/response-actions', {
          body: {
            appId: alert.appId,
            subject,
            action: action as (typeof RESPONSE_ACTIONS)[number],
            reason: reason.trim(),
            alertId: alert.id,
          },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
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
    } else {
      setOutcome({ ok: false, text: describeFailure(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="action-heading">
      <h2 id="action-heading">Ask the application to act</h2>
      <p>
        The application receives a signed webhook and acts on the user{' '}
        {alert.subjectLabel === null ? (
          <span className="mono">{subject}</span>
        ) : (
          <>
            {alert.subjectLabel} (<span className="mono">{subject}</span>)
          </>
        )}
        , if it accepts that action.
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void request();
        }}
      >
        <SelectField
          label="Action"
          value={action}
          onChange={setAction}
          options={asOptions(RESPONSE_ACTIONS)}
        />
        <TextField
          label="Reason"
          name="reason"
          maxLength={500}
          value={reason}
          onChange={setReason}
          error={reasonError}
        />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Request'}
          </button>
        </div>
      </form>
    </section>
  );
}
