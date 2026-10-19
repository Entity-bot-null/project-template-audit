import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SIGNATURE_HEADERS } from 'audit-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../common/types/request-user.js';
import {
  REAUTHENTICATION_REQUIRED,
  RECENT_AUTH_MAX_AGE_SEC,
  RecentAuthGuard,
  RequireRecentAuth,
} from './recent-auth.js';

// Stand-ins for controllers: only their metadata matters.
class AccountController {
  open(): void {
    // route handler
  }

  @RequireRecentAuth()
  sensitive(): void {
    // route handler
  }

  @RequireRecentAuth(60)
  verySensitive(): void {
    // route handler
  }
}

const NOW_SEC = 1_760_000_000;

function contextFor(handler: keyof AccountController, user?: RequestUser) {
  const setHeader = vi.fn();
  const context = {
    getClass: () => AccountController,
    getHandler: () => AccountController.prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ user }), getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

const guard = new RecentAuthGuard(new Reflector());
const steppedUp = (secondsAgo: number): RequestUser => ({
  id: 'u1',
  role: 'admin',
  reauthAt: NOW_SEC - secondsAgo,
});

function expectRefused(handler: keyof AccountController, user?: RequestUser) {
  const { context, setHeader } = contextFor(handler, user);
  expect(() => guard.canActivate(context)).toThrow(
    new ForbiddenException('Confirm your password and a code first'),
  );
  // The web app turns this header into the step-up dialog.
  expect(setHeader).toHaveBeenCalledWith(SIGNATURE_HEADERS.error, REAUTHENTICATION_REQUIRED);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RecentAuthGuard', () => {
  it('lets a handler without @RequireRecentAuth() through, without looking at the caller', () => {
    const { context, setHeader } = contextFor('open');
    expect(guard.canActivate(context)).toBe(true);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('lets a step-up of the last five minutes through', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_SEC * 1000);
    for (const secondsAgo of [0, 1, RECENT_AUTH_MAX_AGE_SEC]) {
      const { context, setHeader } = contextFor('sensitive', steppedUp(secondsAgo));
      expect(guard.canActivate(context)).toBe(true);
      expect(setHeader).not.toHaveBeenCalled();
    }
  });

  it('answers 403 with Audit-Error: reauthentication_required without a step-up', () => {
    expect(REAUTHENTICATION_REQUIRED).toBe('reauthentication_required');
    expectRefused('sensitive', { id: 'u1', role: 'admin' });
    expectRefused('sensitive');
  });

  it('answers 403 for a step-up older than the handler allows', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_SEC * 1000);
    expectRefused('sensitive', steppedUp(RECENT_AUTH_MAX_AGE_SEC + 1));
    // A handler may ask for a shorter time.
    const { context } = contextFor('verySensitive', steppedUp(60));
    expect(guard.canActivate(context)).toBe(true);
    expectRefused('verySensitive', steppedUp(61));
  });

  it('allows a minute of clock skew into the future, no more', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_SEC * 1000);
    const { context } = contextFor('sensitive', steppedUp(-60));
    expect(guard.canActivate(context)).toBe(true);
    expectRefused('sensitive', steppedUp(-61));
  });
});
