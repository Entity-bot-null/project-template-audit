import { describe, expect, it } from 'vitest';
import {
  coarseAccuracy,
  locationAccuracy,
  locationDecimals,
  maskEmail,
  maskName,
  maskPhone,
  normalizeEmail,
  roundCoordinate,
} from './masking.js';
import { PHONE_LABEL_PATTERN } from './patterns.js';

describe('masking', () => {
  it('normalizes emails as the template does', () => {
    expect(normalizeEmail('  John.Doe@Example.COM ')).toBe('john.doe@example.com');
  });

  it('masks an email to its initials and top-level domain', () => {
    expect(maskEmail('John.Doe@Example.com')).toBe('j***@e***.com');
    expect(maskEmail('a@localhost')).toBe('a***@l***');
    expect(maskEmail('no-at-sign')).toBe('n***');
    expect(maskEmail('@example.com')).toBe('@***');
  });

  it('masks a name to the initials of its words', () => {
    expect(maskName('  Ana  María López ')).toBe('A*** M*** L***');
    expect(maskName('Ñandú')).toBe('Ñ***');
    expect(maskName('   ')).toBe('');
  });

  it('rounds coordinates to two decimals and never claims better than 1 km', () => {
    expect(roundCoordinate(19.432_608)).toBe(19.43);
    expect(roundCoordinate(-99.133_209)).toBe(-99.13);
    expect(coarseAccuracy(12)).toBe(1000);
    expect(coarseAccuracy(2500.4)).toBe(2500);
    expect(coarseAccuracy(10_000_000)).toBe(100_000);
    expect(coarseAccuracy(null)).toBe(1000);
  });

  it('keeps five decimals of a precise position, as reported but never under a metre', () => {
    expect(locationDecimals(4.6)).toBe(5);
    expect(locationDecimals(999)).toBe(5);
    expect(locationDecimals(1000)).toBe(2);
    expect(locationDecimals(null)).toBe(2);
    expect(locationDecimals(undefined)).toBe(2);
    expect(roundCoordinate(19.432_608_1, 5)).toBe(19.432_61);
    expect(roundCoordinate(-0.000_001, 5)).toBe(0);
    expect(Object.is(roundCoordinate(-0.000_001, 5), -0)).toBe(false);
    expect(locationAccuracy(4.6)).toBe(5);
    expect(locationAccuracy(0.2)).toBe(1);
    expect(locationAccuracy(12_000)).toBe(12_000);
    expect(locationAccuracy(null)).toBe(1000);
  });

  it('masks a phone to its last four digits, whatever its format', () => {
    for (const phone of ['+52 81 1234 5678', '(81) 1234-5678', '8112345678', '+1-415-555-5678']) {
      const masked = maskPhone(phone);
      expect(masked).toBe('•••• 5678');
      expect(masked).toMatch(PHONE_LABEL_PATTERN);
    }
    expect(maskPhone('123')).toBeUndefined();
    expect(maskPhone('no digits')).toBeUndefined();
  });
});
