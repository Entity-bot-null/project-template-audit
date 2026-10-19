import { lazy, type ReactNode, Suspense, useId, useState } from 'react';
import { Link } from 'react-router';
import { formatDateTime, formatWhen, words } from './format';
import { actorPath } from './links';
import type { EventSummary } from './types';

// The detail's code (and its JSON viewer) loads with the first drawer opened.
const EventDrawer = lazy(() =>
  import('./EventDrawer').then((module) => ({ default: module.EventDrawer })),
);

/** An outcome or a severity as a colored word (classes in index.css). */
export function Badge({ kind, value }: { kind: 'sev' | 'outcome' | 'status'; value: string }) {
  // Only known words become a class; anything else is shown, unstyled.
  const known = /^[a-z_]{1,32}$/.test(value);
  return <span className={known ? `badge ${kind}-${value}` : 'badge'}>{words(value)}</span>;
}

/** The risk of an event: its severity's color, and its score out of 100. */
export function RiskBadge({ severity, score }: { severity: string; score: number }) {
  const known = /^[a-z_]{1,32}$/.test(severity);
  return (
    <span className={known ? `badge risk sev-${severity}` : 'badge risk'}>
      {`${words(severity)} · ${String(score)}`}
    </span>
  );
}

/**
 * When an event was recorded, at a glance; the full date and time on hover.
 * Only a valid instant goes into attributes: an event's values stay text.
 */
function When({ iso, id }: { iso: string; id: string }) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return <span id={id}>{iso}</span>;
  return (
    <time id={id} dateTime={at.toISOString()} title={formatDateTime(iso)}>
      {formatWhen(iso)}
    </time>
  );
}

/**
 * A person of an application in words when known (the label sent, or the
 * name of Audit Hub's account), then their id: a link to their activity when
 * it is one. `fallback` stands in for a person without an id.
 */
export function PersonName({
  appId,
  id,
  label,
  fallback,
}: {
  appId: string;
  id: string | null;
  label: string | null;
  fallback: ReactNode;
}) {
  const path = actorPath(appId, id);
  const shown =
    id === null ? null : path === null ? (
      <span className="mono">{id}</span>
    ) : (
      <Link className="mono" to={path}>
        {id}
      </Link>
    );
  if (label === null) return shown ?? fallback;
  return (
    <div className="stack-tight">
      <span>{label}</span>
      {shown !== null && <small>{shown}</small>}
    </div>
  );
}

/** Who acted, in words when known: the label or the account's name, then the id. */
function ActorCell({ event }: { event: EventSummary }) {
  return (
    <PersonName
      appId={event.appId}
      id={event.actor.id}
      label={event.actor.label}
      fallback={<span className="muted">{event.actor.type}</span>}
    />
  );
}

/**
 * Events, newest first, at a glance: when, who, what in words, where, how it
 * ended and how risky it was. Everything else (network, request, integrity,
 * the JSON of the change and the details) loads in a drawer when asked for.
 */
export function EventTable({
  events,
  showApp = true,
  caption,
}: {
  events: EventSummary[];
  showApp?: boolean;
  caption: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  if (events.length === 0) return <p className="muted">No events match.</p>;
  return (
    <>
      <div className="table-scroll">
        <table>
          <caption className="muted">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Date and time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              {showApp && <th scope="col">Application</th>}
              <th scope="col">Outcome</th>
              <th scope="col">Risk</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => {
              // The button's name is its row's words (by id): no value of the
              // event is ever put in an attribute.
              const row = `${base}-${String(index)}`;
              return (
                <tr key={event.id}>
                  <td>
                    <When iso={event.recordedAt} id={`${row}-when`} />
                  </td>
                  <td>
                    <ActorCell event={event} />
                  </td>
                  <td>
                    <div className="stack-tight">
                      <span
                        id={`${row}-what`}
                        className={event.description === null ? 'mono' : undefined}
                      >
                        {event.description ?? event.action}
                      </span>
                      {event.description !== null && (
                        <small className="mono muted">{event.action}</small>
                      )}
                    </div>
                  </td>
                  {showApp && <td>{event.appSlug}</td>}
                  <td>
                    <Badge kind="outcome" value={event.outcome} />
                  </td>
                  <td>
                    <RiskBadge severity={event.severity} score={event.riskScore} />
                  </td>
                  <td>
                    {/* The name starts with the visible words, as speech input expects. */}
                    <button
                      id={`${row}-details`}
                      type="button"
                      className="link-button"
                      aria-labelledby={`${row}-details ${row}-what ${row}-when`}
                      onClick={() => {
                        setOpen(event.id);
                      }}
                    >
                      View details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open !== null && (
        <Suspense
          fallback={
            <div className="drawer-backdrop">
              <p className="drawer" role="status">
                Loading the event…
              </p>
            </div>
          }
        >
          <EventDrawer
            eventId={open}
            onClose={() => {
              setOpen(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
