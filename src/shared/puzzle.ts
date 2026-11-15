export type Size = { w: number; d: number; h: number };

/** Difficulty band. 1 is the easiest. */
export type Tier = 1 | 2 | 3;

export type Puzzle = {
  id: string;
  /** Position in the daily queue, from 1. 0 for puzzles outside the queue. */
  number: number;
  tier: Tier;
  size: Size;
  /** Target for the back wall. Rows top to bottom, each `w` characters, indexed by x. */
  front: string[];
  /** Target for the left wall. Rows top to bottom, each `d` characters, indexed by z. */
  side: string[];
  /** Fewest blocks the generator found that solve the puzzle. */
  par: number;
};

/**
 * A puzzle as stored in the generated queue. `parIsOptimal` is a note for the
 * developer and is never sent to players: only `Puzzle` fields leave the server.
 */
export type QueuedPuzzle = Puzzle & {
  /** True when par is proven to be the minimum, not only the best found. */
  parIsOptimal: boolean;
};

/**
 * Difficulty for each weekday, Monday first. The one place this mapping lives:
 * the generator builds the queue in this pattern and the server picks each
 * post's puzzle from the tier for its UTC weekday.
 */
export const WEEKDAY_TIERS: readonly Tier[] = [1, 1, 2, 2, 3, 3, 3];

/** The tier for the UTC weekday of `date`. */
export const tierForDate = (date: Date): Tier => WEEKDAY_TIERS[(date.getUTCDay() + 6) % 7] ?? 1;

export const TEST_PUZZLE: Puzzle = {
  id: 'proto-1',
  number: 0,
  tier: 1,
  size: { w: 3, d: 3, h: 3 },
  front: ['...', '###', '#.#'],
  side: ['...', '#..', '###'],
  par: 6,
};

export const TEST_SOLUTION = ['0,0,0', '0,0,1', '2,0,2', '0,1,0', '1,1,0', '2,1,0'];
