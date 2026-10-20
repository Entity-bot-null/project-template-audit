import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import { call } from '../../api/errors';
import { Badge } from '../EventTable';
import { alertPath } from '../links';
import type { Alert } from '../types';
import { type AlertSummary, LiveContext, type LiveValue } from './LiveContext';
import { showNotice } from './notify';
import {
  DEFAULT_PREFERENCES,
  type Known,
  type News,
  newsOf,
  type NotificationPreferences,
  quietFor,
  reactionTo,
  repeatsFor,
} from './policy';
import { playSeverity, soundState, subscribeSound, unlockSound } from './sound';
import {
  isLeader,
  type LiveEvent,
  liveStatus,
  onLiveAlert,
  onLiveResync,
  startLive,
  subscribeStatus,
} from './stream';

const RECENT_LIMIT = 30;
/** What is remembered of the alerts heard (a long session stays bounded): the oldest go first. */
const KNOWN_LIMIT = 5_000;
const TOAST_LIMIT = 4;
/** One sound at most this often, whatever arrives: a burst is one sound. */
const SOUND_SPACING_MS = 3_000;
const TOAST_MS = 20_000;
const SUMMARY_DELAY_MS = 1_000;

interface Toast {
  alert: Alert;
  news: News;
}

const NEWS_WORDS: Record<News, string> = {
  opened: 'New',
  raised: 'Severity raised',
  escalated: 'Still unacknowledged',
};

// The live frame of the panel for the people who read alerts: the stream
// (one per browser), the counters, what changed lately, and the person's
// notices: an on-page notice for news, its sound and the browser's notice
// from one tab only (the stream's leader), as they chose; a critical alert's
// sound again, a few times at most, while nobody acknowledges it. Silencing
// sounds never acknowledges, resolves nor hides an alert.
export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const navigate = useNavigate();
  const status = useSyncExternalStore(subscribeStatus, () => (enabled ? liveStatus() : 'idle'));
  const sound = useSyncExternalStore(subscribeSound, soundState);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [recent, setRecent] = useState<LiveEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const preferencesRef = useRef(preferences);
  const known = useRef(new Map<string, Known & { open: boolean }>());
  const repeats = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const lastSoundAt = useRef(0);

  useEffect(() => {
    preferencesRef.current = preferences;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const stop = startLive();
    void call(api.GET('/api/account/notification-preferences')).then((result) => {
      if (result.ok) setPreferences(result.data);
    });
    return stop;
  }, [enabled]);

  // The counters: now, then shortly after each burst of changes.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void call(api.GET('/api/alerts/summary')).then((result) => {
        if (result.ok) setSummary(result.data);
      });
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, SUMMARY_DELAY_MS);
    };
    load();
    const offAlert = onLiveAlert(soon);
    const offResync = onLiveResync(soon);
    return () => {
      clearTimeout(timer);
      offAlert();
      offResync();
    };
  }, [enabled]);

  // The browser lets audio start from a gesture: the person's first click or
  // key. On the click, not the press: unlocking takes "Enable sound" out of
  // the header, and a header that moved between the press and the release
  // would lose the click it was for (Sign out, say). The press has made the
  // click a gesture already.
  useEffect(() => {
    if (!enabled) return undefined;
    const unlock = () => {
      if (preferencesRef.current.sound.enabled) void unlockSound();
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [enabled]);

  const stopRepeating = useCallback((alertId: string) => {
    clearInterval(repeats.current.get(alertId));
    repeats.current.delete(alertId);
  }, []);

  const play = useCallback((alert: Alert) => {
    const now = Date.now();
    if (now - lastSoundAt.current < SOUND_SPACING_MS) return;
    if (playSeverity(alert.severity, preferencesRef.current.sound.volume))
      lastSoundAt.current = now;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timers = repeats.current;
    const off = onLiveAlert((event) => {
      const { alert } = event;
      const now = Date.now();
      const prefs = preferencesRef.current;
      const news = newsOf(alert, known.current.get(alert.id), event.replay, now);
      const open = alert.status === 'open' && alert.acknowledgedAt === null;
      known.current.delete(alert.id);
      known.current.set(alert.id, {
        severity: alert.severity,
        escalations: alert.escalations,
        open,
      });
      if (known.current.size > KNOWN_LIMIT) {
        const oldest = known.current.keys().next().value;
        if (oldest !== undefined) known.current.delete(oldest);
      }
      if (!event.replay) setRecent((current) => [event, ...current].slice(0, RECENT_LIMIT));
      if (!open || alert.mutedUntil !== null) stopRepeating(alert.id);
      if (news === null || quietFor(alert, prefs, now)) return;

      setToasts((current) =>
        [{ alert, news }, ...current.filter((toast) => toast.alert.id !== alert.id)].slice(
          0,
          TOAST_LIMIT,
        ),
      );
      // One tab of the browser sounds and notifies: never the same alert twice.
      if (!isLeader()) return;
      const reaction = reactionTo(alert, prefs);
      if (reaction.sound) play(alert);
      if (reaction.notice) showNotice(alert, (alertId) => void navigate(`/alerts/${alertId}`));
      const repeat = reaction.sound ? repeatsFor(alert, prefs) : null;
      if (repeat !== null && !timers.has(alert.id)) {
        let left = repeat.times;
        timers.set(
          alert.id,
          setInterval(() => {
            const state = known.current.get(alert.id);
            left -= 1;
            if (
              left < 0 ||
              state?.open !== true ||
              quietFor(alert, preferencesRef.current, Date.now())
            ) {
              stopRepeating(alert.id);
              return;
            }
            play(alert);
          }, repeat.everyMs),
        );
      }
    });
    return () => {
      off();
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    };
  }, [enabled, navigate, play, stopRepeating]);

  // On-page notices fade, except a critical one: it waits to be dismissed.
  useEffect(() => {
    if (toasts.every((toast) => toast.alert.severity === 'critical')) return undefined;
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.alert.severity === 'critical'));
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toasts]);

  const savePreferences = useCallback(
    async (next: NotificationPreferences) => {
      const result = await call(api.PUT('/api/account/notification-preferences', { body: next }));
      if (result.ok) {
        setPreferences(result.data);
        // Quiet now: no critical alert keeps sounding.
        if (result.data.quietUntil !== null || !result.data.sound.enabled) {
          for (const alertId of [...repeats.current.keys()]) stopRepeating(alertId);
        }
      }
      return result.ok;
    },
    [stopRepeating],
  );

  const value = useMemo<LiveValue>(
    () => ({ enabled, status, summary, recent, preferences, savePreferences, sound, unlockSound }),
    [enabled, status, summary, recent, preferences, savePreferences, sound],
  );

  return (
    <LiveContext.Provider value={value}>
      {children}
      {enabled && (
        <LiveNotices
          toasts={toasts}
          onDismiss={(id) => {
            setToasts((current) => current.filter((toast) => toast.alert.id !== id));
          }}
        />
      )}
    </LiveContext.Provider>
  );
}

/** The on-page notices of news, announced to screen readers (a critical one at once). */
function LiveNotices({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (alertId: string) => void;
}) {
  const critical = toasts.find((toast) => toast.alert.severity === 'critical');
  const latest = toasts[0];
  return (
    <>
      <p className="visually-hidden" aria-live="assertive">
        {critical === undefined
          ? ''
          : `${NEWS_WORDS[critical.news]} critical alert: ${critical.alert.title}`}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {latest === undefined || latest.alert.severity === 'critical'
          ? ''
          : `${NEWS_WORDS[latest.news]} ${latest.alert.severity} alert: ${latest.alert.title}`}
      </p>
      {toasts.length > 0 && (
        <section className="live-notices" aria-label="Alert notices">
          {toasts.map(({ alert, news }) => {
            const path = alertPath(alert.id);
            return (
              <article key={alert.id} className={`live-notice live-notice-${alert.severity}`}>
                <p className="actions">
                  <Badge kind="sev" value={alert.severity} />
                  <strong>{NEWS_WORDS[news]}</strong>
                  <span className="muted">{alert.appSlug}</span>
                </p>
                <p>{alert.title}</p>
                <p className="actions">
                  {path !== null && <Link to={path}>Open the alert</Link>}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      onDismiss(alert.id);
                    }}
                  >
                    Dismiss
                  </button>
                </p>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
