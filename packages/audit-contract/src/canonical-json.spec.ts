import { describe, expect, it } from 'vitest';
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalJsonBytes,
  jsonDepth,
  utf8Length,
} from './canonical-json.js';

describe('canonicalJson (RFC 8785)', () => {
  it('matches the example of RFC 8785 section 3.2.2', () => {
    const input: unknown = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals":[null,true,false]}',
    );
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units, as RFC 8785 section 3.2.3 shows', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      דּ: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      ö: 'Latin Small Letter O With Diaeresis',
    };
    // Read the order off the text: JSON.parse would move the integer-like key first.
    const text = canonicalJson(input);
    const positions = [
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ].map((name) => text.indexOf(name));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('gives the same text whatever the key order and nesting', () => {
    expect(canonicalJson({ b: [1, { d: 2, c: 3 }], a: null })).toBe(
      canonicalJson({ a: null, b: [1, { c: 3, d: 2 }] }),
    );
    expect(canonicalJson({ a: undefined, b: -0 })).toBe('{"b":0}');
    expect(canonicalJson(Object.create(null) as object)).toBe('{}');
  });

  it('refuses what JSON cannot carry exactly', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: Infinity })).toThrow('$.a: not a finite number');
    expect(() => canonicalJson('\ud800')).toThrow('lone surrogate');
    expect(() => canonicalJson({ ['\udc00']: 1 })).toThrow('key with a lone surrogate');
    expect(() => canonicalJson([1n])).toThrow('$[0]: bigint is not JSON');
    expect(() => canonicalJson(new Date(0))).toThrow('only plain objects');
    expect(() => canonicalJson(undefined)).toThrow('undefined is not JSON');
  });
});

describe('sizes', () => {
  it('counts UTF-8 bytes without TextEncoder', () => {
    // One byte for ASCII, two for ñ, three for €, four for an emoji.
    for (const [text, bytes] of [
      ['', 0],
      ['a', 1],
      ['ñ', 2],
      ['€', 3],
      ['😀', 4],
      ['añ€😀', 10],
    ] as const) {
      expect(utf8Length(text)).toBe(bytes);
    }
    expect(canonicalJsonBytes({ a: 'ñ' })).toBe(10);
  });

  it('measures nesting depth', () => {
    expect(jsonDepth('x')).toBe(0);
    expect(jsonDepth({ a: 1 })).toBe(1);
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3);
    expect(jsonDepth([])).toBe(1);
  });
});
