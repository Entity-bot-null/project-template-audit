import { Link } from 'react-router';
import { Alert } from '../components/Alert';
import { Facts, Heading, type Level, Section } from './DetailParts';
import { Badge, EventTable, RiskBadge } from './EventTable';
import { formatDateTime, formatNumber, formatWhen, words } from './format';
import { JsonView } from './JsonView';
import { actorPath, eventPath, resourcePath } from './links';
import type { EventDetail } from './types';

/** A device position more accurate than this is a precise one (locationDecimals of the contract). */
const PRECISE_BELOW_M = 1000;

const text = (value: string | number | null | undefined) =>
  value === null || value === undefined
    ? null
    : typeof value === 'number'
      ? formatNumber(value)
      : value;
const mono = (value: string | null | undefined) =>
  value === null || value === undefined || value === '' ? null : (
    <span className="mono">{value}</span>
  );
const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ') || null;

/**
 * One event, every section of it (docs/design/audit-hub/contract.md): who,
 * from where, the request and the client, its audit and integrity facts, its
 * change and details as highlighted JSON. Every value is text; links are
 * built from validated ids only (docs/adr/0014). The page (EventDetailPage)
 * shows it with the events of the same request; the drawer of a table
 * (EventDrawer), one level down and with a link to the page instead.
 */
export function EventView({
  event,
  variant,
  headingId,
}: {
  event: EventDetail;
  variant: 'page' | 'drawer';
  headingId?: string;
}) {
  const title: Level = variant === 'page' ? 1 : 3;
  const section: Level = variant === 'page' ? 2 : 4;
  const actor = actorPath(event.appId, event.actor.id);
  const resource =
    event.resource === null
      ? null
      : resourcePath(event.appId, event.resource.type, event.resource.id);
  const personal = event.personal;
  const page = eventPath(event.id);
  // A phone app reports its own system and device, more exactly than any
  // user agent, and it is no browser.
  const native = event.clientType === 'ios' || event.clientType === 'android';
  const deviceName = event.client.deviceModel ?? personal?.agent?.device ?? null;
  const deviceClass = event.network.deviceClass;
  return (
    <>
      <Heading level={title} id={headingId}>
        {event.description ?? event.action}
      </Heading>
      {event.description !== null && <p className="mono muted">{event.action}</p>}
      <p className="actions">
        <Badge kind="outcome" value={event.outcome} />
        <RiskBadge severity={event.severity} score={event.riskScore} />
        <span>{event.appSlug}</span>
        <span className="muted">{formatWhen(event.occurredAt)}</span>
      </p>
      {event.blockedSince !== null && (
        <Alert tone="info">
          The user of this event is blocked since {formatDateTime(event.blockedSince)}, after an
          erasure: it is kept for the log, pseudonymous, and must not be used for that person.
        </Alert>
      )}
      <div className="cards">
        <Section title="Actor" level={section}>
          <Facts
            rows={[
              ['Name', text(event.actor.label)],
              // Masked by the application before it left: Audit Hub never has the number.
              ['Phone', mono(personal?.actorPhone)],
              [
                'Email',
                event.actorDetail.emailPseudonym === null ? null : (
                  <>
                    <span className="muted">Pseudonym only: Audit Hub never keeps addresses.</span>{' '}
                    {mono(event.actorDetail.emailPseudonym)}
                  </>
                ),
              ],
              [
                'Id',
                event.actor.id === null ? null : actor === null ? (
                  mono(event.actor.id)
                ) : (
                  <Link className="mono" to={actor}>
                    {event.actor.id}
                  </Link>
                ),
              ],
              ['Role', text(event.actor.role)],
              ['Type', event.actor.type],
              ['Acting for', mono(event.actorDetail.impersonatorId)],
              ['Session', mono(event.actorDetail.sessionRef)],
            ]}
          />
        </Section>
        <Section title="Network and location" level={section}>
          {personal === null && (
            <p className="muted">
              Its address, user agent and place are not kept any more: their retention period ended,
              or they were erased.
            </p>
          )}
          <Facts
            rows={[
              ['IP address', mono(personal?.ip)],
              ['Country', text(event.country)],
              ['Place', joined(personal?.city ?? null, personal?.subdivision ?? null)],
              [
                'Coordinates',
                event.location === null ? (
                  personal?.approximateLocation == null ? null : (
                    <>
                      {`≈ ${String(personal.approximateLocation.latitude)}, ${String(personal.approximateLocation.longitude)}`}
                      <span className="muted">
                        {personal.approximateLocation.accuracyKm === null
                          ? ' (from the IP address)'
                          : ` (± ${formatNumber(personal.approximateLocation.accuracyKm)} km, from the IP address)`}
                      </span>
                    </>
                  )
                ) : (
                  <>
                    {`${String(event.location.latitude)}, ${String(event.location.longitude)}`}
                    <span className="muted">
                      {` (± ${formatNumber(event.location.accuracyM)} m, ${event.location.accuracyM < PRECISE_BELOW_M ? 'precise' : 'approximate'}, from the device, with consent, ${formatDateTime(event.location.capturedAt)})`}
                    </span>
                  </>
                ),
              ],
              ['Address scope', text(event.ipScope)],
              ['ASN', text(event.network.asn)],
              ['User agent', mono(personal?.userAgent)],
              [
                'Device',
                deviceName !== null && deviceClass !== null
                  ? `${deviceName} (${deviceClass})`
                  : text(deviceName ?? deviceClass),
              ],
              ['Device id', mono(personal?.deviceId)],
              [
                'Operating system',
                event.client.os === null
                  ? text(personal?.agent?.os ?? event.network.os)
                  : joined(event.client.os, event.client.osVersion),
              ],
              ['Browser', native ? null : text(personal?.agent?.browser ?? event.network.browser)],
            ]}
          />
        </Section>
        <Section title="Request" level={section}>
          <Facts
            rows={[
              ['Route', mono(event.request.route)],
              ['Method', text(event.request.method)],
              ['Status', text(event.httpStatus)],
              [
                'Duration',
                event.request.durationMs === null
                  ? null
                  : `${formatNumber(event.request.durationMs)} ms`,
              ],
              ['Request id', mono(event.requestId)],
              ['Trace id', mono(event.request.traceId)],
            ]}
          />
        </Section>
        <Section title="Client" level={section}>
          <Facts
            rows={[
              ['Type', text(event.clientType)],
              ['App version', joined(event.client.appVersion, event.client.appBuild)],
              ['Screen', mono(event.client.route)],
              ['Locale', text(event.client.locale)],
              ['Time zone', text(event.client.timeZone)],
              ['Network', text(event.client.networkType)],
              ['SDK', text(event.client.sdk)],
              [
                'Declared by the client',
                event.client.declared.length === 0 ? null : event.client.declared.join(', '),
              ],
            ]}
          />
        </Section>
        <Section title="Audit and integrity" level={section}>
          <Facts
            rows={[
              ['Risk', `${String(event.riskScore)} / 100`],
              ['Severity', words(event.severity)],
              ['Category', words(event.category)],
              ['Outcome', words(event.outcome)],
              ['Reason', text(event.reason)],
              ['Occurred', formatDateTime(event.occurredAt)],
              ['Recorded', formatDateTime(event.recordedAt)],
              [
                'Sequence',
                event.sequence === null ? null : `${event.sequence.epoch} / ${event.sequence.seq}`,
              ],
              ['Event id', mono(event.eventId)],
              [
                'Sealed',
                event.integrity.sealed
                  ? `yes, seal ${event.integrity.sealNo ?? ''}`
                  : 'not yet (within a minute)',
              ],
              ['Last verified', formatDateTime(event.integrity.verifiedAt)],
              ['Content hash', mono(event.integrity.contentHash)],
              ['Seal hash', mono(event.integrity.seal?.hash)],
              ['Signature', mono(event.integrity.seal?.signature)],
              ['Signing key', mono(event.integrity.seal?.keyId)],
            ]}
          />
        </Section>
        <Section title="Resource" level={section}>
          <Facts
            rows={[
              [
                'Resource',
                event.resource === null ? null : resource === null ? (
                  mono(`${event.resource.type} ${event.resource.id}`)
                ) : (
                  <Link className="mono" to={resource}>
                    {`${event.resource.type} ${event.resource.id}`}
                  </Link>
                ),
              ],
              ['Name', text(personal?.resourceLabel)],
              [
                'Inside',
                event.parentResource === null
                  ? null
                  : mono(`${event.parentResource.type} ${event.parentResource.id}`),
              ],
            ]}
          />
        </Section>
      </div>
      {(event.change.fields.length > 0 ||
        event.change.before !== null ||
        event.change.after !== null) && (
        <Section title="Change" level={section}>
          {event.change.fields.length > 0 && (
            <p>
              Fields: <span className="mono">{event.change.fields.join(', ')}</span>
            </p>
          )}
          <div className="cards">
            <div className="stack">
              <Heading level={(section + 1) as Level}>Before</Heading>
              <JsonView value={event.change.before} />
            </div>
            <div className="stack">
              <Heading level={(section + 1) as Level}>After</Heading>
              <JsonView value={event.change.after} />
            </div>
          </div>
          {personal !== null && personal.change !== null && (
            <div className="stack">
              <Heading level={(section + 1) as Level}>Personal values (kept 90 days)</Heading>
              <JsonView value={personal.change} />
            </div>
          )}
        </Section>
      )}
      {event.details !== null && (
        <Section title="Details" level={section}>
          <JsonView value={event.details} />
        </Section>
      )}
      {event.catalog.tags.length > 0 && (
        <p className="muted">Tags: {event.catalog.tags.join(', ')}</p>
      )}
      {event.quality.truncatedFields.length +
        event.quality.droppedFields.length +
        event.quality.flags.length >
        0 && (
        <p className="muted">
          {[
            event.quality.truncatedFields.length > 0
              ? `Truncated: ${event.quality.truncatedFields.join(', ')}`
              : null,
            event.quality.droppedFields.length > 0
              ? `Dropped: ${event.quality.droppedFields.join(', ')}`
              : null,
            event.quality.flags.length > 0 ? `Flags: ${event.quality.flags.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {variant === 'page' ? (
        <section className="stack" aria-labelledby="related-heading">
          <h2 id="related-heading">Same request</h2>
          <EventTable
            events={event.related}
            showApp={false}
            caption="Events with the same request id"
          />
        </section>
      ) : (
        event.related.length > 0 &&
        page !== null && (
          <p>
            {event.related.length === 1
              ? 'One more event has the same request id: '
              : `${formatNumber(event.related.length)} more events have the same request id: `}
            <Link to={page}>open the event as a page</Link> to see them.
          </p>
        )
      )}
    </>
  );
}
