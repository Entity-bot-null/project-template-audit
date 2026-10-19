import { describe, expect, it } from 'vitest';
import { sanitizeText } from './text.js';
import { isWellFormed, toWellFormed } from './unicode.js';

describe('sanitizeText', () => {
  it('keeps ordinary text, XSS payloads included, exactly as text', () => {
    for (const payload of [
      '<script>alert(1)</script>',
      '${alert(1)}',
      '" onmouseover="x',
      'ñandú',
    ]) {
      expect(sanitizeText(payload, 100)).toEqual({ value: payload, truncated: false });
    }
  });

  it('removes control characters but tab and line breaks', () => {
    expect(sanitizeText('a\u0000b\u0007c\u001bd\u007fe\u0085f\tg\nh\ri', 100).value).toBe(
      'abcdef\tg\nh\ri',
    );
  });

  it('normalizes to NFC and replaces lone surrogates', () => {
    expect(sanitizeText('é', 10).value).toBe('é');
    expect(sanitizeText('a\ud800b', 10).value).toBe('a�b');
  });

  it('cuts at the limit without splitting a surrogate pair, and says so', () => {
    expect(sanitizeText('abcdef', 4)).toEqual({ value: 'abcd', truncated: true });
    expect(sanitizeText('ab😀cd', 3)).toEqual({ value: 'ab', truncated: true });
    expect(sanitizeText('ab😀cd', 4)).toEqual({ value: 'ab😀', truncated: true });
  });
});

describe('well-formed strings', () => {
  it('finds lone surrogates and keeps pairs', () => {
    expect(isWellFormed('a😀b')).toBe(true);
    expect(isWellFormed('\ud800')).toBe(false);
    expect(isWellFormed('\udc00x')).toBe(false);
    expect(isWellFormed('x\ud83d')).toBe(false);
    expect(toWellFormed('a😀b')).toBe('a😀b');
    expect(toWellFormed('\ud800x\udc00y\ud83d')).toBe('�x�y�');
  });
});
