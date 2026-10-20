import { useState } from 'react';
import { Link } from 'react-router';
import { useNow } from '../../hooks/useNow';
import { formatWhen } from '../format';
import { useLive } from './LiveContext';
import type { LiveStatus } from './stream';

const STATUS_WORDS: Record<LiveStatus, string> = {
  idle: 'Not live',
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

const QUIET_MS = 60 * 60_000;

/** Whether the live stream is connected, in words (not color alone); announced once per page. */
export function LiveStatusBadge({ announce = true }: { announce?: boolean }) {
  const { status } = useLive();
  return (
    <span className={`live-status live-${status}`} role={announce ? 'status' : undefined}>
      <span className="live-dot" aria-hidden="true" />
      {STATUS_WORDS[status]}
    </span>
  );
}

/**
 * The header's live controls: the stream's state, sound when the browser
 * still blocks it, an hour of quiet (no sound, no notice: alerts stay as they
 * are) and the person's notification settings.
 */
export function LiveControls({ announce = true }: { announce?: boolean }) {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const now = useNow();
  if (!live.enabled) return null;
  const { preferences } = live;
  const quietUntil =
    preferences.quietUntil !== null && Date.parse(preferences.quietUntil) > now
      ? preferences.quietUntil
      : null;
  const setQuiet = async (until: string | null) => {
    setBusy(true);
    await live.savePreferences({ ...preferences, quietUntil: until });
    setBusy(false);
  };
  return (
    <div className="live-controls">
      <LiveStatusBadge announce={announce} />
      {preferences.sound.enabled && live.sound === 'locked' && quietUntil === null && (
        <button type="button" className="secondary" onClick={() => void live.unlockSound()}>
          Enable sound
        </button>
      )}
      {quietUntil === null ? (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void setQuiet(new Date(Date.now() + QUIET_MS).toISOString())}
        >
          Quiet for an hour
        </button>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void setQuiet(null)}
        >
          Quiet until {formatWhen(quietUntil)}: resume
        </button>
      )}
      <Link to="/account/notifications">Notifications</Link>
    </div>
  );
}
