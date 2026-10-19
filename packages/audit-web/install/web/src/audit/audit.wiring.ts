import { api } from '../api/client';
import { call } from '../api/errors';
import { getState } from '../auth/session';
import { type SendOutcome, startAuditReporter } from './reporter';

// The web app's side of Audit Hub, wired once (Audit Hub's
// docs/audit/connection-guide.md#the-web-app): a lazy chunk src/main.tsx
// loads after the first render, only when the API's capabilities say its
// connector takes the browser's events (auditClientEvents). Created once by
// `pnpm connector add --kind spa`; the project's own code from then on.

/** What a failed batch means: no answer, a session renewing, busy or failing (later); else refused. */
export function outcomeOf(status: number): SendOutcome {
  return status === 0 || status === 401 || status === 429 || status >= 500 ? 'later' : 'refused';
}

/** Starts the reporter over the app's api client and session; answers the stop. */
export function startAudit(): () => void {
  return startAuditReporter({
    send: async (batch, keepalive) => {
      const result = await call(api.POST('/api/audit/client-events', { body: batch, keepalive }));
      return result.ok ? 'sent' : outcomeOf(result.failure.status);
    },
    currentUser: () => {
      const state = getState();
      return state.status === 'authenticated' ? state.user.id : null;
    },
  });
}
