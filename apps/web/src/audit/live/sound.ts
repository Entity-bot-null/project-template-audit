// The panel's alert sounds, made with Web Audio (no sound files to load or
// fetch): a distinct pattern per severity. Browsers start audio only after
// a gesture of the person (autoplay rules): `unlockSound` runs from one (a
// click, a key), and until then nothing is played and `soundState` says so.
// A failure to play is swallowed: a page never breaks for a sound.

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type SoundState = 'unsupported' | 'locked' | 'ready';

/** Each note: its pitch (Hz) and length (ms); notes follow each other with a short gap. */
const PATTERNS: Record<Severity, readonly (readonly [number, number])[]> = {
  // Four notes, falling and rising: unmistakable, and still short.
  critical: [
    [880, 140],
    [660, 140],
    [880, 140],
    [660, 220],
  ],
  high: [
    [740, 160],
    [740, 160],
  ],
  medium: [[560, 150]],
  low: [[480, 120]],
  info: [[440, 100]],
};
const GAP_MS = 60;

type AudioContextClass = typeof AudioContext;
let context: AudioContext | null = null;
const listeners = new Set<() => void>();

function audioClass(): AudioContextClass | undefined {
  // Absent from some browsers and from tests, whatever the DOM types say.
  const scope = globalThis as {
    AudioContext?: AudioContextClass;
    webkitAudioContext?: AudioContextClass;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

export function soundState(): SoundState {
  if (audioClass() === undefined) return 'unsupported';
  return context?.state === 'running' ? 'ready' : 'locked';
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const changed = () => {
  for (const listener of listeners) listener();
};

/** From a gesture of the person: starts (or resumes) audio. True once it can play. */
export async function unlockSound(): Promise<boolean> {
  const Audio = audioClass();
  if (Audio === undefined) return false;
  try {
    context ??= new Audio();
    if (context.state !== 'running') await context.resume();
  } catch {
    return false;
  } finally {
    changed();
  }
  return soundState() === 'ready';
}

/** Plays a severity's pattern at `volume` (0 to 100); false when it could not. */
export function playSeverity(severity: Severity, volume: number): boolean {
  if (context?.state !== 'running' || volume <= 0) return false;
  try {
    const gain = Math.min(1, Math.max(0, volume / 100)) * 0.4;
    let at = context.currentTime + 0.02;
    for (const [frequency, ms] of PATTERNS[severity]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      // A short attack and release: no click at either end.
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(gain, at + 0.01);
      envelope.gain.setValueAtTime(gain, at + ms / 1000 - 0.03);
      envelope.gain.linearRampToValueAtTime(0, at + ms / 1000);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + ms / 1000 + 0.01);
      at += (ms + GAP_MS) / 1000;
    }
    return true;
  } catch {
    return false;
  }
}

/** Forgets the audio context (specs). */
export function resetSoundForTests(): void {
  context = null;
  listeners.clear();
}
