import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth';
import { Facts, Heading, type Level, Section } from './DetailParts';
import { Badge, EventTable, PersonName } from './EventTable';
import { formatDateTime, formatNumber, formatWhen, words } from './format';
import { JsonView } from './JsonView';
import { alertPath, eventPath } from './links';
import type { AlertDetail } from './types';

type Tally = AlertDetail['evidence']['outcomes'];
type Activity = AlertDetail['activities'][number];

/** The drawer lists this many of the events behind an alert; the page, every one kept. */
const DRAWER_EVENTS = 10;

/** Values and how many events have them: "invalid credentials × 9, mfa failed × 3". */
function tallied(values: Tally, asWords = false): string | null {
  if (values.length === 0) return null;
  return values
    .map(({ value, count }) => `${asWords ? words(value) : value} × ${formatNumber(count)}`)
    .join(', ');
}

/** One change of the alert, with who made it, by name. */
function ActivityLine({ activity }: { activity: Activity }) {
  const by = activity.userLabel === null ? '' : ` by ${activity.userLabel}`;
  let said: ReactNode = null;
  if (activity.kind === 'assigned') {
    said =
      activity.note === null || activity.note === 'unassigned'
        ? ' to nobody'
        : ` to ${activity.assigneeLabel ?? activity.note}`;
  } else if (activity.fromStatus !== null && activity.toStatus !== null) {
    said = `: ${words(activity.fromStatus)} → ${words(activity.toStatus)}`;
  } else if (activity.note !== null) {
    said = (
      <>
        {': '}
        <q>{activity.note}</q>
      </>
    );
  }
  return (
    <li>
      {formatDateTime(activity.createdAt)} · {words(activity.kind)}
      {by}
      {said}
    </li>
  );
}

/**
 * One alert, every part of it: why it fired in words (what its rule looks
 * for, what it saw), who it is about and who works on it by name, what the
 * events behind it have in common (how they ended and why: their reasons,
 * the errors), the events themselves, its history and what the rule kept.
 * Every value is text; links are built from validated ids only (docs/adr/0014).
 * The page (AlertDetailPage) adds the review and the response actions in
 * `children` and lists every event kept with their details; the drawer of
 * the list (AlertDrawer), one level down, the first ones and a link to the
 * page instead.
 */
export function AlertView({
  alert,
  variant,
  headingId,
  children,
}: {
  alert: AlertDetail;
  variant: 'page' | 'drawer';
  headingId?: string;
  children?: ReactNode;
}) {
  const auth = useAuth();
  const me = auth.status === 'authenticated' ? auth.user.id : null;
  const title: Level = variant === 'page' ? 1 : 3;
  const section: Level = variant === 'page' ? 2 : 4;
  const { explanation, evidence } = alert;
  const page = alertPath(alert.id);
  return (
    <>
      <Heading level={title} id={headingId}>
        {alert.title}
      </Heading>
      <p className="actions">
        <Badge kind="sev" value={alert.severity} />
        <Badge kind="status" value={alert.status} />
        <span>{alert.appSlug}</span>
        <span className="muted">{formatWhen(alert.lastSeenAt)}</span>
      </p>
      <Section title="Why it fired" level={section}>
        {explanation.saw.length > 0 ? (
          <ul>
            {explanation.saw.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>
            This version of Audit Hub does not describe this rule: what it saw is below, as it kept
            it.
          </p>
        )}
        <p className="muted">
          Rule <span className="mono">{alert.rule}</span>
          {explanation.looksFor !== null && `: ${explanation.looksFor}`}
        </p>
      </Section>
      <div className="cards">
        <Section title="Who and when" level={section}>
          <Facts
            rows={[
              [
                'Subject',
                <PersonName
                  key="subject"
                  appId={alert.appId}
                  id={alert.subject}
                  label={alert.subjectLabel}
                  fallback="—"
                />,
              ],
              ['Occurrences', formatNumber(alert.occurrences)],
              ['First seen', formatDateTime(alert.firstSeenAt)],
              ['Last seen', formatDateTime(alert.lastSeenAt)],
              [
                'Assigned to',
                alert.assigneeId === null
                  ? 'nobody'
                  : alert.assigneeId === me
                    ? 'you'
                    : (alert.assigneeLabel ?? alert.assigneeId),
              ],
              [
                'Resolved',
                alert.resolvedAt === null
                  ? null
                  : `${formatDateTime(alert.resolvedAt)}${alert.resolvedByLabel === null ? '' : ` by ${alert.resolvedByLabel}`}`,
              ],
            ]}
          />
        </Section>
        <Section title="What the events show" level={section}>
          {evidence.events === 0 ? (
            <p className="muted">None kept.</p>
          ) : (
            <Facts
              rows={[
                [
                  'Events',
                  evidence.from === null || evidence.to === null
                    ? formatNumber(evidence.events)
                    : `${formatNumber(evidence.events)}, ${formatDateTime(evidence.from)} to ${formatDateTime(evidence.to)}`,
                ],
                ['Outcomes', tallied(evidence.outcomes, true)],
                ['Reasons', tallied(evidence.reasons, true)],
                ['Actions', tallied(evidence.actions)],
                ['Accounts', formatNumber(evidence.accounts)],
                ['Countries', tallied(evidence.countries)],
                ['Devices', tallied(evidence.devices)],
              ]}
            />
          )}
        </Section>
      </div>
      {children}
      <section className="stack" aria-label="Events behind it">
        <Heading level={section}>Events behind it</Heading>
        {alert.events.length === 0 ? (
          <p className="muted">None kept.</p>
        ) : variant === 'page' ? (
          <EventTable events={alert.events} caption="Oldest first: the first 100 are kept" />
        ) : (
          <>
            <ul>
              {alert.events.slice(0, DRAWER_EVENTS).map((event) => {
                const path = eventPath(event.id);
                const when = formatDateTime(event.recordedAt);
                return (
                  <li key={event.id}>
                    {path === null ? when : <Link to={path}>{when}</Link>}
                    {' · '}
                    {event.actor.label ?? event.actor.id ?? event.actor.type}
                    {' · '}
                    {event.description ?? <span className="mono">{event.action}</span>}{' '}
                    <Badge kind="outcome" value={event.outcome} />
                  </li>
                );
              })}
            </ul>
            {alert.events.length > DRAWER_EVENTS && page !== null && (
              <p>
                {formatNumber(alert.events.length - DRAWER_EVENTS)} more:{' '}
                <Link to={page}>open the alert as a page</Link> to see every one, with its details.
              </p>
            )}
          </>
        )}
      </section>
      <section className="stack" aria-label="History">
        <Heading level={section}>History</Heading>
        <ol>
          {alert.activities.map((activity) => (
            <ActivityLine key={activity.id} activity={activity} />
          ))}
        </ol>
      </section>
      <Section title="What the rule saw" level={section}>
        <JsonView value={alert.summary} />
      </Section>
    </>
  );
}
