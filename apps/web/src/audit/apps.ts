import { api } from '../api/client';
import { type ApiResult, call } from '../api/errors';
import { useAuth } from '../auth';
import { useLoader } from '../hooks/useLoader';
import type { VisibleApps } from './types';

// The applications the signed-in person may see (GET /api/account/apps), for
// the pickers and links of every page: asked once per person and page load,
// again after a change (forgetVisibleApps).
let cached: { userId: string; result: Promise<ApiResult<VisibleApps>> } | null = null;

function visibleApps(userId: string): Promise<ApiResult<VisibleApps>> {
  if (cached?.userId !== userId) {
    const result = call(api.GET('/api/account/apps'));
    cached = { userId, result };
    // A failure is not kept: the next page asks again.
    void result.then((outcome) => {
      if (!outcome.ok && cached?.result === result) cached = null;
    });
  }
  return cached.result;
}

/** After an application was registered or renamed. */
export function forgetVisibleApps(): void {
  cached = null;
}

export function useVisibleApps() {
  const auth = useAuth();
  const userId = auth.status === 'authenticated' ? auth.user.id : '';
  return useLoader(() => visibleApps(userId), userId);
}
