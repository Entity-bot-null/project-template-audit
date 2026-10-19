import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { call, describeFailure } from '../../api/errors';
import { useAuth } from '../../auth';
import { EventTable } from '../../audit/EventTable';
import { formatDateTime, formatNumber } from '../../audit/format';
import { actorPath, isUuid } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { CursorPager } from '../../audit/Pager';
import { isReauthenticationRequired, useStepUp } from '../../audit/step-up';
import { Alert } from '../../components/Alert';
import { useLoader } from '../../hooks/useLoader';

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

// One user of an application, all around (360°): what they did and what was
// done to them, newest first, with a summary. An administrator can erase
// their personal data here, or their events too (right to erasure), after a
// step-up. Once erased, the user is blocked (LFPDPPP art. 24): what is kept
// of what occurred up to their last erasure is shown for nobody, unless a
// legal hold names them; what they do afterwards (an account that stays) is
// new data, shown as usual.
export function ActorPage() {
  const { appId = '', actorId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor');
  const acrossApps = params.get('acrossApps') === 'true';
  const valid = isUuid(appId) && ID.test(actorId);
  const { state, retry } = useLoader(
    () =>
      valid
        ? call(
            api.GET('/api/connected-apps/{appId}/subjects/{subject}', {
              params: {
                path: { appId, subject: actorId },
                query: {
                  limit: 50,
                  ...(cursor === null ? {} : { cursor }),
                  ...(acrossApps ? { acrossApps: 'true' as const } : {}),
                },
              },
            }),
          )
        : Promise.resolve({
            ok: false as const,
            failure: { status: 404, message: 'Not a user id' },
          }),
    `${appId}/${actorId}?${params.toString()}`,
  );
  const go = (next: { cursor?: string; acrossApps?: boolean }) => {
    const search = new URLSearchParams();
    if (next.acrossApps ?? acrossApps) search.set('acrossApps', 'true');
    if (next.cursor !== undefined) search.set('cursor', next.cursor);
    setParams(search);
  };

  return (
    <section className="stack" aria-labelledby="actor-heading">
      <p>
        <Link to="/events">← Events</Link>
      </p>
      <h1 id="actor-heading">
        User <span className="mono">{actorId}</span>
      </h1>
      <LoadView state={state} retry={retry} label="the user's activity">
        {(activity) => (
          <>
            {activity.blockedSince !== null && (
              <Alert tone="info">
                Blocked since {formatDateTime(activity.blockedSince)}, after an erasure: what is
                kept of what occurred up to {formatDateTime(activity.blockedThrough)} stays
                pseudonymous and is shown to nobody for this person, unless a legal hold names them;
                it is deleted at the end of its retention. Below, only what came after.
              </Alert>
            )}
            <dl className="details-grid">
              <dt>Application</dt>
              <dd>{activity.events.items[0]?.appSlug ?? '—'}</dd>
              <dt>First seen</dt>
              <dd>{formatDateTime(activity.summary.firstSeenAt)}</dd>
              <dt>Last seen</dt>
              <dd>{formatDateTime(activity.summary.lastSeenAt)}</dd>
              <dt>Last sign-in</dt>
              <dd>{formatDateTime(activity.summary.lastSignInAt)}</dd>
              <dt>Devices</dt>
              <dd>{formatNumber(activity.summary.devices)}</dd>
              <dt>Countries</dt>
              <dd>{activity.summary.countries.join(', ') || '—'}</dd>
              <dt>Open alerts</dt>
              <dd>
                {activity.summary.openAlerts > 0 ? (
                  <Link to={`/alerts?appId=${appId}`}>
                    {formatNumber(activity.summary.openAlerts)}
                  </Link>
                ) : (
                  'none'
                )}
              </dd>
            </dl>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={acrossApps}
                onChange={(event) => {
                  go({ acrossApps: event.target.checked });
                }}
              />
              Also in other applications (where correlation is on)
            </label>
            {acrossApps && (
              <p>
                {activity.summary.otherApps.length === 0
                  ? 'Not found in another application.'
                  : 'Also in: '}
                {activity.summary.otherApps.map((other) => {
                  const path = actorPath(other.appId, actorId);
                  return path === null ? null : (
                    <Link key={other.appId} to={path}>
                      {other.slug}{' '}
                    </Link>
                  );
                })}
              </p>
            )}
            <EventTable events={activity.events.items} showApp={false} caption="Newest first" />
            <CursorPager
              nextCursor={activity.events.nextCursor}
              atNewest={cursor === null}
              onNewest={() => {
                go({});
              }}
              onOlder={(next) => {
                go({ cursor: next });
              }}
            />
          </>
        )}
      </LoadView>
      {valid && <Erasure appId={appId} actorId={actorId} />}
    </section>
  );
}

/**
 * Administrators only (the API refuses others): the right to erasure, after
 * a step-up. Their personal data, or, once the application cancels them, their
 * events too: the sealed ones at once, the rest within a day.
 */
function Erasure({ appId, actorId }: { appId: string; actorId: string }) {
  const auth = useAuth();
  const stepUp = useStepUp();
  const [scope, setScope] = useState<'personal' | 'events'>('personal');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  if (auth.status !== 'authenticated' || auth.user.role !== 'admin') return null;

  async function erase() {
    setBusy(true);
    setOutcome(null);
    const result = await stepUp.recent(() =>
      call(
        api.POST('/api/connected-apps/{appId}/subjects/{subject}/erasure', {
          params: { path: { appId, subject: actorId } },
          body: { scope },
        }),
      ),
    );
    setBusy(false);
    setConfirming(false);
    if (result.ok) {
      const { personalDeleted, locationDeleted, held, eventsDeleted, eventsPending } = result.data;
      const personal = `the personal data of ${formatNumber(personalDeleted)} events and ${formatNumber(locationDeleted)} locations; ${formatNumber(held)} kept by a legal hold.`;
      setOutcome({
        ok: true,
        text:
          eventsDeleted === undefined
            ? `Erased ${personal} The events stay, pseudonymous.`
            : `Erased ${personal} ${formatNumber(eventsDeleted)} events deleted; ${formatNumber(eventsPending ?? 0)} more within a day, once sealed.`,
      });
    } else if (isReauthenticationRequired(result.failure)) {
      setOutcome({
        ok: false,
        text: 'Nothing was erased: erasure needs you to confirm it is you.',
      });
    } else {
      setOutcome({ ok: false, text: describeFailure(result.failure) });
    }
  }

  return (
    <section className="card stack" aria-labelledby="erasure-heading">
      <h2 id="erasure-heading">Right to erasure</h2>
      <p>
        Deletes this user's personal data (addresses, devices, labels, places) from every event of
        theirs in this application, except what a legal hold keeps, and blocks them: their events
        are shown to nobody for them. It cannot be undone.
      </p>
      <fieldset className="stack">
        <legend>What it deletes</legend>
        <label className="checkbox">
          <input
            type="radio"
            name="scope"
            checked={scope === 'personal'}
            onChange={() => {
              setScope('personal');
            }}
          />
          Their personal data: the events stay, pseudonymous, until their retention
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="scope"
            checked={scope === 'events'}
            onChange={() => {
              setScope('events');
            }}
          />
          Their events too, once the application cancelled their data: the sealed ones now, the rest
          within a day
        </label>
      </fieldset>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      {confirming ? (
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void erase()}>
            {busy
              ? 'Erasing…'
              : scope === 'events'
                ? 'Erase their personal data and events'
                : 'Erase their personal data'}
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
            Erase personal data…
          </button>
        </p>
      )}
    </section>
  );
}
