import { Prisma } from './generated/client.js';

/** lock_not_available: a lock wait ran past lock_timeout. */
export const LOCK_NOT_AVAILABLE = '55P03';

/**
 * The SQLSTATE a raw query ($queryRaw, $executeRaw) failed with: the Prisma
 * adapter reports such a failure as P2010, with the driver's error as the
 * cause of meta.driverAdapterError (Prisma 7, @prisma/adapter-pg; produced
 * against PostgreSQL in connected-apps.int.spec.ts). Undefined otherwise.
 */
export function rawQuerySqlState(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2010') {
    return undefined;
  }
  const adapter: unknown = error.meta?.driverAdapterError;
  if (typeof adapter !== 'object' || adapter === null || !('cause' in adapter)) return undefined;
  const { cause } = adapter;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  return typeof cause.code === 'string' ? cause.code : undefined;
}
