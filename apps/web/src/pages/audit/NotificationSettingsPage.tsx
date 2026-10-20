import { useId, useState } from 'react';
import { useVisibleApps } from '../../audit/apps';
import { formatDateTime } from '../../audit/format';
import { useLive } from '../../audit/live/LiveContext';
import {
  type NoticePermission,
  noticePermission,
  requestNoticePermission,
} from '../../audit/live/notify';
import type { NotificationPreferences } from '../../audit/live/policy';
import { playSeverity, type Severity } from '../../audit/live/sound';
import { Alert } from '../../components/Alert';
import { useNow } from '../../hooks/useNow';

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const PERMISSION_WORDS: Record<NoticePermission, string> = {
  granted: 'Allowed by this browser.',
  denied:
    "Blocked by this browser: allow them in its site settings to get them. Audit Hub's own notices keep working.",
  default: 'Not asked yet.',
  unsupported: "This browser has no notifications: Audit Hub's own notices keep working.",
};

const QUIET_CHOICES = [
  [60, 'an hour'],
  [8 * 60, '8 hours'],
  [24 * 60, 'a day'],
] as const;

/** A set of severities as checkboxes. */
function SeverityChoice({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: readonly Severity[];
  onChange: (next: Severity[]) => void;
}) {
  return (
    <fieldset className="checkboxes">
      <legend>{legend}</legend>
      {SEVERITIES.map((severity) => (
        <label key={severity} className="checkbox">
          <input
            type="checkbox"
            checked={value.includes(severity)}
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...value, severity]
                  : value.filter((candidate) => candidate !== severity),
              );
            }}
          />
          {severity}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A whole number typed freely (cleared, retyped): what is typed stays as
 * typed, and each whole number in it reaches `onChange`; the browser holds
 * the form back while it is empty or out of bounds.
 */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        required
        min={min}
        max={max}
        value={text}
        onChange={(event) => {
          const typed = event.target.value;
          setText(typed);
          const parsed = Number(typed);
          if (typed !== '' && Number.isInteger(parsed)) {
            setShown(parsed);
            onChange(parsed);
          }
        }}
      />
    </div>
  );
}

// The person's notifications in the panel: sounds by severity (each one to
// try), a critical alert's sound again while unacknowledged, the browser's own
// notices, quiet times and the applications they never want to hear about.
// Kept on their account (the same on every device); whether the browser
// allows sound and notices is the browser's, shown as it is.
export function NotificationSettingsPage() {
  const live = useLive();
  const apps = useVisibleApps();
  const [draft, setDraft] = useState<NotificationPreferences>(live.preferences);
  const [saved, setSaved] = useState(live.preferences);
  const [permission, setPermission] = useState<NoticePermission>(noticePermission);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const volumeId = useId();

  const now = useNow();

  // The saved preferences arrive after the page (or change on saving): start from them.
  if (saved !== live.preferences) {
    setSaved(live.preferences);
    setDraft(live.preferences);
  }

  const set = (change: Partial<NotificationPreferences>) => {
    setDraft((current) => ({ ...current, ...change }));
  };
  const quiet =
    draft.quietUntil !== null && Date.parse(draft.quietUntil) > now ? draft.quietUntil : null;

  async function save(next: NotificationPreferences = draft) {
    setBusy(true);
    setOutcome(null);
    const ok = await live.savePreferences(next);
    setBusy(false);
    setOutcome(
      ok ? { ok, text: 'Saved.' } : { ok, text: 'Not saved: check the values and try again.' },
    );
  }

  async function tryOut(severity: Severity) {
    if (live.sound !== 'ready' && !(await live.unlockSound())) {
      setOutcome({ ok: false, text: 'This browser does not play sounds here.' });
      return;
    }
    playSeverity(severity, draft.sound.volume);
  }

  return (
    <section className="stack" aria-labelledby="notifications-heading">
      <h1 id="notifications-heading">Notifications</h1>
      <p className="muted">
        How the panel tells you about alerts while it is open. Silencing never acknowledges,
        resolves nor hides an alert: it stays in the lists and counters.
      </p>
      {outcome !== null && <Alert tone={outcome.ok ? 'info' : 'error'}>{outcome.text}</Alert>}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <section className="card stack" aria-labelledby="sound-heading">
          <h2 id="sound-heading">Sounds</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.sound.enabled}
              onChange={(event) => {
                set({ sound: { ...draft.sound, enabled: event.target.checked } });
              }}
            />
            Play a sound for new alerts
          </label>
          <div className="field">
            <label htmlFor={volumeId}>Volume ({draft.sound.volume})</label>
            <input
              id={volumeId}
              type="range"
              min={0}
              max={100}
              value={draft.sound.volume}
              onChange={(event) => {
                set({ sound: { ...draft.sound, volume: Number(event.target.value) } });
              }}
            />
          </div>
          <SeverityChoice
            legend="Severities that sound"
            value={draft.sound.severities}
            onChange={(severities) => {
              set({ sound: { ...draft.sound, severities } });
            }}
          />
          <p className="actions">
            {SEVERITIES.map((severity) => (
              <button
                key={severity}
                type="button"
                className="secondary"
                onClick={() => void tryOut(severity)}
              >
                Try the {severity} sound
              </button>
            ))}
          </p>
          {live.sound === 'unsupported' && (
            <p className="muted">This browser has no Web Audio: no sound here.</p>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.criticalRepeat.enabled}
              onChange={(event) => {
                set({ criticalRepeat: { ...draft.criticalRepeat, enabled: event.target.checked } });
              }}
            />
            Sound a critical alert again while nobody acknowledges it
          </label>
          <div className="filters">
            <NumberField
              label="Every (seconds)"
              min={30}
              max={600}
              value={draft.criticalRepeat.intervalSeconds}
              onChange={(intervalSeconds) => {
                set({ criticalRepeat: { ...draft.criticalRepeat, intervalSeconds } });
              }}
            />
            <NumberField
              label="At most (times)"
              min={1}
              max={10}
              value={draft.criticalRepeat.times}
              onChange={(times) => {
                set({ criticalRepeat: { ...draft.criticalRepeat, times } });
              }}
            />
          </div>
        </section>

        <section className="card stack" aria-labelledby="browser-heading">
          <h2 id="browser-heading">Browser notifications</h2>
          <p className="muted">
            The browser's own notices, while a tab of the panel is open (not when it is closed).
            They carry the alert's severity, application and title only.
          </p>
          <p>{PERMISSION_WORDS[permission]}</p>
          {permission === 'default' && (
            <p>
              <button
                type="button"
                className="secondary"
                onClick={() => void requestNoticePermission().then(setPermission)}
              >
                Allow browser notifications
              </button>
            </p>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.browser.enabled}
              onChange={(event) => {
                set({ browser: { ...draft.browser, enabled: event.target.checked } });
              }}
            />
            Show browser notifications for new alerts
          </label>
          <SeverityChoice
            legend="Severities that notify"
            value={draft.browser.severities}
            onChange={(severities) => {
              set({ browser: { ...draft.browser, severities } });
            }}
          />
        </section>

        <section className="card stack" aria-labelledby="quiet-heading">
          <h2 id="quiet-heading">Quiet</h2>
          {quiet === null ? (
            <p className="actions">
              {QUIET_CHOICES.map(([minutes, words]) => (
                <button
                  key={minutes}
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...draft,
                      quietUntil: new Date(Date.now() + minutes * 60_000).toISOString(),
                    })
                  }
                >
                  Quiet for {words}
                </button>
              ))}
            </p>
          ) : (
            <p className="actions">
              <span>No sound and no notice until {formatDateTime(quiet)}.</span>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void save({ ...draft, quietUntil: null })}
              >
                Resume now
              </button>
            </p>
          )}
          {apps.state.kind === 'loaded' && (
            <fieldset className="checkboxes">
              <legend>Applications you never hear about here</legend>
              {apps.state.data.items
                .filter((app) => !app.system)
                .map((app) => (
                  <label key={app.appId} className="checkbox">
                    <input
                      type="checkbox"
                      checked={draft.mutedAppIds.includes(app.appId)}
                      onChange={(event) => {
                        set({
                          mutedAppIds: event.target.checked
                            ? [...draft.mutedAppIds, app.appId]
                            : draft.mutedAppIds.filter((id) => id !== app.appId),
                        });
                      }}
                    />
                    {app.name} ({app.environment})
                  </label>
                ))}
            </fieldset>
          )}
        </section>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}
