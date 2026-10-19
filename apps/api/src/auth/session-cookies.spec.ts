import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { REFRESH_COOKIE, SESSION_HINT_COOKIE } from './auth.constants.js';
import {
  clearSessionCookies,
  hasAmbiguousRefreshCookie,
  refreshTokenOf,
  respondWithSession,
} from './session-cookies.js';

const session = {
  accessToken: 'access',
  expiresIn: 900,
  user: { id: 'u1', email: 'a@example.test', name: 'A', role: 'member' as const },
};
const refresh = { token: 'refresh', expiresAt: new Date('2030-01-01T00:00:00Z') };

function response() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

// The raw Cookie header, and what cookie-parser made of it.
function request(header: string | undefined, cookies?: Record<string, unknown>): Request {
  return {
    get: (name: string) => (name === 'Cookie' ? header : undefined),
    cookies,
  } as unknown as Request;
}

describe('session cookies', () => {
  it('answers with the refresh token as its httpOnly cookie, the hint, and the access token in the body', () => {
    const res = response();
    const body = respondWithSession(res as unknown as Response, { session, refresh }, 'Signed in');
    expect(body).toEqual({ data: session, message: 'Signed in' });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      'refresh',
      expect.objectContaining({ httpOnly: true, expires: refresh.expiresAt }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_HINT_COOKIE,
      '1',
      expect.objectContaining({ httpOnly: false }),
    );
    expect(JSON.stringify(body)).not.toContain('refresh');
  });

  it('clears both cookies with the options they were set with', () => {
    const res = response();
    clearSessionCookies(res as unknown as Response);
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_HINT_COOKIE, expect.anything());
  });

  describe('the refresh cookie of a request', () => {
    it('is ambiguous only when the header names it more than once', () => {
      expect(hasAmbiguousRefreshCookie(request(undefined))).toBe(false);
      expect(hasAmbiguousRefreshCookie(request(''))).toBe(false);
      expect(hasAmbiguousRefreshCookie(request(`${REFRESH_COOKIE}=a; theme=dark`))).toBe(false);
      expect(
        hasAmbiguousRefreshCookie(request(`${REFRESH_COOKIE}=a; theme=dark; ${REFRESH_COOKIE}=b`)),
      ).toBe(true);
      // Whatever the spacing, and even with the same value twice.
      expect(hasAmbiguousRefreshCookie(request(`${REFRESH_COOKIE}=a;${REFRESH_COOKIE}=a`))).toBe(
        true,
      );
    });

    it('compares whole names, never a name inside another one or inside a value', () => {
      expect(hasAmbiguousRefreshCookie(request(`x${REFRESH_COOKIE}=a; ${REFRESH_COOKIE}=b`))).toBe(
        false,
      );
      expect(
        hasAmbiguousRefreshCookie(request(`theme=${REFRESH_COOKIE}=a; ${REFRESH_COOKIE}=b`)),
      ).toBe(false);
    });

    it('answers the token the parser kept', () => {
      const req = request(`${REFRESH_COOKIE}=token-1`, { [REFRESH_COOKIE]: 'token-1' });
      expect(refreshTokenOf(req)).toBe('token-1');
    });

    it('answers none when two cookies compete, whichever one the parser kept', () => {
      const req = request(`${REFRESH_COOKIE}=mine; ${REFRESH_COOKIE}=planted`, {
        [REFRESH_COOKIE]: 'planted',
      });
      expect(refreshTokenOf(req)).toBeUndefined();
    });

    it('answers none when absent, empty or not text', () => {
      expect(refreshTokenOf(request(undefined))).toBeUndefined();
      expect(refreshTokenOf(request(undefined, {}))).toBeUndefined();
      expect(
        refreshTokenOf(request(`${REFRESH_COOKIE}=`, { [REFRESH_COOKIE]: '' })),
      ).toBeUndefined();
      // cookie-parser turns a j:{...} value into an object.
      const json = request(`${REFRESH_COOKIE}=j:{}`, { [REFRESH_COOKIE]: { token: 'x' } });
      expect(refreshTokenOf(json)).toBeUndefined();
    });
  });
});
