import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { AlertView } from '../../audit/AlertView';
import { SelectField } from '../../audit/fields';
import { asOptions, words } from '../../audit/format';
import { isUuid } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { AlertDetail } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

const STATUSES = ['open', 'in_review', 'resolved', 'false_positive'] as const;
const RESPONSE_ACTIONS = ['revoke_sessions', 'require_password_change', 'disable_account'] as const;

type Outcome = { ok: boolean; text: string } | null;

// One alert (audit/AlertView.tsx): why it fired, what its events show, who
// it is about, the events behind it and its history. Administrators and
// auditors review it (status, assignee, notes); an administrator can ask its
// application to act on the user (a response action, after a step-up).
export function AlertDetailPage() {
  const { alertId = '' } = useParams();
  const [version, setVersion] = useState(0);
  // Said above the alert: a reload replaces everything below it.
  const [notice, setNotice] = useState<string | null>(null);
  const { state, retry } = useLoader(
    () =>
      isUuid(alertId)
        ? call(api.GET('/api/alerts/{id}', { params: { path: { id: alertId } } }))
        : Promise.resolve({
            ok: false as const,
            failure: { status: 404, message: 'Not an alert id' },
          }),
    `${alertId}/${String(version)}`,
  );
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
          />
        )}
      </LoadView>
    </section>
  );
}

type OnChanged = (notice?: string) => void;

function AlertPageView({ alert, onChanged }: { alert: AlertDetail; onChanged: OnChanged }) {
  const auth = useAuth();
  const role = auth.status === 'authenticated' ? auth.user.role : 'member';
  return (
    <AlertView alert={alert} variant="page" headingId="alert-heading">
      {(role === 'admin' || role === 'auditor') && <Review alert={alert} onChanged={onChanged} />}
      {role === 'admin' && alert.subject !== null && (
        <RequestAction alert={alert} subject={alert.subject} />
      )}
    </AlertView>
  );
}

function Review({ alert, onChanged }: { alert: AlertDetail; onChanged: OnChanged }) {
  const auth = useAuth();
  const [status, setStatus] = useState<string>(alert.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const me = auth.status === 'authenticated' ? auth.user.id : null;

  async function update(change: {
    status?: (typeof STATUSES)[number];
    assigneeId?: string | null;
  }) {
    setBusy(true);
    setOutcome(null);
    const result = await call(
      api.PATCH('/api/alerts/{id}', {
        params: { path: { id: alert.id } },
        body: { ...change, version: alert.version },
      }),
    );
    setBusy(false);
    if (result.ok) {
      onChanged();
      return;
    }
    if (result.failure.status === 409) {
      onChanged('Someone changed this alert meanwhile: it was reloaded, check it and try again.');
      return;
    }
    setOutcome({ ok: false, text: describeFailure(result.failure) });
  }

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
    <section className="card stack" aria-labelledby="review-heading">
      <h2 id="review-heading">Review</h2>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (status !== alert.status) {
            void update({ status: status as (typeof STATUSES)[number] });
          }
        }}
      >
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={asOptions(STATUSES)}
        />
        <div className="actions">
          <button type="submit" disabled={busy || status === alert.status}>
            Save status
          </button>
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
        </div>
      </form>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void addNote();
        }}
      >
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
