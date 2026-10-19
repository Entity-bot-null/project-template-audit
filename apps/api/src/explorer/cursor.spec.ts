import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { afterPosition, decodeCursor, encodeCursor, pageOf, type Position } from './cursor.js';

const AT = new Date('2026-10-15T12:00:00.000Z');
const ID = '0199e0b1-0000-7000-8000-0000000000e1';

const row = (n: number): Position & { n: number } => ({
  n,
  recordedAt: new Date(AT.getTime() - n * 1000),
  id: `0199e0b1-0000-7000-8000-${String(n).padStart(12, '0')}`,
});

const cursorOf = (text: string) => Buffer.from(text).toString('base64url');

describe('encodeCursor and decodeCursor', () => {
  it('round-trips a position through an opaque base64url text', () => {
    const cursor = encodeCursor({ recordedAt: AT, id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(ID);
    expect(decodeCursor(cursor)).toEqual({ recordedAt: AT, id: ID });
  });

  it('reads no cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it('refuses a cursor this API did not give (400)', () => {
    for (const cursor of [
      'bogus',
      '',
      cursorOf(`not-a-date|${ID}`),
      cursorOf(`${AT.toISOString()}|not-a-uuid`),
      cursorOf(AT.toISOString()),
      cursorOf(`${AT.toISOString()}|${ID.toUpperCase()}`),
    ]) {
      expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
    }
    expect(() => decodeCursor('bogus')).toThrow('cursor: not one this API gave');
  });
});

describe('afterPosition', () => {
  it('adds nothing on the first page', () => {
    expect(afterPosition(undefined)).toEqual({});
  });

  it('continues after the position in (recorded_at DESC, id DESC)', () => {
    expect(afterPosition({ recordedAt: AT, id: ID })).toEqual({
      OR: [{ recordedAt: { lt: AT } }, { recordedAt: AT, id: { lt: ID } }],
    });
  });
});

describe('pageOf', () => {
  it('keeps limit rows and points the next page after the last one it keeps', () => {
    const rows = [row(1), row(2), row(3)];
    const page = pageOf(rows, 2);
    expect(page.items).toEqual([row(1), row(2)]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({
      recordedAt: row(2).recordedAt,
      id: row(2).id,
    });
  });

  it('says there is no next page when the extra row is missing', () => {
    expect(pageOf([row(1), row(2)], 2)).toEqual({ items: [row(1), row(2)], nextCursor: null });
    expect(pageOf([], 2)).toEqual({ items: [], nextCursor: null });
  });

  it('gives no cursor when the page keeps no row at all', () => {
    expect(pageOf([row(1)], 0)).toEqual({ items: [], nextCursor: null });
  });
});
