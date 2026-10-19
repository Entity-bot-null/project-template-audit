import { type ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../types/request-user.js';
import { CurrentUser } from './current-user.decorator.js';

type Factory = (data: unknown, ctx: ExecutionContext) => RequestUser;

// What Nest runs for the parameter: the factory it stored on the handler.
class UsersController {
  me(user: RequestUser): RequestUser {
    return user;
  }
}
CurrentUser()(UsersController.prototype, 'me', 0);

function factory(): Factory {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, UsersController, 'me') as Record<
    string,
    { index: number; factory: Factory }
  >;
  const [entry] = Object.values(args);
  if (entry === undefined) throw new Error('@CurrentUser() stored no parameter');
  expect(entry.index).toBe(0);
  return entry.factory;
}

function contextWith(user: RequestUser | undefined): ExecutionContext {
  const req = { user } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getClass: () => UsersController,
    getHandler: () => UsersController.prototype.me,
  } as unknown as ExecutionContext;
}

describe('@CurrentUser()', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('hands the handler the caller its auth guard attached', () => {
    const user: RequestUser = { id: '0190b6a1-0000-7000-8000-000000000001', role: 'member' };
    expect(factory()(undefined, contextWith(user))).toBe(user);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('answers 401 and logs the wiring bug on a route without @Auth()', () => {
    expect(() => factory()(undefined, contextWith(undefined))).toThrow(
      new UnauthorizedException('Not authenticated'),
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'UsersController.me reads @CurrentUser() without @Auth()',
    );
  });
});
