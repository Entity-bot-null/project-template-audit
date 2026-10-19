import { describe, expect, it } from 'vitest';
import { isWellFormed, toWellFormed } from './unicode.js';

const HIGH = '\uD83D';
const LOW = '\uDE00';

describe('well-formed strings', () => {
  it('accepts text and surrogate pairs', () => {
    for (const text of [
      '',
      'plain',
      'añadir',
      `smile ${HIGH}${LOW}`,
      `${HIGH}${LOW}${HIGH}${LOW}`,
    ]) {
      expect(isWellFormed(text)).toBe(true);
      expect(toWellFormed(text)).toBe(text);
    }
  });

  it('finds a lone high or low surrogate anywhere', () => {
    expect(isWellFormed(HIGH)).toBe(false);
    expect(isWellFormed(LOW)).toBe(false);
    expect(isWellFormed(`a${HIGH}b`)).toBe(false);
    expect(isWellFormed(`${LOW}${HIGH}`)).toBe(false);
    expect(isWellFormed(`ok ${HIGH}${LOW} then ${HIGH}`)).toBe(false);
  });

  it('replaces each lone surrogate with U+FFFD and keeps the pairs', () => {
    expect(toWellFormed(HIGH)).toBe('�');
    expect(toWellFormed(`a${LOW}b${HIGH}`)).toBe('a�b�');
    expect(toWellFormed(`${HIGH}${HIGH}${LOW}`)).toBe(`�${HIGH}${LOW}`);
    expect(toWellFormed(`${LOW}${LOW}x`)).toBe('��x');
    expect(isWellFormed(toWellFormed(`${HIGH}x${LOW}`))).toBe(true);
  });
});
