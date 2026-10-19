import { vi } from 'vitest';
import type { AuthUser } from '../auth';
import { member } from './fixtures';

// HTTP mocks for the specs: global fetch replaced by a router keyed on
// "METHOD /path", answering with the API's { data, message } envelopes.
// Nothing leaves the process; an unexpected request fails the test.

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const ok = (data: unknown, message = 'Operation successful') => json(200, { data, message });

export const failure = (status: number, message: string, headers?: Record<string, string>) =>
  json(status, { data: null, message }, headers);

export const session = (accessToken: string, user: AuthUser = member) =>
  ok({ accessToken, expiresIn: 900, user });

type Handler = (request: Request) => Response | Promise<Response>;

export function stubFetch(handlers: Record<string, Handler>) {
  const calls: Request[] = [];
  const fetchMock = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(request);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** A promise the test resolves when it chooses: holds a response in flight. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

// The readable cookie the API sets next to the refresh cookie; boot only asks
// the server for a session when it is present.
export function setSessionHint(): void {
  document.cookie = 'has_session=1; path=/';
}

export function clearSessionHint(): void {
  document.cookie = 'has_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

/** The password step's answer: the second factor's challenge (docs/adr/0012). */
export const challenge = (mfa: 'verify' | 'enroll' = 'verify', challengeToken = 'c'.repeat(43)) =>
  ok({ mfa, challengeToken, expiresIn: 300 });

/** A new second factor's secret, with a tiny QR code. */
export const enrollment = () =>
  ok({
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- a public example key for the specs
    uri: 'otpauth://totp/Audit%20Hub:member%40example.com?secret=JBSWY3DPEHPK3PXP',
    qr: ['101', '010', '101'],
  });

export const RECOVERY_CODES = Array.from(
  { length: 10 },
  (_, index) => `${String(index).repeat(5)}-abcde`,
);

/** The session a confirmed second factor starts, with its recovery codes. */
export const enrolled = (accessToken: string, user: AuthUser = member) =>
  ok({ accessToken, expiresIn: 900, user, recoveryCodes: RECOVERY_CODES });
