import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { EventView } from '../../audit/EventView';
import { isUuid } from '../../audit/links';
import { LoadView } from '../../audit/LoadView';
import { useLoader } from '../../hooks/useLoader';

// One event as a page of its own (a link to share, the browser's history),
// with the events of the same request: the same view a table's drawer shows
// (audit/EventView.tsx).
export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { state, retry } = useLoader(
    () =>
      isUuid(eventId)
        ? call(api.GET('/api/events/{id}', { params: { path: { id: eventId } } }))
        : Promise.resolve({
            ok: false as const,
            failure: { status: 404, message: 'Not an event id' },
          }),
    eventId,
  );
  return (
    <section className="stack" aria-labelledby="event-heading">
      <p>
        <Link to="/events">← Events</Link>
      </p>
      <LoadView state={state} retry={retry} label="the event">
        {(event) => <EventView event={event} variant="page" headingId="event-heading" />}
      </LoadView>
    </section>
  );
}
