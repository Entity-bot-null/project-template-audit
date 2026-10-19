import { api } from '../api/client';
import { call } from '../api/errors';
import { useLoader } from '../hooks/useLoader';
import { Drawer } from './Drawer';
import { EventView } from './EventView';
import { eventPath } from './links';
import { LoadView } from './LoadView';

/**
 * An event's whole detail beside the table it was chosen from: the event is
 * asked for when the drawer opens (the table's rows carry only the summary:
 * the heavy parts, its JSON among them, load here).
 */
export function EventDrawer({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { state, retry } = useLoader(
    () => call(api.GET('/api/events/{id}', { params: { path: { id: eventId } } })),
    eventId,
  );
  return (
    <Drawer title="Event detail" page={eventPath(eventId)} onClose={onClose}>
      <LoadView state={state} retry={retry} label="the event">
        {(event) => <EventView event={event} variant="drawer" />}
      </LoadView>
    </Drawer>
  );
}
