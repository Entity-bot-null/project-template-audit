import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSeverity, resetSoundForTests, soundState, subscribeSound, unlockSound } from './sound';

/** An AudioContext that records the notes it is asked to play. */
function stubAudio({ resumes = true }: { resumes?: boolean } = {}) {
  const started: number[] = [];
  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  class FakeAudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    resume = vi.fn(() => {
      if (!resumes) return Promise.reject(new Error('NotAllowedError'));
      this.state = 'running';
      return Promise.resolve();
    });
    createOscillator() {
      const node = {
        type: 'sine',
        frequency: param(),
        connect: (next: unknown) => next,
        start: (at: number) => started.push(at),
        stop: vi.fn(),
      };
      return node;
    }
    createGain() {
      return { gain: param(), connect: (next: unknown) => next };
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return { started };
}

beforeEach(() => {
  resetSoundForTests();
});
afterEach(() => {
  resetSoundForTests();
  vi.unstubAllGlobals();
});

describe('alert sounds', () => {
  it('are unsupported without Web Audio, and never throw', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(soundState()).toBe('unsupported');
    await expect(unlockSound()).resolves.toBe(false);
    expect(playSeverity('critical', 80)).toBe(false);
  });

  it('play nothing until a gesture unlocks them (the autoplay rules)', async () => {
    const { started } = stubAudio();
    expect(soundState()).toBe('locked');
    expect(playSeverity('critical', 80)).toBe(false);
    expect(started).toHaveLength(0);

    const listener = vi.fn();
    subscribeSound(listener);
    await expect(unlockSound()).resolves.toBe(true);
    expect(soundState()).toBe('ready');
    expect(listener).toHaveBeenCalled();
  });

  it('play a distinct pattern per severity, silent at volume 0', async () => {
    const { started } = stubAudio();
    await unlockSound();
    expect(playSeverity('critical', 80)).toBe(true);
    expect(started).toHaveLength(4);
    expect(playSeverity('high', 80)).toBe(true);
    expect(started).toHaveLength(6);
    expect(playSeverity('low', 0)).toBe(false);
    expect(started).toHaveLength(6);
  });

  it('stay locked, without an error, when the browser refuses to start them', async () => {
    stubAudio({ resumes: false });
    await expect(unlockSound()).resolves.toBe(false);
    expect(soundState()).toBe('locked');
  });
});
