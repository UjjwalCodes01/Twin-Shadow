import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSounds, soundForChange, type BoardMoment } from './sound';

const board = (blocks: number, changes: Partial<BoardMoment> = {}): BoardMoment => ({
  blocks,
  viewing: false,
  making: false,
  ...changes,
});

describe('soundForChange', () => {
  it('knocks when a block is placed, and makes the lighter sound when one is taken away', () => {
    expect(soundForChange(board(2), board(3))).toBe('knock');
    expect(soundForChange(board(3), board(2))).toBe('lift');
  });

  it('makes one sound however many blocks changed at once, as for Reset', () => {
    expect(soundForChange(board(9), board(0))).toBe('lift');
    expect(soundForChange(board(0), board(9))).toBe('knock');
  });

  it('is silent when nothing was placed or removed, as for turning the board', () => {
    expect(soundForChange(board(4), board(4))).toBeNull();
  });

  it('is silent while someone else`s sculpture is on the board, and going to and from it', () => {
    expect(soundForChange(board(4), board(9, { viewing: true }))).toBeNull();
    expect(soundForChange(board(9, { viewing: true }), board(6, { viewing: true }))).toBeNull();
    expect(soundForChange(board(6, { viewing: true }), board(4))).toBeNull();
  });

  it('is silent going into and out of making a puzzle, but not while building one', () => {
    expect(soundForChange(board(7), board(0, { making: true }))).toBeNull();
    expect(soundForChange(board(3, { making: true }), board(7))).toBeNull();
    expect(soundForChange(board(0, { making: true }), board(1, { making: true }))).toBe('knock');
  });
});

describe('createSounds', () => {
  it('does nothing, and does not fail, before the player has tapped or where there is no sound', () => {
    const sounds = createSounds();
    expect(() => {
      sounds.knock(85);
      sounds.lift();
      sounds.solved();
    }).not.toThrow();
  });

  it('remembers being muted', () => {
    const sounds = createSounds();
    expect(sounds.isMuted()).toBe(false);
    sounds.setMuted(true);
    expect(sounds.isMuted()).toBe(true);
    expect(() => sounds.knock()).not.toThrow();
  });
});

describe('the first sound of a session', () => {
  // Just enough of the browser's sound set-up for a sound to be scheduled.
  const param = () => ({ value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} });
  const node = () => ({
    connect: (next: unknown) => next,
    start: () => {},
    stop: () => {},
    gain: param(),
    frequency: param(),
    type: '',
    buffer: null,
  });
  let state = 'running';
  class FakeAudioContext {
    currentTime = 0;
    sampleRate = 8000;
    destination = {};
    get state(): string {
      return state;
    }
    createGain = node;
    createOscillator = node;
    createBufferSource = node;
    createBiquadFilter = node;
    createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
    resume = async (): Promise<void> => {};
  }

  beforeEach(() => {
    state = 'running';
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is reported once, a moment after it is played, with what the device says of its sound', () => {
    const reports: string[] = [];
    const sounds = createSounds((said) => reports.push(said));
    sounds.unlock();
    sounds.knock();
    // Not at once: a set-up that is still waking gets a moment to say so.
    expect(reports).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(reports).toEqual(['running']);
    sounds.lift();
    sounds.solved();
    sounds.knock(85);
    vi.advanceTimersByTime(5000);
    expect(reports).toEqual(['running']);
  });

  it('says so when the device has not let sound start', () => {
    const reports: string[] = [];
    const sounds = createSounds((said) => reports.push(said));
    state = 'suspended';
    sounds.unlock();
    sounds.lift();
    vi.advanceTimersByTime(300);
    expect(reports).toEqual(['suspended']);
  });

  it('is not reported before the player has tapped, or while sound is off', () => {
    const reports: string[] = [];
    const sounds = createSounds((said) => reports.push(said));
    sounds.knock();
    vi.advanceTimersByTime(1000);
    expect(reports).toEqual([]);
    sounds.setMuted(true);
    sounds.unlock();
    sounds.knock();
    sounds.solved();
    vi.advanceTimersByTime(1000);
    expect(reports).toEqual([]);
    // Turned back on: the next sound is the first one heard.
    sounds.setMuted(false);
    sounds.lift();
    vi.advanceTimersByTime(300);
    expect(reports).toEqual(['running']);
  });
});
