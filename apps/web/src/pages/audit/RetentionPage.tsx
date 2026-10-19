import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure, failedField } from '../../api/errors';
import { useVisibleApps } from '../../audit/apps';
import { AppPicker } from '../../audit/AppPicker';
import { DateTimeField } from '../../audit/fields';
import { formatDateTime, fromLocalInput, words } from '../../audit/format';
import { LoadView } from '../../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { LegalHolds, RetentionPolicies, VisibleApp } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

type Outcome = { ok: boolean; text: string } | null;

/** The API's field names (a 400 starts with one) as the new hold's form labels them. */
const HOLD_LABELS: Record<string, string> = {
  caseRef: 'Case reference',
  reason: 'Reason',
  actorId: 'User id',
  actorEmail: 'Email',
  resourceType: 'Resource type',
  resourceId: 'Resource id',
  fromAt: 'From',
  toAt: 'To',
};

const failureText = (failure: Parameters<typeof describeFailure>[0]) =>
  isReauthenticationRequired(failure)
    ? 'Nothing changed: it needs you to confirm it is you.'
    : describeFailure(failure);

// How long each application's records are kept (never below the legal
// minimums, which the database enforces) and the legal holds that keep
// records past them, for administrators. Every change needs a step-up and
// is recorded in Audit Hub's own log.
export function RetentionPage() {
  const apps = useVisibleApps();
  return (
    <section className="stack" aria-labelledby="retention-heading">
      <h1 id="retention-heading">Retention</h1>
      <LoadView state={apps.state} retry={apps.retry} label="applications">
        {({ items }) => {
          const choosable = items.filter((app) => !app.system);
          return choosable.length === 0 ? (
            <p>No application yet.</p>
          ) : (
            <RetentionOf apps={choosable} />
          );
        }}
      </LoadView>
    </section>
  );
}

function RetentionOf({ apps }: { apps: VisibleApp[] }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('appId') ?? '';
  const appId = apps.some((app) => app.appId === asked) ? asked : (apps[0]?.appId ?? '');
  const [version, setVersion] = useState(0);
  const reload = () => {
    setVersion((current) => current + 1);
  };
  const policies = useLoader(
    () => call(api.GET('/api/connected-apps/{appId}/retention', { params: { path: { appId } } })),
    `${appId}/${String(version)}`,
  );
  const holds = useLoader(
    () => call(api.GET('/api/connected-apps/{appId}/legal-holds', { params: { path: { appId } } })),
    `${appId}/${String(version)}`,
  );
  return (
    <>
      <AppPicker
        apps={apps}
        value={appId}
        onChange={(next) => {
          setParams({ appId: next });
        }}
      />
      <LoadView state={policies.state} retry={policies.retry} label="retention policies">
        {(rows) => (
          <Policies
            key={`${appId}/${String(version)}`}
            appId={appId}
            policies={rows}
            onSaved={reload}
          />
        )}
      </LoadView>
      <LoadView state={holds.state} retry={holds.retry} label="legal holds">
        {(rows) => <Holds appId={appId} holds={rows} onChanged={reload} />}
      </LoadView>
    </>
  );
}

function Policies({
  appId,
  policies,
  onSaved,
}: {
  appId: string;
  policies: RetentionPolicies;
  onSaved: () => void;
}) {
  const stepUp = useStepUp();
  const [days, setDays] = useState<Record<string, string>>(
    Object.fromEntries(policies.map((policy) => [policy.class, String(policy.days)])),
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save(policy: RetentionPolicies[number]) {
    const value = Number(days[policy.class]);
    if (!Number.isInteger(value) || value < policy.minimumDays || value > 3650) {
      setOutcome({
        ok: false,
        text: `${words(policy.class)}: from ${String(policy.minimumDays)} to 3650 days.`,
      });
      return;
    }
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.PUT('/api/connected-apps/{appId}/retention/{class}', {
          params: { path: { appId, class: policy.class } },
          body: { days: value },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) onSaved();
    else setOutcome({ ok: false, text: failureText(result.failure) });
  }

  return (
    <section className="card stack" aria-labelledby="policies-heading">
      <h2 id="policies-heading">How long records are kept</h2>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Records</th>
              <th scope="col">Minimum (days)</th>
              <th scope="col">Kept (days)</th>
              <th scope="col">
                <span className="muted">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.class}>
                <th scope="row">{words(policy.class)}</th>
                <td>{policy.minimumDays}</td>
                <td>
                  <input
                    aria-label={`Days to keep ${words(policy.class)} records`}
                    inputMode="numeric"
                    value={days[policy.class] ?? ''}
                    onChange={(event) => {
                      setDays((current) => ({ ...current, [policy.class]: event.target.value }));
                    }}
                  />
                  {policy.custom ? '' : ' (default)'}
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || days[policy.class] === String(policy.days)}
                    onClick={() => void save(policy)}
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Holds({
  appId,
  holds,
  onChanged,
}: {
  appId: string;
  holds: LegalHolds;
  onChanged: () => void;
}) {
  return (
    <section className="card stack" aria-labelledby="holds-heading">
      <h2 id="holds-heading">Legal holds</h2>
      <p className="muted">
        A hold keeps what it matches from retention and erasure until it is released.
      </p>
      {holds.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="stack">
          {holds.map((hold) => (
            <HoldItem key={hold.id} hold={hold} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <NewHold appId={appId} onCreated={onChanged} />
    </section>
  );
}

function HoldItem({ hold, onChanged }: { hold: LegalHolds[number]; onChanged: () => void }) {
  const stepUp = useStepUp();
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const matches = [
    hold.actorId === null ? null : `user ${hold.actorId}`,
    hold.byEmail ? 'an email (pseudonymized)' : null,
    hold.resourceType === null ? null : `${hold.resourceType} ${hold.resourceId ?? '(any)'}`,
    hold.fromAt === null && hold.toAt === null
      ? null
      : `${formatDateTime(hold.fromAt)} to ${formatDateTime(hold.toAt)}`,
  ].filter((part) => part !== null);

  async function release() {
    if (reason.trim().length < 10) {
      setFailure('Say why, in 10 characters or more.');
      return;
    }
    setBusy(true);
    setFailure(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/legal-holds/{id}/release', {
          params: { path: { id: hold.id } },
          body: { reason: reason.trim() },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) onChanged();
    else setFailure(failureText(result.failure));
  }

  return (
    <li className="stack">
      <div>
        <strong>{hold.caseRef}</strong>{' '}
        <span className="muted">
          {hold.release === null ? 'active' : `released ${formatDateTime(hold.release.releasedAt)}`}
        </span>
      </div>
      <div>
        Keeps: {matches.length === 0 ? 'everything of the application' : matches.join('; ')}
      </div>
      <div className="muted">{hold.reason}</div>
      {failure !== null && <Alert>{failure}</Alert>}
      {hold.release === null &&
        (releasing ? (
          <form
            className="filters"
            onSubmit={(event) => {
              event.preventDefault();
              void release();
            }}
          >
            <TextField
              label="Why release it"
              name="reason"
              maxLength={500}
              value={reason}
              onChange={setReason}
              error={null}
            />
            <div className="actions">
              <button type="submit" disabled={busy}>
                Release
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setReleasing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setReleasing(true);
              }}
            >
              Release…
            </button>
          </div>
        ))}
    </li>
  );
}

function NewHold({ appId, onCreated }: { appId: string; onCreated: () => void }) {
  const stepUp = useStepUp();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({
    caseRef: '',
    reason: '',
    actorId: '',
    actorEmail: '',
    resourceType: '',
    resourceId: '',
    fromAt: '',
    toAt: '',
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (name: keyof typeof fields) => (value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
  };

  async function create() {
    if (fields.caseRef.trim() === '' || fields.reason.trim().length < 10) {
      setFailure('A case reference, and why in 10 characters or more.');
      return;
    }
    const fromAt = fromLocalInput(fields.fromAt);
    const toAt = fromLocalInput(fields.toAt);
    setBusy(true);
    setFailure(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/legal-holds', {
          body: {
            appId,
            caseRef: fields.caseRef.trim(),
            reason: fields.reason.trim(),
            ...(fields.actorId === '' ? {} : { actorId: fields.actorId }),
            ...(fields.actorEmail === '' ? {} : { actorEmail: fields.actorEmail }),
            ...(fields.resourceType === '' ? {} : { resourceType: fields.resourceType }),
            ...(fields.resourceId === '' ? {} : { resourceId: fields.resourceId }),
            ...(fromAt === null ? {} : { fromAt }),
            ...(toAt === null ? {} : { toAt }),
          },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      onCreated();
      return;
    }
    const field = failedField(result.failure);
    setFailure(
      field === undefined
        ? failureText(result.failure)
        : `Check "${HOLD_LABELS[field] ?? words(field)}".`,
    );
  }

  if (!open) {
    return (
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          New legal hold…
        </button>
      </div>
    );
  }
  return (
    <form
      className="stack"
      aria-label="New legal hold"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      {failure !== null && <Alert>{failure}</Alert>}
      <div className="filters">
        <TextField
          label="Case reference"
          name="caseRef"
          maxLength={100}
          value={fields.caseRef}
          onChange={set('caseRef')}
          error={null}
        />
        <TextField
          label="Reason"
          name="reason"
          maxLength={500}
          value={fields.reason}
          onChange={set('reason')}
          error={null}
        />
      </div>
      <p className="muted">What it keeps: leave everything empty for the whole application.</p>
      <div className="filters">
        <TextField
          label="User id"
          name="actorId"
          value={fields.actorId}
          onChange={set('actorId')}
          error={null}
        />
        <TextField
          label="Email"
          type="email"
          name="actorEmail"
          value={fields.actorEmail}
          onChange={set('actorEmail')}
          error={null}
        />
        <TextField
          label="Resource type"
          name="resourceType"
          value={fields.resourceType}
          onChange={set('resourceType')}
          error={null}
        />
        <TextField
          label="Resource id"
          name="resourceId"
          value={fields.resourceId}
          onChange={set('resourceId')}
          error={null}
        />
        <DateTimeField label="From" value={fields.fromAt} onChange={set('fromAt')} />
        <DateTimeField label="To" value={fields.toAt} onChange={set('toAt')} />
      </div>
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create the hold'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
