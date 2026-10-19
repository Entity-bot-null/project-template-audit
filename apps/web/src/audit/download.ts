import { api, type operations } from '../api/client';
import { type ApiResult, failureOf, NETWORK_ERROR_MESSAGE } from '../api/errors';

export type ExportQuery = operations['ExportsController_events']['parameters']['query'];

/**
 * Streams an export (GET /api/exports/events) with the in-memory access
 * token into a Blob, then saves it with an a[download]: no CSP change, no
 * token in a URL (docs/adr/0014). Answers the export's id, whose digest
 * GET /api/exports/:id keeps.
 */
export async function downloadExport(
  query: ExportQuery,
): Promise<ApiResult<{ id: string | null }>> {
  let outcome;
  try {
    outcome = await api.GET('/api/exports/events', { params: { query }, parseAs: 'blob' });
  } catch {
    return { ok: false, failure: { status: 0, message: NETWORK_ERROR_MESSAGE } };
  }
  const { data, error, response } = outcome;
  if (!response.ok || data === undefined) {
    return { ok: false, failure: failureOf(response, error) };
  }
  const named = /filename="([A-Za-z0-9._-]{1,100})"/.exec(
    response.headers.get('Content-Disposition') ?? '',
  )?.[1];
  saveBlob(data, named ?? `audit-events.${query.format}`);
  return { ok: true, data: { id: response.headers.get('Audit-Export-Id') } };
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
