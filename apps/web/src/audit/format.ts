// How the admin pages write times and numbers: English, the viewer's time
// zone, with the exact UTC instant on hover (the API answers ISO 8601 UTC).

const DATE_TIME = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });
const DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
/** A bare date is a UTC day (the API's buckets): the same day wherever the viewer is. */
const UTC_DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const NUMBER = new Intl.NumberFormat('en');

const WHEN = new Intl.DateTimeFormat('en', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** An instant at a glance, for a table's row: "19 Oct 2026, 09:55 AM", the viewer's time zone. */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    WHEN.formatToParts(at).find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
}

/** An ISO instant in the viewer's time zone; an empty value as an em dash. */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : DATE_TIME.format(at);
}

/** A calendar day (YYYY-MM-DD or an instant) as the viewer reads it. */
export function formatDay(day: string): string {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const at = new Date(bare ? `${day}T00:00:00Z` : day);
  if (Number.isNaN(at.getTime())) return day;
  return (bare ? UTC_DATE : DATE).format(at);
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** snake_case codes as words: "false_positive" → "false positive". */
export function words(code: string): string {
  return code.replaceAll('_', ' ');
}

const pad = (value: number) => String(value).padStart(2, '0');

/** An ISO instant as a datetime-local input's value, in the viewer's time zone. */
export function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A datetime-local input's value (the viewer's time zone) as an ISO instant. */
export function fromLocalInput(value: string): string | null {
  if (value === '') return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Select options where the label is the value in words. */
export const asOptions = (values: readonly string[]) =>
  values.map((value) => [value, words(value)] as const);
