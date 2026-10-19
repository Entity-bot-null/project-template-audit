import { describe, expect, it } from 'vitest';
import { Prisma } from './generated/client.js';
import { LOCK_NOT_AVAILABLE, rawQuerySqlState } from './postgres-errors.js';

const failure = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Raw query failed', {
    code,
    clientVersion: 'test',
    ...(meta === undefined ? {} : { meta }),
  });

describe('rawQuerySqlState', () => {
  it("answers the SQLSTATE of a raw query's failure, as the adapter reports it", () => {
    const timedOut = failure('P2010', {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          kind: 'postgres',
          code: '55P03',
          message: 'canceling statement due to lock timeout',
        },
      },
    });
    expect(rawQuerySqlState(timedOut)).toBe(LOCK_NOT_AVAILABLE);
  });

  it('answers undefined for anything else', () => {
    expect(rawQuerySqlState(new Error('55P03'))).toBeUndefined();
    expect(rawQuerySqlState(failure('P2002'))).toBeUndefined();
    expect(rawQuerySqlState(failure('P2010'))).toBeUndefined();
    expect(rawQuerySqlState(failure('P2010', { driverAdapterError: 'down' }))).toBeUndefined();
    expect(
      rawQuerySqlState(failure('P2010', { driverAdapterError: { cause: null } })),
    ).toBeUndefined();
    expect(
      rawQuerySqlState(
        failure('P2010', { driverAdapterError: { cause: { kind: 'UnsupportedNativeDataType' } } }),
      ),
    ).toBeUndefined();
    expect(
      rawQuerySqlState(failure('P2010', { driverAdapterError: { cause: { code: 55 } } })),
    ).toBeUndefined();
  });
});
