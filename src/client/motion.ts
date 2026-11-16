// The timing of everything that moves on the board: blocks dropping into
// place, lifting away, fading in a swap, and bobbing when nothing holds them
// up. No DOM and no three.js: the scene asks this where things are at a given
// moment and draws them there.
//
// Nothing here ever holds input back. A block is in the game the instant it is
// placed; its drop is only how it is drawn.

import { THEME } from './theme';

const { drop, lift, bob } = THEME.motion;

/** Whether the device has asked for less motion. Read once per page. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The clock every animation reads. A debug hook can replace it, to step
// through an animation frame by frame for a screenshot.
let readClock = (): number => performance.now();
export const motionNow = (): number => readClock();
export const setMotionClock = (clock: (() => number) | null): void => {
  readClock = clock ?? ((): number => performance.now());
};

/**
 * How far above its place a block is, `elapsed` ms after it was put down: it
 * falls, lands, and settles with one small rebound. 0 once it has settled.
 */
export const dropOffset = (elapsed: number): number => {
  if (elapsed < 0) return drop.height;
  if (elapsed < drop.fallMs) {
    const t = elapsed / drop.fallMs;
    // Falling: slow at first, fastest as it lands.
    return drop.height * (1 - t * t);
  }
  const settle = (elapsed - drop.fallMs) / drop.settleMs;
  return settle >= 1 ? 0 : drop.rebound * Math.sin(settle * Math.PI);
};

export const DROP_MS = drop.fallMs + drop.settleMs;

/** A block being taken away, `elapsed` ms after it was removed: how far it has risen and how much shows. */
export const liftAt = (elapsed: number): { offset: number; opacity: number } => {
  const t = Math.min(Math.max(elapsed / lift.ms, 0), 1);
  return { offset: lift.height * t * (2 - t), opacity: 1 - t };
};

/** How much of something fading in shows, `elapsed` ms into a fade of `ms`. */
export const fadeAt = (elapsed: number, ms: number): number =>
  ms <= 0 ? 1 : Math.min(Math.max(elapsed / ms, 0), 1);

/** True while a block that started to float at `since` is still bobbing. */
export const isBobbing = (now: number, since: number): boolean => now - since < bob.forMs;

/**
 * How far a floating block rides above its hover height at time `now`, having
 * started to float at `since`. It bobs for a few seconds, easing off towards
 * the end, and is then exactly at rest.
 */
export const bobOffset = (now: number, since: number): number => {
  const elapsed = now - since;
  if (elapsed < 0 || elapsed >= bob.forMs) return 0;
  // Full strength until the last stretch, then fading to nothing.
  const strength = Math.min(1, (bob.forMs - elapsed) / bob.easeMs);
  return bob.height * strength * Math.sin((elapsed / bob.periodMs) * Math.PI * 2);
};

/** How a block that has just appeared or gone is animated. */
export type MotionStyle = 'drop' | 'fade' | 'none';

type Arrival = { at: number; style: MotionStyle };
type Leaving = { key: string; at: number; style: MotionStyle; ms: number };

export type BlockMotion = {
  /**
   * Tells the tracker what is on the board now. Blocks that were not there
   * before start arriving; blocks that have gone start leaving. Returns the
   * keys that left, so the scene can keep drawing them while they go.
   */
  sync: (blocks: ReadonlySet<string>, now: number, style: MotionStyle) => { arrived: string[]; left: string[] };
  /** How a block that is on the board should be drawn now: lifted by `offset`, `opacity` of it showing. */
  arriving: (key: string, now: number) => { offset: number; opacity: number; moving: boolean };
  /** The blocks still on their way out, and how each should be drawn. A finished one is dropped. */
  leaving: (now: number) => { key: string; offset: number; opacity: number }[];
  /** True while anything is still arriving or leaving. */
  moving: (now: number) => boolean;
};

/**
 * Tracks which blocks are arriving and which are leaving. `swapMs` is how
 * long a fade takes. The first sync is the board as it was found: nothing in
 * it animates.
 */
export const createBlockMotion = (swapMs: number): BlockMotion => {
  let known: ReadonlySet<string> | null = null;
  const arrivals = new Map<string, Arrival>();
  let goings: Leaving[] = [];

  const arrivalMs = (style: MotionStyle): number => (style === 'drop' ? DROP_MS : style === 'fade' ? swapMs : 0);

  return {
    sync: (blocks, now, style) => {
      const arrived: string[] = [];
      const left: string[] = [];
      if (known) {
        for (const key of blocks) {
          if (known.has(key)) continue;
          arrived.push(key);
          if (style !== 'none') arrivals.set(key, { at: now, style });
          // A block put back while it was still leaving stops leaving.
          goings = goings.filter((going) => going.key !== key);
        }
        for (const key of known) {
          if (blocks.has(key)) continue;
          left.push(key);
          arrivals.delete(key);
          if (style !== 'none') goings.push({ key, at: now, style, ms: style === 'drop' ? lift.ms : swapMs });
        }
      }
      known = new Set(blocks);
      return { arrived, left };
    },

    arriving: (key, now) => {
      const arrival = arrivals.get(key);
      if (!arrival) return { offset: 0, opacity: 1, moving: false };
      const elapsed = now - arrival.at;
      if (elapsed >= arrivalMs(arrival.style)) {
        arrivals.delete(key);
        return { offset: 0, opacity: 1, moving: false };
      }
      return arrival.style === 'drop'
        ? { offset: dropOffset(elapsed), opacity: 1, moving: true }
        : { offset: 0, opacity: fadeAt(elapsed, swapMs), moving: true };
    },

    leaving: (now) => {
      goings = goings.filter((going) => now - going.at < going.ms);
      return goings.map(({ key, at, style, ms }) => {
        if (style === 'drop') return { key, ...liftAt(now - at) };
        return { key, offset: 0, opacity: 1 - fadeAt(now - at, ms) };
      });
    },

    moving: (now) =>
      goings.some((going) => now - going.at < going.ms) ||
      [...arrivals.values()].some((arrival) => now - arrival.at < arrivalMs(arrival.style)),
  };
};
