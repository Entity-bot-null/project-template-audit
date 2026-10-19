import { api } from '../api/client';
import { call } from '../api/errors';
import { useLoader } from '../hooks/useLoader';
import { AlertView } from './AlertView';
import { Drawer } from './Drawer';
import { alertPath } from './links';
import { LoadView } from './LoadView';

/**
 * An alert's whole detail beside the list it was chosen from: why it fired,
 * what its events show, who it is about and its history, asked for when the
 * drawer opens. Working on it (status, notes, response actions) is on its
 * page.
 */
export function AlertDrawer({ alertId, onClose }: { alertId: string; onClose: () => void }) {
  const { state, retry } = useLoader(
    () => call(api.GET('/api/alerts/{id}', { params: { path: { id: alertId } } })),
    alertId,
  );
  return (
    <Drawer title="Alert detail" page={alertPath(alertId)} onClose={onClose}>
      <LoadView state={state} retry={retry} label="the alert">
        {(alert) => <AlertView alert={alert} variant="drawer" />}
      </LoadView>
    </Drawer>
  );
}
