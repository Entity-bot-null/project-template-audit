import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  NotificationPreferencesSchema,
  NotificationPreferencesService,
} from './notification-preferences.js';

const USER = '0199e0b1-0000-7000-8000-0000000000bb';
const NOW = Date.parse('2026-10-20T10:00:00.000Z');

function setup(stored: unknown = null) {
  const prisma = {
    notificationPreference: {
      findUnique: vi.fn(() => Promise.resolve(stored === null ? null : { preferences: stored })),
      upsert: vi.fn((_args: unknown) => Promise.resolve({})),
    },
  };
  return {
    prisma,
    service: new NotificationPreferencesService(prisma as unknown as PrismaService),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('notification preferences', () => {
  it('starts with sounds for critical and high alerts, browser notices off, a limited repeat', async () => {
    const { service } = setup();
    await expect(service.get(USER)).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toMatchObject({
      sound: { enabled: true, severities: ['critical', 'high'] },
      browser: { enabled: false },
      criticalRepeat: { times: 3 },
    });
  });

  it('falls back to the defaults when what was kept no longer validates', async () => {
    const { service } = setup({ sound: 'loud' });
    await expect(service.get(USER)).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('keeps each severity once, a volume from 0 to 100, a repeat of at most 10 times', () => {
    expect(
      NotificationPreferencesSchema.safeParse({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        sound: { enabled: true, volume: 30, severities: ['high', 'high', 'critical'] },
      }).success,
    ).toBe(false);
    expect(
      NotificationPreferencesSchema.parse({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        sound: { enabled: true, volume: 30, severities: ['high', 'critical'] },
      }).sound.severities,
    ).toEqual(['high', 'critical']);
    expect(
      NotificationPreferencesSchema.safeParse({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        sound: { enabled: true, volume: 101, severities: [] },
      }).success,
    ).toBe(false);
    expect(
      NotificationPreferencesSchema.safeParse({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        criticalRepeat: { enabled: true, intervalSeconds: 60, times: 11 },
      }).success,
    ).toBe(false);
  });

  it('stores them for the person alone, a quiet time at most a week ahead', async () => {
    const { prisma, service } = setup();
    const input: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietUntil: new Date(NOW + 30 * 86_400_000).toISOString(),
    };
    const saved = await service.put(USER, input);
    expect(saved.quietUntil).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: USER },
      create: { userId: USER, preferences: saved },
      update: { preferences: saved },
    });
  });
});
