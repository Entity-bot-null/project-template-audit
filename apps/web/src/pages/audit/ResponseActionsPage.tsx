import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { useVisibleApps } from '../../audit/apps';
import { AppPicker } from '../../audit/AppPicker';
import { Badge } from '../../audit/EventTable';
import { SelectField } from '../../audit/fields';
import { asOptions, formatDateTime, words } from '../../audit/format';
import { actorPath, alertPath } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { OffsetPager } from '../../audit/Pager';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import type { ResponseAction } from '../../audit/types';
import { Alert } from '../../components/Alert';
import { useLoader } from '../../hooks/useLoader';

const STATUSES = [
  'pending_approval',
  'dispatched',
  'succeeded',
  'failed',
  'refused',
  'unsupported',
  'expired',
  'cancelled',
] as const;
type Status = (typeof STATUSES)[number];
const PAGE_SIZE = 25;

// What Audit Hub asked applications to do to their users (revoke sessions,
// require a new password, disable an account), and their approval: an
// application can ask for a second administrator's (four eyes).
export function ResponseActionsPage() {
  const [params, setParams] = useSearchParams();
  const appId = params.get('appId') ?? '';
  const status = STATUSES.find((value) => value === params.get('status'));
  const offset = Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0);
  const [reload, setReload] = useState(0);
  const apps = useVisibleApps();
  const { state, retry } = useLoader(
    () =>
      call(
        api.GET('/api/response-actions', {
          params: {
            query: {
              ...(appId === '' ? {} : { appId }),
              ...(status === undefined ? {} : { status }),
              limit: PAGE_SIZE,
              offset,
            },
          },
        }),
      ),
    `${params.toString()}/${String(reload)}`,
  );
  const go = (next: { appId?: string; status?: string; offset?: number }) => {
    const search = new URLSearchParams();
    const nextApp = next.appId ?? appId;
    const nextStatus = next.status ?? status ?? '';
    if (nextApp !== '') search.set('appId', nextApp);
    if (nextStatus !== '') search.set('status', nextStatus);
    if ((next.offset ?? 0) > 0) search.set('offset', String(next.offset));
    setParams(search);
  };

  return (
    <section className="stack" aria-labelledby="actions-heading">
      <h1 id="actions-heading">Response actions</h1>
      <p className="muted">
        They are requested from an alert. Each one is a signed webhook to its application, which
        acts only on the actions it accepts.
      </p>
      <div className="filters">
        {apps.state.kind === 'loaded' && (
          <AppPicker
            apps={apps.state.data.items.filter((app) => !app.system)}
            value={appId}
            onChange={(next) => {
              go({ appId: next });
            }}
            allLabel="Every application"
          />
        )}
        <SelectField
          label="Status"
          value={status ?? ''}
          onChange={(next) => {
            go({ status: next });
          }}
          options={asOptions(STATUSES)}
          anyLabel="Any"
        />
      </div>
      <LoadView state={state} retry={retry} label="response actions">
        {(page) =>
          page.items.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <>
              <ul className="stack">
                {page.items.map((action) => (
                  <ActionItem
                    key={action.id}
                    action={action}
                    onChanged={() => {
                      setReload((current) => current + 1);
                    }}
                  />
                ))}
              </ul>
              <OffsetPager
                total={page.total}
                limit={PAGE_SIZE}
                offset={offset}
                onChange={(next) => {
                  go({ offset: next });
                }}
              />
            </>
          )
        }
      </LoadView>
    </section>
  );
}

function ActionItem({ action, onChanged }: { action: ResponseAction; onChanged: () => void }) {
  const auth = useAuth();
  const stepUp = useStepUp();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const subject = actorPath(action.appId, action.subject);
  const alert = action.alertId === null ? null : alertPath(action.alertId);
  const mine = auth.status === 'authenticated' && auth.user.id === action.requestedById;

  async function decide(kind: 'approve' | 'cancel') {
    setBusy(true);
    setFailure(null);
    const send = () =>
      call(
        kind === 'approve'
          ? api.POST('/api/response-actions/{id}/approve', { params: { path: { id: action.id } } })
          : api.POST('/api/response-actions/{id}/cancel', { params: { path: { id: action.id } } }),
      );
    const result = kind === 'approve' ? await stepUp.recent(send) : await send();
    setBusy(false);
    if (result.ok) {
      onChanged();
    } else if (isReauthenticationRequired(result.failure)) {
      setFailure('Not approved: approving needs you to confirm it is you.');
    } else if (result.failure.status === 409) {
      setFailure(
        'It changed meanwhile, or you requested it yourself: another administrator approves it.',
      );
    } else {
      setFailure(describeFailure(result.failure));
    }
  }

  const pending: Status = 'pending_approval';
  return (
    <li className="card stack">
      <div className="page-header">
        <strong>{words(action.action)}</strong>
        <Badge kind="status" value={action.status} />
      </div>
      <dl className="details-grid">
        <dt>User</dt>
        <dd>
          {subject === null ? (
            <span className="mono">{action.subject}</span>
          ) : (
            <Link className="mono" to={subject}>
              {action.subject}
            </Link>
          )}
        </dd>
        <dt>Reason</dt>
        <dd>{action.reason}</dd>
        <dt>Requested</dt>
        <dd>
          {formatDateTime(action.createdAt)}
          {mine ? ' (by you)' : ''}
        </dd>
        <dt>Approved</dt>
        <dd>{formatDateTime(action.approvedAt)}</dd>
        <dt>Expires</dt>
        <dd>{formatDateTime(action.expiresAt)}</dd>
        <dt>Completed</dt>
        <dd>{formatDateTime(action.completedAt)}</dd>
        {alert !== null && (
          <>
            <dt>Alert</dt>
            <dd>
              <Link to={alert}>Open the alert</Link>
            </dd>
          </>
        )}
      </dl>
      {failure !== null && <Alert>{failure}</Alert>}
      {action.status === pending && (
        <div className="actions">
          {!mine && (
            <button type="button" disabled={busy} onClick={() => void decide('approve')}>
              Approve
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void decide('cancel')}
          >
            Cancel it
          </button>
        </div>
      )}
    </li>
  );
}
