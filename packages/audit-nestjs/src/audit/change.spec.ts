import { describe, expect, it } from 'vitest';
import { TEST_ACTIONS } from './audit.testing.js';
import { changeOf, type RecordState, toJson } from './change.js';
import { ChangeSchema, REDACTED } from './contract/index.js';

// shop.order.placed (TEST_ACTIONS) declares status, cardNumber (sensitive)
// and note (personal) as its change fields.
const order = (before: RecordState, after: RecordState) =>
  changeOf('shop.order.placed', before, after, TEST_ACTIONS);

describe('changeOf', () => {
  it('keeps the declared fields before and after, and names those that changed', () => {
    const change = order(
      { status: 'draft', note: 'leave at the door', total: 10 },
      { status: 'placed', note: 'leave at the door', total: 12 },
    );
    expect(change).toEqual({
      before: { status: 'draft', note: 'leave at the door' },
      after: { status: 'placed', note: 'leave at the door' },
      changedFields: ['status'],
    });
    expect(ChangeSchema.safeParse(change).success).toBe(true);
  });

  it('redacts a sensitive field whatever its value, and still sees it change', () => {
    const change = order({ cardNumber: '4111111111111111' }, { cardNumber: '5500000000000004' });
    expect(change).toEqual({
      before: { cardNumber: REDACTED },
      after: { cardNumber: REDACTED },
      changedFields: ['cardNumber'],
    });
  });

  it('has no before for a created record, and no after for a deleted one', () => {
    expect(order(null, { status: 'draft' })).toEqual({
      after: { status: 'draft' },
      changedFields: ['status'],
    });
    expect(order(undefined, { status: 'draft' })).toEqual({
      after: { status: 'draft' },
      changedFields: ['status'],
    });
    expect(order({ status: 'placed' }, null)).toEqual({
      before: { status: 'placed' },
      changedFields: ['status'],
    });
    expect(order({ status: 'placed' }, undefined)).toEqual({
      before: { status: 'placed' },
      changedFields: ['status'],
    });
    expect(order(null, undefined)).toEqual({});
  });

  it('lists no changed field when nothing changed', () => {
    expect(order({ status: 'placed' }, { status: 'placed' })).toEqual({
      before: { status: 'placed' },
      after: { status: 'placed' },
    });
  });

  it('drops undeclared fields, inherited ones and values without a JSON form', () => {
    expect(order({ password: 'old' }, { password: 'new', note: () => 'x' })).toEqual({
      before: {},
      after: {},
    });
    const inherited = Object.create({ status: 'draft' }) as Record<string, unknown>;
    expect(order(inherited, inherited)).toEqual({ before: {}, after: {} });
    // Compared as sent: an inherited value counts as absent on its side.
    expect(order(inherited, { status: 'draft' })).toEqual({
      before: {},
      after: { status: 'draft' },
      changedFields: ['status'],
    });
  });

  it('compares values by their JSON form', () => {
    const at = new Date('2026-10-15T12:00:00.000Z');
    expect(
      order({ status: 'placed', note: null }, { status: 'placed', note: undefined }).changedFields,
    ).toBeUndefined();
    expect(order({ note: at }, { note: new Date(at.getTime()) }).changedFields).toBeUndefined();
    expect(order({ note: 'a' }, { note: null }).changedFields).toEqual(['note']);
  });

  it("reads the project's catalog by default", () => {
    const before = { emailHmac: 'a'.repeat(64), email: 'ana@example.com' };
    const after = { emailHmac: 'b'.repeat(64), email: 'ana@example.org' };
    expect(changeOf('account.email.changed', before, after)).toEqual({
      before: { emailHmac: 'a'.repeat(64) },
      after: { emailHmac: 'b'.repeat(64) },
      changedFields: ['emailHmac'],
    });
    expect(() => changeOf('account.email.changed', before, after, TEST_ACTIONS)).toThrow(TypeError);
  });

  it('refuses an action that declares no change, or that is not in the catalog', () => {
    expect(() => changeOf('auth.session.signed_in', {}, {})).toThrow(
      new TypeError('auth.session.signed_in declares no change fields in the catalog'),
    );
    expect(() => changeOf('shop.cart.viewed', {}, {}, TEST_ACTIONS)).toThrow(
      new TypeError('shop.cart.viewed declares no change fields in the catalog'),
    );
    expect(() => changeOf('test.unknown.action', {}, {})).toThrow(TypeError);
    expect(() => changeOf('toString', {}, {}, TEST_ACTIONS)).toThrow(TypeError);
  });
});

class Decimal {
  constructor(private readonly digits: string) {}
  toJSON(): string {
    return this.digits;
  }
}

class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

describe('toJson', () => {
  it('keeps JSON scalars, and turns non-finite numbers into null', () => {
    expect(toJson(undefined)).toBeUndefined();
    expect(toJson(null)).toBeNull();
    expect(toJson('text')).toBe('text');
    expect(toJson(false)).toBe(false);
    expect(toJson(42.5)).toBe(42.5);
    expect(toJson(Number.NaN)).toBeNull();
    expect(toJson(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toJson(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('writes big integers as text and dates as ISO strings', () => {
    expect(toJson(12_345_678_901_234_567_890n)).toBe('12345678901234567890');
    expect(toJson(new Date('2026-10-15T12:00:00.000Z'))).toBe('2026-10-15T12:00:00.000Z');
    expect(toJson(new Date('not a date'))).toBeNull();
  });

  it('converts arrays item by item, a missing item as null', () => {
    expect(toJson([1, 'a', undefined, () => 1, [2n]])).toEqual([1, 'a', null, null, ['2']]);
  });

  it('converts plain objects key by key, dropping what has no JSON form', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.at = new Date('2026-10-15T12:00:00.000Z');
    bare.count = 3n;
    expect(
      toJson({
        name: 'order',
        nested: { bare, skipped: undefined, call: () => 1, tag: Symbol('t') },
      }),
    ).toEqual({ name: 'order', nested: { bare: { at: '2026-10-15T12:00:00.000Z', count: '3' } } });
  });

  it('uses the JSON form of a value that has one, like a decimal', () => {
    expect(toJson(new Decimal('19.99'))).toBe('19.99');
    expect(toJson({ total: new Decimal('0.10') })).toEqual({ total: '0.10' });
  });

  it('drops other objects, functions and symbols', () => {
    expect(toJson(new Point(1, 2))).toBeUndefined();
    expect(toJson(new Map([['a', 1]]))).toBeUndefined();
    expect(toJson(Object.assign(new Point(1, 2), { toJSON: 'not a function' }))).toBeUndefined();
    expect(toJson({ toJSON: 'not a function', x: 1 })).toEqual({ toJSON: 'not a function', x: 1 });
    expect(toJson(() => 1)).toBeUndefined();
    expect(toJson(Symbol('s'))).toBeUndefined();
  });
});
