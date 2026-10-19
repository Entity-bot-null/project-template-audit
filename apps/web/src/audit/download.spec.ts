import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_ERROR_MESSAGE } from '../api/errors';
import { resetForTests, setSession } from '../auth/session';
import { admin } from '../test/fixtures';
import { failure, stubFetch } from '../test/http';
import { downloadExport, saveBlob } from './download';

const EXPORT = 'GET /api/exports/events';
const APP = '0190b6a1-0000-7000-8000-00000000000a';

const csv = (headers: Record<string, string> = {}) =>
  new Response('recordedAt,action\n2026-10-15T08:30:00.000Z,invoice.updated\n', {
    status: 200,
    headers: { 'Content-Type': 'text/csv', ...headers },
  });

/** The object URL and the link's click: a download jsdom cannot do. */
function stubSaving() {
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:http://localhost/export-1');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const saved = () => {
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    return { href: link.href, download: link.download, attached: link.isConnected };
  };
  return { createObjectURL, revokeObjectURL, click, saved };
}

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: admin });
});
afterEach(() => {
  resetForTests();
});

describe('downloadExport', () => {
  it('streams the export with the access token and saves it under the name the API gives', async () => {
    const { calls } = stubFetch({
      [EXPORT]: () =>
        csv({
          'Content-Disposition': 'attachment; filename="audit-events-2026-10-15.csv"',
          'Audit-Export-Id': 'export-1',
        }),
    });
    const { createObjectURL, revokeObjectURL, click, saved } = stubSaving();

    await expect(downloadExport({ format: 'csv', appId: APP, severity: 'high' })).resolves.toEqual({
      ok: true,
      data: { id: 'export-1' },
    });

    const url = new URL(calls[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'csv',
      appId: APP,
      severity: 'high',
    });
    // The token rides in the header, never in the URL.
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer token-1');
    expect(url.search).not.toContain('token');

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    await expect(blob.text()).resolves.toContain('invoice.updated');
    expect(click).toHaveBeenCalledOnce();
    expect(saved()).toEqual({
      href: 'blob:http://localhost/export-1',
      download: 'audit-events-2026-10-15.csv',
      attached: false,
    });
    expect(document.querySelector('a')).toBeNull();
    await vi.waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/export-1');
    });
  });

  it('names the file by its format when the API gives no name, or an odd one', async () => {
    const answers = [
      () => csv(),
      () => csv({ 'Content-Disposition': 'attachment; filename="../../etc/passwd"' }),
      () => csv({ 'Content-Disposition': 'attachment; filename=unquoted.csv' }),
      () => csv({ 'Content-Disposition': `attachment; filename="${'a'.repeat(101)}"` }),
    ];
    let next = 0;
    stubFetch({ [EXPORT]: () => answers[next++]!() });
    const { saved, click, revokeObjectURL } = stubSaving();

    for (const format of ['jsonl', 'csv', 'csv', 'jsonl'] as const) {
      await expect(downloadExport({ format })).resolves.toEqual({ ok: true, data: { id: null } });
      expect(saved().download).toBe(`audit-events.${format}`);
      click.mockClear();
    }
    await vi.waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledTimes(answers.length);
    });
  });

  it('answers the API’s failure, its code included, and saves nothing', async () => {
    stubFetch({
      [EXPORT]: () =>
        failure(403, 'A recent step-up is required', {
          'Audit-Error': 'reauthentication_required',
        }),
    });
    const { createObjectURL, click } = stubSaving();

    await expect(downloadExport({ format: 'csv' })).resolves.toEqual({
      ok: false,
      failure: {
        status: 403,
        message: 'A recent step-up is required',
        code: 'reauthentication_required',
      },
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('fails a success without a body: nothing to save', async () => {
    stubFetch({ [EXPORT]: () => new Response(null, { status: 204 }) });
    const { click } = stubSaving();
    await expect(downloadExport({ format: 'csv' })).resolves.toEqual({
      ok: false,
      failure: { status: 204, message: 'HTTP 204' },
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('answers status 0 when the server cannot be reached', async () => {
    stubFetch({ [EXPORT]: () => Promise.reject(new TypeError('Failed to fetch')) });
    const { click } = stubSaving();
    await expect(downloadExport({ format: 'jsonl' })).resolves.toEqual({
      ok: false,
      failure: { status: 0, message: NETWORK_ERROR_MESSAGE },
    });
    expect(click).not.toHaveBeenCalled();
  });
});

describe('saveBlob', () => {
  it('saves any blob under the given name, then lets go of its URL', async () => {
    const { createObjectURL, revokeObjectURL, saved } = stubSaving();
    const blob = new Blob(['{"ok":true}\n'], { type: 'application/x-ndjson' });
    saveBlob(blob, 'digest.jsonl');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(saved()).toMatchObject({ download: 'digest.jsonl', attached: false });
    await vi.waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledOnce();
    });
  });
});
