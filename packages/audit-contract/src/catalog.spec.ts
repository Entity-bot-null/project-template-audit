import { describe, expect, it } from 'vitest';
import {
  CatalogDocumentSchema,
  catalogVersionOf,
  compileFields,
  isEventId,
  markedPaths,
  MIN_RETENTION_DAYS,
  retentionDowngrades,
} from './catalog.js';
import { sha256Hex } from './node/crypto.js';
import { catalog, EVENT_ID } from './testing/fixtures.js';

describe('CatalogDocumentSchema', () => {
  it('accepts a catalog', () => {
    expect(CatalogDocumentSchema.parse(catalog())).toEqual(catalog());
  });

  it('refuses regex patterns, nesting and unknown field types', () => {
    const withPattern = catalog({
      actions: {
        'a.b.c': {
          category: 'audit',
          severity: 'low',
          description: 'x',
          source: 'server',
          details: { fields: { name: { type: 'string', pattern: '(a+)+$' } as never } },
        },
      },
    });
    expect(CatalogDocumentSchema.safeParse(withPattern).success).toBe(false);
    const nested = catalog({
      actions: {
        'a.b.c': {
          category: 'audit',
          severity: 'low',
          description: 'x',
          source: 'server',
          details: { fields: { inner: { type: 'object' } as never } },
        },
      },
    });
    expect(CatalogDocumentSchema.safeParse(nested).success).toBe(false);
  });

  it('bounds the number of actions and fields', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`f${String(index)}`, { type: 'boolean' as const }]),
    );
    const tooManyFields = catalog({
      actions: {
        'a.b.c': {
          category: 'audit',
          severity: 'low',
          description: 'x',
          source: 'server',
          details: { fields },
        },
      },
    });
    expect(CatalogDocumentSchema.safeParse(tooManyFields).success).toBe(false);
    const actions = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        `a.b.c${String(index)}`,
        {
          category: 'audit' as const,
          severity: 'low' as const,
          description: 'x',
          source: 'server' as const,
        },
      ]),
    );
    expect(CatalogDocumentSchema.safeParse(catalog({ actions })).success).toBe(false);
  });
});

describe('catalog versions', () => {
  it('is the same for the same document whatever the key order', () => {
    const version = catalogVersionOf(catalog(), sha256Hex);
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, item]) => [key, reverseKeys(item)]),
            )
          : value;
    expect(catalogVersionOf(reverseKeys(catalog()) as never, sha256Hex)).toBe(version);
    expect(
      catalogVersionOf(catalog({ app: { name: 'my-project', version: '1.4.3' } }), sha256Hex),
    ).not.toBe(version);
  });

  it('finds actions moved to a category with a shorter retention', () => {
    const before = catalog();
    const after = catalog({
      actions: {
        ...before.actions,
        'auth.session.signed_in': {
          ...before.actions['auth.session.signed_in']!,
          category: 'system',
        },
        'account.profile.updated': {
          ...before.actions['account.profile.updated']!,
          category: 'security',
        },
        'new.action.added': {
          category: 'system',
          severity: 'info',
          description: 'x',
          source: 'server',
        },
      },
    });
    expect(retentionDowngrades(before, after)).toEqual([
      { action: 'auth.session.signed_in', from: 'security', to: 'system' },
    ]);
    expect(MIN_RETENTION_DAYS.security).toBe(730);
  });
});

describe('compileFields', () => {
  const validator = compileFields({
    name: { type: 'string', maxLength: 5, required: true },
    count: { type: 'integer', min: 1, max: 3 },
    ratio: { type: 'number', min: 0, max: 1 },
    flag: { type: 'boolean' },
    kind: { type: 'enum', values: ['a', 'b'] },
    ref: { type: 'uuid' },
    at: { type: 'datetime' },
    owner: { type: 'id' },
    ip: { type: 'ip' },
    country: { type: 'country' },
    tags: { type: 'string[]', maxItems: 2, maxLength: 3 },
    secret: { type: 'string', sensitive: true },
    plain: { type: 'integer' },
    any: { type: 'number' },
    text: { type: 'string' },
    list: { type: 'string[]' },
  });

  it('accepts what the spec declares', () => {
    const value = {
      name: 'abc',
      count: 2,
      ratio: 0.5,
      flag: true,
      kind: 'a',
      ref: EVENT_ID,
      at: '2026-10-14T12:00:00Z',
      owner: 'user-1',
      ip: '192.0.2.1',
      country: 'MX',
      tags: ['x', 'yz'],
      secret: '[REDACTED]',
      plain: -4,
      any: 1e9,
      text: 'free',
      list: ['a'],
    };
    expect(validator.parse(value)).toEqual(value);
  });

  it('refuses everything else', () => {
    for (const bad of [
      {},
      { name: 'toolong' },
      { name: 'a', count: 4 },
      { name: 'a', ratio: 2 },
      { name: 'a', kind: 'c' },
      { name: 'a', country: 'mx' },
      { name: 'a', tags: ['a', 'b', 'c'] },
      { name: 'a', secret: 'clear text' },
      { name: 'a', undeclared: 1 },
    ]) {
      expect(validator.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('lists personal and sensitive paths', () => {
    const spec = catalog().actions['account.profile.updated']!;
    expect(markedPaths(spec, 'personal')).toEqual({ details: [], change: ['name'] });
    expect(markedPaths(spec, 'sensitive')).toEqual({ details: [], change: [] });
    expect(isEventId(EVENT_ID)).toBe(true);
    expect(isEventId(1)).toBe(false);
  });
});
