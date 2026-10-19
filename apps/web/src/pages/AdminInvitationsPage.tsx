import { useId, useState } from 'react';
import { api } from '../api/client';
import { call, describeFailure, failedField } from '../api/errors';
import type { ConnectedAppList } from '../audit/types';
import { useCapabilities } from '../auth/capabilities';
import type { Role } from '../auth/types';
import { emailError } from '../auth/validation';
import { Alert } from '../components/Alert';
import { LoadFailed } from '../components/LoadFailed';
import { TextField } from '../components/TextField';
import { useFocusFirstInvalid } from '../hooks/useFocusFirstInvalid';
import { useLoader } from '../hooks/useLoader';

const PAGE_SIZE = 50;

const fetchInvitations = () =>
  call(api.GET('/api/admin/invitations', { params: { query: { limit: PAGE_SIZE } } }));

const fetchApps = () => call(api.GET('/api/connected-apps'));

type InvitationPage = Extract<Awaited<ReturnType<typeof fetchInvitations>>, { ok: true }>['data'];
type Invitation = InvitationPage['items'][number];
/** The roles that sign in to the panel: a member could not (docs/security.md#who-may-sign-in). */
type InvitedRole = Exclude<Role, 'member'>;

const ROLE_OPTIONS: readonly (readonly [InvitedRole, string])[] = [
  ['viewer', 'Viewer: reads the applications chosen'],
  ['auditor', 'Auditor: reads, reviews alerts, exports'],
  ['admin', 'Admin: everything'],
];

/** An invitation that still opens the panel: an admin, or an auditor or a viewer with applications. */
const acceptable = (invitation: Invitation) =>
  invitation.role === 'admin' || (invitation.role !== 'member' && invitation.apps.length > 0);

/**
 * Admins only: the route is guarded here and, authoritatively, by the API.
 * Inviting sends a link to the address; the account exists once the person
 * accepts it with their own name and password, with the role chosen here
 * and, for an auditor or a viewer, the applications they will see: without
 * one they could not sign in.
 */
export function AdminInvitationsPage() {
  const capabilities = useCapabilities();
  // Bumped after an invitation is sent or revoked: the list loads again.
  const [version, setVersion] = useState(0);
  const { state, retry } = useLoader(fetchInvitations, version);
  const apps = useLoader(fetchApps);
  // The last list loaded stays on screen while the next one loads (after an
  // invitation is sent or revoked), instead of flashing a loading message.
  const [shown, setShown] = useState<InvitationPage | null>(null);
  // Adjusted while rendering, as React recommends for state derived from a
  // change: no extra render pass through an effect.
  if (state.kind === 'loaded' && state.data !== shown) setShown(state.data);
  const current = state.kind === 'loaded' ? state.data : shown;
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // A row's action on its way: every row's buttons wait for it (no double send).
  const [acting, setActing] = useState(false);

  const act = (action: () => Promise<unknown>) => {
    setActing(true);
    void action().finally(() => {
      setActing(false);
    });
  };

  const changed = (message: string) => {
    setNotice(message);
    setFailure(null);
    setVersion((current) => current + 1);
  };

  async function send(email: string, role: InvitedRole, appIds: string[]): Promise<boolean> {
    setNotice(null);
    setFailure(null);
    const result = await call(
      api.POST('/api/admin/invitations', { body: { email, role, appIds } }),
    );
    if (result.ok) {
      changed(`Invitation sent to ${email}.`);
      return true;
    }
    const { status } = result.failure;
    const field = failedField(result.failure);
    setFailure(
      field === 'email'
        ? `${email} is not a valid address.`
        : field === 'appIds'
          ? 'An auditor or a viewer needs at least one application; an admin sees every one.'
          : status === 404
            ? 'An application chosen is no longer available: choose again.'
            : status === 409
              ? `${email} already has an account.`
              : status === 429
                ? `${email} got a message moments ago: invite it again in a minute.`
                : status === 503
                  ? 'Email is off here: create accounts with the user:create command.'
                  : describeFailure(result.failure),
    );
    return false;
  }

  async function revoke(id: string, email: string) {
    setNotice(null);
    const result = await call(
      api.DELETE('/api/admin/invitations/{id}', { params: { path: { id } } }),
    );
    if (result.ok || result.failure.status === 404) {
      changed(`Invitation to ${email} revoked.`);
    } else {
      setFailure(describeFailure(result.failure));
    }
  }

  return (
    <section className="stack" aria-labelledby="invitations-heading">
      <h1 id="invitations-heading">Invitations</h1>
      {notice !== null && <Alert tone="info">{notice}</Alert>}
      {failure !== null && <Alert>{failure}</Alert>}
      {capabilities?.invitations === false && (
        <Alert tone="info">
          Email is off here: invitations cannot be sent. Create accounts with the user:create
          command.
        </Alert>
      )}
      {/* Offered unless the deployment says email is off: while that is
          unknown, the API's answer (503) still tells. */}
      {capabilities?.invitations !== false && (
        <InviteForm apps={apps.state.kind === 'loaded' ? apps.state.data : null} onSend={send} />
      )}
      <h2>Pending</h2>
      {state.kind === 'loading' && shown === null && <p role="status">Loading invitations…</p>}
      {state.kind === 'failed' && (
        <LoadFailed
          failure={state.failure}
          retrying={state.retrying}
          onRetry={() => void retry()}
        />
      )}
      {state.kind !== 'failed' && current !== null && (
        <InvitationList
          page={current}
          busy={state.kind === 'loading'}
          acting={acting}
          onSend={(invitation) => {
            if (invitation.role === 'member') return;
            const role = invitation.role;
            act(() =>
              send(
                invitation.email,
                role,
                invitation.apps.map((app) => app.appId),
              ),
            );
          }}
          onRevoke={(id, email) => {
            act(() => revoke(id, email));
          }}
        />
      )}
    </section>
  );
}

function InviteForm({
  apps,
  onSend,
}: {
  /** The applications that can be chosen; null while they load. */
  apps: ConnectedAppList | null;
  onSend: (email: string, role: InvitedRole, appIds: string[]) => Promise<boolean>;
}) {
  const { formRef, focusInvalid } = useFocusFirstInvalid();
  const appsErrorId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitedRole>('viewer');
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Applications still in service: a retired one shows nothing any more.
  const choices = (apps ?? []).filter((app) => app.status !== 'retired');
  const needsApps = role !== 'admin';

  async function submit() {
    const problem = emailError(email);
    const missing = needsApps && chosen.length === 0 ? 'Choose at least one application.' : null;
    setError(problem);
    setAppsError(missing);
    if (problem !== null || missing !== null) return;
    setSubmitting(true);
    const sent = await onSend(email.trim(), role, needsApps ? chosen : []);
    setSubmitting(false);
    if (sent) {
      setEmail('');
      setChosen([]);
    }
  }

  return (
    <form
      className="stack auth-form"
      noValidate
      aria-labelledby="invite-heading"
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit().then(focusInvalid);
      }}
    >
      <h2 id="invite-heading">Invite someone</h2>
      <TextField
        label="Email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={setEmail}
        error={error}
      />
      <div className="field">
        <label htmlFor="invite-role">Role</label>
        <select
          id="invite-role"
          value={role}
          onChange={(event) => {
            const next = ROLE_OPTIONS.find(([value]) => value === event.target.value);
            if (next !== undefined) setRole(next[0]);
            setAppsError(null);
          }}
        >
          {ROLE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {needsApps ? (
        <fieldset className="stack" aria-describedby={appsError === null ? undefined : appsErrorId}>
          <legend>Applications they will see</legend>
          {apps === null ? (
            <p className="muted" role="status">
              Loading applications…
            </p>
          ) : choices.length === 0 ? (
            <p className="muted">
              No application yet: connect one first, or invite an admin, who sees every one.
            </p>
          ) : (
            choices.map((app, index) => (
              <label key={app.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={chosen.includes(app.id)}
                  aria-invalid={index === 0 && appsError !== null}
                  onChange={(event) => {
                    setAppsError(null);
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, app.id]
                        : current.filter((id) => id !== app.id),
                    );
                  }}
                />
                {app.name} ({app.environment})
              </label>
            ))
          )}
          {appsError !== null && (
            <p id={appsErrorId} className="field-error">
              {appsError}
            </p>
          )}
        </fieldset>
      ) : (
        <p className="muted">An admin sees every application.</p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Sending…' : 'Send invitation'}
      </button>
    </form>
  );
}

function InvitationList({
  page,
  busy,
  acting,
  onSend,
  onRevoke,
}: {
  page: InvitationPage;
  busy: boolean;
  /** An action of a row is on its way: the buttons wait. */
  acting: boolean;
  onSend: (invitation: Invitation) => void;
  onRevoke: (id: string, email: string) => void;
}) {
  if (page.items.length === 0) return <p aria-busy={busy}>No pending invitations.</p>;
  return (
    <table aria-busy={busy}>
      <thead>
        <tr>
          <th scope="col">Email</th>
          <th scope="col">Role</th>
          <th scope="col">Applications</th>
          <th scope="col">Invited by</th>
          <th scope="col">Link works until</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {page.items.map((invitation) => (
          <tr key={invitation.id}>
            <td>{invitation.email}</td>
            <td>{invitation.role}</td>
            <td>
              {invitation.role === 'admin'
                ? 'Every one'
                : invitation.apps.map((app) => app.name).join(', ') || '—'}
              {!acceptable(invitation) && (
                <span className="muted">
                  {' '}
                  Cannot be accepted: it gives no access to the panel. Revoke it and invite again.
                </span>
              )}
            </td>
            <td>{invitation.invitedBy?.name ?? 'Unknown'}</td>
            <td>
              {invitation.expiresAt === null
                ? 'Sending…'
                : new Date(invitation.expiresAt).toLocaleString()}
            </td>
            <td>
              {/* Names start with the visible word, as speech input expects. */}
              {acceptable(invitation) && (
                <>
                  <button
                    type="button"
                    className="link-button"
                    disabled={acting}
                    aria-label={`Send again to ${invitation.email}`}
                    onClick={() => {
                      onSend(invitation);
                    }}
                  >
                    Send again
                  </button>{' '}
                </>
              )}
              <button
                type="button"
                className="link-button"
                disabled={acting}
                aria-label={`Revoke the invitation to ${invitation.email}`}
                onClick={() => {
                  onRevoke(invitation.id, invitation.email);
                }}
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
