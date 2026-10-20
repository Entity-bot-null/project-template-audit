import type { operations } from '../../api/client';
import type { Alert } from '../types';
import type { Severity } from './sound';

// What a change of an alert means to the person watching (pure): news to
// sound and notify, or a change to show only. News is an open alert just
// opened, one whose severity rose, or one escalated again (still
// unacknowledged); its silence, the person's quiet time and the applications
// they muted keep it quiet. Replays (changes missed while away), updates,
// notes and closings are never news: the lists show them.

export type NotificationPreferences =
  operations['NotificationPreferencesController_get']['responses'][200]['content']['application/json']['data'];

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  sound: { enabled: true, volume: 60, severities: ['critical', 'high'] },
  browser: { enabled: false, severities: ['critical', 'high'] },
  criticalRepeat: { enabled: true, intervalSeconds: 60, times: 3 },
  quietUntil: null,
  mutedAppIds: [],
};

/** How long after it happened a change is still news. */
export const NEWS_WINDOW_MS = 2 * 60_000;

export type News = 'opened' | 'raised' | 'escalated';

/** What this browser last knew of an alert. */
export interface Known {
  severity: Severity;
  escalations: number;
}

const RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

const recent = (iso: string | null, now: number) =>
  iso !== null && now - Date.parse(iso) <= NEWS_WINDOW_MS;

export function newsOf(
  alert: Alert,
  known: Known | undefined,
  replay: boolean,
  now: number,
): News | null {
  if (replay || alert.status !== 'open' || alert.acknowledgedAt !== null) return null;
  if (known === undefined) {
    if (alert.occurrences === 1 && recent(alert.createdAt, now)) return 'opened';
    return alert.escalations > 0 && recent(alert.lastEscalatedAt, now) ? 'escalated' : null;
  }
  if (RANK[alert.severity] > RANK[known.severity]) return 'raised';
  return alert.escalations > known.escalations ? 'escalated' : null;
}

/** Whether the person hears or sees news of `alert` now (its silence, their quiet time, their muted applications). */
export function quietFor(alert: Alert, preferences: NotificationPreferences, now: number): boolean {
  if (alert.mutedUntil !== null && Date.parse(alert.mutedUntil) > now) return true;
  if (preferences.quietUntil !== null && Date.parse(preferences.quietUntil) > now) return true;
  return preferences.mutedAppIds.includes(alert.appId);
}

/** What to do with news: a sound (by severity) and a browser notice, as the person chose. */
export function reactionTo(
  alert: Alert,
  preferences: NotificationPreferences,
): { sound: boolean; notice: boolean } {
  return {
    sound: preferences.sound.enabled && preferences.sound.severities.includes(alert.severity),
    notice: preferences.browser.enabled && preferences.browser.severities.includes(alert.severity),
  };
}

/** A critical alert's sound again while unacknowledged: the person's interval and times, or never. */
export function repeatsFor(
  alert: Alert,
  preferences: NotificationPreferences,
): { everyMs: number; times: number } | null {
  if (alert.severity !== 'critical' || !preferences.criticalRepeat.enabled) return null;
  return {
    everyMs: preferences.criticalRepeat.intervalSeconds * 1000,
    times: preferences.criticalRepeat.times,
  };
}
