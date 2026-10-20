import { createContext, useContext, useEffect, useRef } from 'react';
import type { operations } from '../../api/client';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from './policy';
import type { SoundState } from './sound';
import { type LiveEvent, type LiveStatus, onLiveAlert, onLiveResync } from './stream';

export type AlertSummary =
  operations['AlertsController_summary']['responses'][200]['content']['application/json']['data'];

/** What the signed-in frame knows live (LiveProvider), for the header and the pages. */
export interface LiveValue {
  /** The stream runs (a person who reads alerts). */
  enabled: boolean;
  status: LiveStatus;
  summary: AlertSummary | null;
  /** The latest changes heard (not replays), newest first. */
  recent: readonly LiveEvent[];
  preferences: NotificationPreferences;
  /** Saves the person's preferences; false when the API refused them. */
  savePreferences: (next: NotificationPreferences) => Promise<boolean>;
  sound: SoundState;
  /** From a click: lets the browser play sounds. */
  unlockSound: () => Promise<boolean>;
}

export const LiveContext = createContext<LiveValue>({
  enabled: false,
  status: 'idle',
  summary: null,
  recent: [],
  preferences: DEFAULT_PREFERENCES,
  savePreferences: () => Promise.resolve(false),
  sound: 'unsupported',
  unlockSound: () => Promise.resolve(false),
});

export const useLive = (): LiveValue => useContext(LiveContext);

/**
 * Runs `refresh` (debounced) when an alert that `concerns` changes, or after
 * too many were missed to replay: a page's quiet reload while it is shown.
 */
export function useLiveRefresh(
  refresh: () => unknown,
  concerns: (event: LiveEvent) => boolean = () => true,
  delayMs = 1_000,
): void {
  const latest = useRef({ refresh, concerns });
  useEffect(() => {
    latest.current = { refresh, concerns };
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void latest.current.refresh(), delayMs);
    };
    const offAlert = onLiveAlert((event) => {
      if (latest.current.concerns(event)) soon();
    });
    const offResync = onLiveResync(soon);
    return () => {
      clearTimeout(timer);
      offAlert();
      offResync();
    };
  }, [delayMs]);
}
