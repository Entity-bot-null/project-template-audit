import { describe, expect, it } from 'vitest';
import {
  asOptions,
  formatDateTime,
  formatDay,
  formatNumber,
  fromLocalInput,
  toLocalInput,
  words,
} from './format';

// The viewer's time zone decides some of these: the expectations are computed
// with the same formatter, so the specs pass wherever they run.
const DATE_TIME = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });
const DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

describe('formatDateTime', () => {
  it('writes an instant in the viewer’s time zone', () => {
    const iso = '2026-10-15T08:30:00.000Z';
    expect(formatDateTime(iso)).toBe(DATE_TIME.format(new Date(iso)));
    expect(formatDateTime(iso)).toContain('2026');
  });

  it('writes nothing as an em dash, and an invalid value as it came', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('formatDay', () => {
  it('shows a bare date as that day wherever the viewer is', () => {
    expect(formatDay('2026-10-15')).toBe('Oct 15, 2026');
    expect(formatDay('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('shows an instant as the viewer’s day', () => {
    const iso = '2026-10-15T23:30:00.000Z';
    expect(formatDay(iso)).toBe(DATE.format(new Date(iso)));
  });

  it('leaves an invalid value as it came', () => {
    expect(formatDay('soon')).toBe('soon');
    // Shaped like a date, not one.
    expect(formatDay('2026-13-45')).toBe('2026-13-45');
  });
});

describe('formatNumber and words', () => {
  it('groups thousands in English', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0.5)).toBe('0.5');
  });

  it('turns snake_case codes into words', () => {
    expect(words('false_positive')).toBe('false positive');
    expect(words('reauthentication_required_now')).toBe('reauthentication required now');
    expect(words('plain')).toBe('plain');
  });

  it('makes select options whose label is the value in words', () => {
    expect(asOptions(['false_positive', 'open'])).toEqual([
      ['false_positive', 'false positive'],
      ['open', 'open'],
    ]);
    expect(asOptions([])).toEqual([]);
  });
});

describe('datetime-local values', () => {
  it('writes an instant as the input’s value, in the viewer’s time zone', () => {
    const local = new Date(2026, 0, 5, 7, 8, 9);
    expect(toLocalInput(local.toISOString())).toBe('2026-01-05T07:08');
    expect(toLocalInput(new Date(2026, 11, 31, 23, 59).toISOString())).toBe('2026-12-31T23:59');
  });

  it('writes nothing for no instant or an invalid one', () => {
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('not a date')).toBe('');
  });

  it('reads the input’s value back as an instant', () => {
    expect(fromLocalInput('2026-01-05T07:08')).toBe(new Date(2026, 0, 5, 7, 8).toISOString());
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });

  it('round-trips a value to the minute', () => {
    for (const value of ['2026-01-05T07:08', '2026-07-15T00:00', '2026-12-31T23:59']) {
      const iso = fromLocalInput(value);
      expect(iso).not.toBeNull();
      expect(toLocalInput(iso)).toBe(value);
    }
  });
});
