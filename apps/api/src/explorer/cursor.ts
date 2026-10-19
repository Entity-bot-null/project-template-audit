import { BadRequestException } from '@nestjs/common';

// Cursor pagination over (recorded_at DESC, id DESC), the explorer's order:
// stable while events arrive, one index range scan per page, no OFFSET.
// Opaque to clients (base64url of the position), checked on the way back.

export interface Position {
  recordedAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(position: Position): string {
  return Buffer.from(`${position.recordedAt.toISOString()}|${position.id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Position | undefined {
  if (cursor === undefined) return undefined;
  const [at = '', id = ''] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const recordedAt = new Date(at);
  if (Number.isNaN(recordedAt.getTime()) || !UUID.test(id)) {
    throw new BadRequestException('cursor: not one this API gave');
  }
  return { recordedAt, id };
}

/** Prisma's where for "after this position" in (recorded_at DESC, id DESC). */
export function afterPosition(position: Position | undefined) {
  if (position === undefined) return {};
  return {
    OR: [
      { recordedAt: { lt: position.recordedAt } },
      { recordedAt: position.recordedAt, id: { lt: position.id } },
    ],
  };
}

/** A page from `limit + 1` rows: the extra one says there is a next page. */
export function pageOf<T extends Position>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
  };
}
