import { describe, expect, it } from 'vitest';
import type { Alert } from '../types';
import {
  DEFAULT_PREFERENCES,
  NEWS_WINDOW_MS,
  newsOf,
  type NotificationPreferences,
  quietFor,
  reactionTo,
  repeatsFor,
} from './policy';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

const alert = (overrides: Partial<Alert> = {}): Alert => ({
  id: '0190b6a1-0000-7000-8000-0000000000b1',
  appId: '0190b6a1-0000-7000-8000-0000000000a1',
  appSlug: 'shop',
  rule: 'brute_force',
  severity: 'high',
  status: 'open',
  subject: 'user-42',
  subjectLabel: 'Ann Example',
  title: 'Many failed sign-ins',
  occurrences: 1,
  firstSeenAt: ago(5_000),
  lastSeenAt: ago(5_000),
  assigneeId: null,
  resolvedAt: null,
  resolvedById: null,
  acknowledgedAt: null,
  acknowledgedById: null,
  escalations: 0,
  lastEscalatedAt: null,
  createdAt: ago(5_000),
  mutedUntil: null,
  updatedAt: ago(5_000),
  version: 1,
  ...overrides,
});

const prefs = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  ...DEFAULT_PREFERENCES,
  ...overrides,
});

describe('newsOf', () => {
  it('is news when an alert just opened', () => {
    expect(newsOf(alert(), undefined, false, NOW)).toBe('opened');
  });

  it('is never news when replayed after a reconnection', () => {
    expect(newsOf(alert(), undefined, true, NOW)).toBeNull();
  });

  it('is not news for an older alert seen for the first time, nor one seen again', () => {
    expect(newsOf(alert({ createdAt: ago(NEWS_WINDOW_MS + 1) }), undefined, false, NOW)).toBeNull();
    expect(newsOf(alert({ occurrences: 7 }), undefined, false, NOW)).toBeNull();
    expect(
      newsOf(alert({ occurrences: 7 }), { severity: 'high', escalations: 0 }, false, NOW),
    ).toBeNull();
  });

  it('is news when its severity rose, or when it was escalated again', () => {
    const known = { severity: 'medium' as const, escalations: 0 };
    expect(newsOf(alert({ severity: 'high' }), known, false, NOW)).toBe('raised');
    expect(newsOf(alert({ severity: 'medium', escalations: 1 }), known, false, NOW)).toBe(
      'escalated',
    );
    expect(
      newsOf(
        alert({ occurrences: 9, escalations: 1, lastEscalatedAt: ago(1_000) }),
        undefined,
        false,
        NOW,
      ),
    ).toBe('escalated');
  });

  it('is never news once acknowledged, in review or closed', () => {
    expect(newsOf(alert({ acknowledgedAt: ago(1_000) }), undefined, false, NOW)).toBeNull();
    expect(newsOf(alert({ status: 'in_review' }), undefined, false, NOW)).toBeNull();
    expect(newsOf(alert({ status: 'resolved' }), undefined, false, NOW)).toBeNull();
  });
});

describe('quietFor', () => {
  it('keeps quiet an alert a silence covers, during a quiet time, or of a muted application', () => {
    expect(quietFor(alert(), prefs(), NOW)).toBe(false);
    expect(quietFor(alert({ mutedUntil: ahead(60_000) }), prefs(), NOW)).toBe(true);
    expect(quietFor(alert({ mutedUntil: ago(1) }), prefs(), NOW)).toBe(false);
    expect(quietFor(alert(), prefs({ quietUntil: ahead(60_000) }), NOW)).toBe(true);
    expect(quietFor(alert(), prefs({ quietUntil: ago(1) }), NOW)).toBe(false);
    expect(quietFor(alert(), prefs({ mutedAppIds: [alert().appId] }), NOW)).toBe(true);
  });
});

describe('reactionTo', () => {
  it('sounds and notifies only as the person chose, by severity', () => {
    const chosen = prefs({
      sound: { enabled: true, volume: 50, severities: ['critical'] },
      browser: { enabled: true, severities: ['critical', 'high'] },
    });
    expect(reactionTo(alert({ severity: 'critical' }), chosen)).toEqual({
      sound: true,
      notice: true,
    });
    expect(reactionTo(alert({ severity: 'high' }), chosen)).toEqual({ sound: false, notice: true });
    expect(reactionTo(alert({ severity: 'low' }), chosen)).toEqual({ sound: false, notice: false });
    expect(
      reactionTo(
        alert({ severity: 'critical' }),
        prefs({
          sound: { ...chosen.sound, enabled: false },
          browser: { ...chosen.browser, enabled: false },
        }),
      ),
    ).toEqual({ sound: false, notice: false });
  });
});

describe('repeatsFor', () => {
  it("repeats a critical alert's sound as chosen; nothing else repeats", () => {
    expect(repeatsFor(alert({ severity: 'critical' }), prefs())).toEqual({
      everyMs: 60_000,
      times: 3,
    });
    expect(repeatsFor(alert({ severity: 'high' }), prefs())).toBeNull();
    expect(
      repeatsFor(
        alert({ severity: 'critical' }),
        prefs({ criticalRepeat: { enabled: false, intervalSeconds: 60, times: 3 } }),
      ),
    ).toBeNull();
  });
});
