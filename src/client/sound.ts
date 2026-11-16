// The game's three sounds, made in code with the Web Audio API: there are no
// audio files. A soft wooden knock when a block lands, a lighter one when a
// block is taken away, and two short notes when a sculpture first becomes a
// valid solve. All of it quiet.
//
// Browsers only allow sound after the player has touched the page, so nothing
// is set up until `unlock` is called from their first tap.

export type SoundName = 'knock' | 'lift';

/** What the board looked like before and after a change, as far as sound cares. */
export type BoardMoment = { blocks: number; viewing: boolean; making: boolean };

/**
 * The sound a change to the board makes, or null for none. Blocks arriving
 * knock; blocks leaving make the lighter sound. Swapping to someone else's
 * sculpture, or to and from making a puzzle, changes the whole board at once
 * and makes no sound.
 */
export const soundForChange = (before: BoardMoment, after: BoardMoment): SoundName | null => {
  if (before.viewing || after.viewing || before.making !== after.making) return null;
  if (after.blocks > before.blocks) return 'knock';
  if (after.blocks < before.blocks) return 'lift';
  return null;
};

export type Sounds = {
  /** Call from the player's first tap: sets sound up, which a browser allows only then. */
  unlock: () => void;
  /** A block landing, `delayMs` from now: the time its drop takes. */
  knock: (delayMs?: number) => void;
  /** A block taken away. */
  lift: () => void;
  /** The sculpture has just become a valid solve. */
  solved: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
};

/** How loud everything is, out of 1. Kept low: this plays in a feed. */
const VOLUME = 0.32;

export const createSounds = (): Sounds => {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;

  /** The audio set-up, or null where there is none to be had or the player has not tapped yet. */
  const ready = (): { context: AudioContext; master: GainNode } | null => {
    if (muted || !context || !master) return null;
    // A browser may put sound to sleep when the page is left; waking it is harmless.
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return { context, master };
  };

  /** One struck note: a tone that falls in pitch and dies away at once, like wood on wood. */
  const strike = (from: number, to: number, peak: number, lengthMs: number, delayMs: number): void => {
    const audio = ready();
    if (!audio) return;
    const start = audio.context.currentTime + delayMs / 1000;
    const end = start + lengthMs / 1000;
    const tone = audio.context.createOscillator();
    const level = audio.context.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(from, start);
    tone.frequency.exponentialRampToValueAtTime(to, end);
    level.gain.setValueAtTime(0.0001, start);
    level.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    level.gain.exponentialRampToValueAtTime(0.0001, end);
    tone.connect(level).connect(audio.master);
    tone.start(start);
    tone.stop(end + 0.02);
  };

  /** A short breath of filtered noise: the dry click at the front of a knock. */
  const click = (peak: number, delayMs: number): void => {
    const audio = ready();
    if (!audio) return;
    const start = audio.context.currentTime + delayMs / 1000;
    const length = Math.floor(audio.context.sampleRate * 0.02);
    const buffer = audio.context.createBuffer(1, length, audio.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) samples[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const noise = audio.context.createBufferSource();
    noise.buffer = buffer;
    const band = audio.context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1100;
    const level = audio.context.createGain();
    level.gain.value = peak;
    noise.connect(band).connect(level).connect(audio.master);
    noise.start(start);
  };

  /** One soft, clear note. */
  const note = (pitch: number, peak: number, lengthMs: number, delayMs: number): void => {
    const audio = ready();
    if (!audio) return;
    const start = audio.context.currentTime + delayMs / 1000;
    const end = start + lengthMs / 1000;
    const tone = audio.context.createOscillator();
    const level = audio.context.createGain();
    tone.type = 'triangle';
    tone.frequency.value = pitch;
    level.gain.setValueAtTime(0.0001, start);
    level.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    level.gain.exponentialRampToValueAtTime(0.0001, end);
    tone.connect(level).connect(audio.master);
    tone.start(start);
    tone.stop(end + 0.02);
  };

  return {
    unlock: () => {
      if (context) return;
      try {
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = VOLUME;
        master.connect(context.destination);
      } catch (error) {
        // No sound on this device: the game is the same without it.
        console.warn('Sound is not available:', error);
        context = null;
        master = null;
      }
    },
    knock: (delayMs = 0) => {
      click(0.5, delayMs);
      strike(170, 78, 0.9, 95, delayMs);
    },
    lift: () => {
      strike(330, 250, 0.4, 60, 0);
    },
    solved: () => {
      // Two notes, a fourth apart, the second a little after the first.
      note(659.25, 0.45, 220, 60);
      note(880, 0.45, 320, 210);
    },
    setMuted: (next) => {
      muted = next;
    },
    isMuted: () => muted,
  };
};
