import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { type Role, useAuth } from '../../auth';
import { SelectField } from '../../audit/fields';
import { formatDateTime } from '../../audit/format';
import { isUuid } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { ConnectedAppList, UserAccess } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { TextField } from '../../components/TextField';
import { useLoader } from '../../hooks/useLoader';

const ROLES = [
  ['member', 'member: cannot sign in'],
  ['viewer', 'viewer: reads its applications'],
  ['auditor', 'auditor: reads, reviews alerts, exports'],
  ['admin', 'admin: everything'],
] as const;

type Outcome = { ok: boolean; text: string } | null;

const failureText = (failure: Parameters<typeof describeFailure>[0]) =>
  isReauthenticationRequired(failure)
    ? 'Nothing changed: it needs you to confirm it is you.'
    : describeFailure(failure);

// One person of Audit Hub, for administrators: their role, the applications
// an auditor or a viewer sees, their second factor, whether their account may
// sign in, and their removal. Every change needs a step-up and is recorded; a
// role change ends their access tokens at once, disabling every session too.
export function AdminUserPage() {
  const { userId = '' } = useParams();
  const [version, setVersion] = useState(0);
  // Their name and address change only when they are removed.
  const [removed, setRemoved] = useState(0);
  // Said above their access: a reload replaces everything below it.
  const [notice, setNotice] = useState<string | null>(null);
  const reload = () => {
    setVersion((current) => current + 1);
  };
  const access = useLoader(
    () =>
      isUuid(userId)
        ? call(api.GET('/api/users/{id}/access', { params: { path: { id: userId } } }))
        : Promise.resolve({ ok: false as const, failure: { status: 404, message: 'Not an id' } }),
    `${userId}/${String(version)}`,
  );
  const person = useLoader(
    () =>
      isUuid(userId)
        ? call(api.GET('/api/users/{id}', { params: { path: { id: userId } } }))
        : Promise.resolve({ ok: false as const, failure: { status: 404, message: 'Not an id' } }),
    `${userId}/${String(removed)}`,
  );
  const apps = useLoader(() => call(api.GET('/api/connected-apps')));
  return (
    <section className="stack" aria-labelledby="user-heading">
      <p>
        <Link to="/admin/users">← Users</Link>
      </p>
      <LoadView state={person.state} retry={person.retry} label="the person">
        {(user) => (
          <>
            <h1 id="user-heading">{user.name}</h1>
            <p>{user.email}</p>
          </>
        )}
      </LoadView>
      {notice !== null && <Alert tone="info">{notice}</Alert>}
      <LoadView state={access.state} retry={access.retry} label="their access">
        {(current) =>
          current.removedAt !== null ? (
            <Alert tone="info">
              Removed {formatDateTime(current.removedAt)}: the account keeps its id, so the records
              that name it still resolve, but nothing of the person. It cannot sign in again; a new
              invitation makes a new account.
            </Alert>
          ) : (
            <>
              <RoleForm
                key={`role-${String(version)}`}
                userId={userId}
                access={current}
                onSaved={reload}
              />
              {/* The API refuses them at sign-in (docs/security.md#who-may-sign-in). */}
              {current.role === 'member' ? (
                <Alert tone="info">
                  A member cannot sign in to the panel: choose another role to let them in.
                </Alert>
              ) : (
                current.role !== 'admin' &&
                current.apps.length === 0 && (
                  <Alert tone="info">
                    They cannot sign in until they see an application: choose at least one below.
                  </Alert>
                )
              )}
              {(current.role === 'auditor' || current.role === 'viewer') && (
                <LoadView state={apps.state} retry={apps.retry} label="applications">
                  {(list) => (
                    <AppsForm
                      key={`apps-${String(version)}`}
                      userId={userId}
                      access={current}
                      apps={list}
                      onSaved={reload}
                    />
                  )}
                </LoadView>
              )}
              <MfaReset
                userId={userId}
                access={current}
                onReset={() => {
                  setNotice(
                    'Second factor reset: their sessions ended, and they set up a new one at their next sign-in.',
                  );
                  reload();
                }}
              />
              <AccountStatus
                userId={userId}
                access={current}
                onChanged={(text) => {
                  setNotice(text);
                  reload();
                }}
              />
              <Removal
                userId={userId}
                onRemoved={() => {
                  setNotice('Removed: nothing of them is left in Audit Hub but their id.');
                  setRemoved((current) => current + 1);
                  reload();
                }}
              />
            </>
          )
        }
      </LoadView>
    </section>
  );
}

function RoleForm({
  userId,
  access,
  onSaved,
}: {
  userId: string;
  access: UserAccess;
  onSaved: () => void;
}) {
  const stepUp = useStepUp();
  const [role, setRole] = useState<string>(access.role);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save() {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.PATCH('/api/users/{id}/role', {
          params: { path: { id: userId } },
          body: { role: role as Role },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      onSaved();
    } else if (result.failure.status === 409) {
      setOutcome({
        ok: false,
        text: 'Audit Hub needs at least one administrator: promote someone else first.',
      });
    } else {
      setOutcome({ ok: false, text: failureText(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="role-heading">
      <h2 id="role-heading">Role</h2>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SelectField label="Role" value={role} onChange={setRole} options={ROLES} />
        <div className="actions">
          <button type="submit" disabled={busy || role === access.role}>
            Change role
          </button>
        </div>
      </form>
    </section>
  );
}

function AppsForm({
  userId,
  access,
  apps,
  onSaved,
}: {
  userId: string;
  access: UserAccess;
  apps: ConnectedAppList;
  onSaved: () => void;
}) {
  const stepUp = useStepUp();
  const [chosen, setChosen] = useState<string[]>(access.apps.map((app) => app.appId));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save() {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.PUT('/api/users/{id}/apps', {
          params: { path: { id: userId } },
          body: { appIds: chosen },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) onSaved();
    else setOutcome({ ok: false, text: failureText(result.failure) });
  }

  return (
    <section className="card stack" aria-labelledby="apps-heading">
      <h2 id="apps-heading">Applications they see</h2>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {apps.length === 0 ? (
          <p className="muted">No application yet.</p>
        ) : (
          <fieldset className="stack">
            <legend>Applications</legend>
            {apps.map((app) => (
              <label key={app.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={chosen.includes(app.id)}
                  onChange={(event) => {
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, app.id]
                        : current.filter((id) => id !== app.id),
                    );
                  }}
                />
                {app.name} ({app.environment})
              </label>
            ))}
          </fieldset>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Save applications
          </button>
        </div>
      </form>
    </section>
  );
}

function MfaReset({
  userId,
  access,
  onReset,
}: {
  userId: string;
  access: UserAccess;
  onReset: () => void;
}) {
  const auth = useAuth();
  const stepUp = useStepUp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const self = auth.status === 'authenticated' && auth.user.id === userId;

  async function reset() {
    if (reason.trim().length < 10) {
      setOutcome({ ok: false, text: 'Say why, in 10 characters or more: it is recorded.' });
      return;
    }
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/users/{id}/mfa-reset', {
          params: { path: { id: userId } },
          body: { reason: reason.trim() },
        }),
      ),
    );
    setBusy(false);
    if (result.ok) {
      setReason('');
      onReset();
    } else {
      setOutcome({ ok: false, text: failureText(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading">Second factor</h2>
      <p>
        {access.mfaConfirmedAt === null
          ? 'Not set up: they set it up at their next sign-in.'
          : `Set up ${formatDateTime(access.mfaConfirmedAt)}.`}
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      {self ? (
        <p className="muted">Your own: make new recovery codes from your account instead.</p>
      ) : (
        access.mfaConfirmedAt !== null && (
          <form
            className="filters"
            onSubmit={(event) => {
              event.preventDefault();
              void reset();
            }}
          >
            <TextField
              label="Why reset it"
              name="reason"
              maxLength={500}
              value={reason}
              onChange={setReason}
              error={null}
            />
            <div className="actions">
              <button type="submit" disabled={busy}>
                Reset their second factor
              </button>
            </div>
          </form>
        )
      )}
    </section>
  );
}

/** Whether the account may sign in: disabled, every session ends at once; enabled again. */
function AccountStatus({
  userId,
  access,
  onChanged,
}: {
  userId: string;
  access: UserAccess;
  onChanged: (notice: string) => void;
}) {
  const auth = useAuth();
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const self = auth.status === 'authenticated' && auth.user.id === userId;
  const disabled = access.disabledAt !== null;

  async function change(disable: boolean) {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.PATCH('/api/users/{id}/status', {
          params: { path: { id: userId } },
          body: { disabled: disable },
        }),
      ),
    );
    setBusy(false);
    setConfirming(false);
    if (result.ok) {
      onChanged(
        disable
          ? 'Disabled: every session of theirs ended, and they cannot sign in until enabled.'
          : 'Enabled: they can sign in again.',
      );
    } else if (result.failure.status === 409) {
      setOutcome({
        ok: false,
        text: 'Audit Hub needs at least one administrator who can sign in: make someone else one first.',
      });
    } else {
      setOutcome({ ok: false, text: failureText(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="status-heading">
      <h2 id="status-heading">Account</h2>
      <p>
        {disabled
          ? `Disabled ${formatDateTime(access.disabledAt)}: they cannot sign in.`
          : 'Active: they can sign in.'}
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      {self ? (
        <p className="muted">Your own: another administrator can disable it.</p>
      ) : disabled ? (
        <p>
          <button type="button" disabled={busy} onClick={() => void change(false)}>
            Enable their account
          </button>
        </p>
      ) : confirming ? (
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void change(true)}>
            {busy ? 'Disabling…' : 'Disable their account'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Disable their account…
          </button>
        </p>
      )}
    </section>
  );
}

/** Removes the person: the account keeps its id, nothing of them; for good. */
function Removal({ userId, onRemoved }: { userId: string; onRemoved: () => void }) {
  const auth = useAuth();
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  if (auth.status === 'authenticated' && auth.user.id === userId) return null;

  async function remove() {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(api.DELETE('/api/users/{id}', { params: { path: { id: userId } } })),
    );
    setBusy(false);
    setConfirming(false);
    if (result.ok) {
      onRemoved();
    } else if (result.failure.status === 409) {
      setOutcome({
        ok: false,
        text: 'Audit Hub needs at least one administrator who can sign in: make someone else one first.',
      });
    } else {
      setOutcome({ ok: false, text: failureText(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="removal-heading">
      <h2 id="removal-heading">Remove from Audit Hub</h2>
      <p>
        For someone who left, or who asked to be removed: their address, name, password, second
        factor, sessions and applications go, and the open alerts assigned to them are assigned to
        nobody. The account keeps its id, so Audit Hub's own log and its records still name it. It
        cannot be undone.
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      {confirming ? (
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Removing…' : 'Remove them'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Remove from Audit Hub…
          </button>
        </p>
      )}
    </section>
  );
}
