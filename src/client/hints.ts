// The hints a first-time player gets during the warm-up: one at a time, each
// tied to something on the board, each gone once the player has done what it
// says, and none shown twice. No DOM: this only decides which hint is due.

export const HINT_IDS = ['place', 'shadows', 'build', 'extra', 'turn', 'solved'] as const;
export type HintId = (typeof HINT_IDS)[number];

export const HINT_TEXT: Record<HintId, string> = {
  place: 'Tap a tile to place a block.',
  shadows: 'Your blocks cast a shadow on each wall. Fill both dashed shapes.',
  build: 'Tap the top or side of a block to build on it.',
  extra: 'Red is shadow outside the shape. Switch to Remove and tap a block.',
  turn: 'Turn the board to see behind your blocks.',
  solved: 'Solved. Fewer blocks earn more stars.',
};

/** The button that ends the warm-up, shown with the last hint. */
export const WARMUP_DONE_LABEL = "Play today's puzzle";

/** Shown once on a real puzzle, the first time a new player's sculpture is a valid solve. */
export const SOLVE_HINT_TEXT = 'Trim blocks for more stars, or Submit. Only your first submit counts.';

/** How many blocks are on the board before the player is nudged to turn it. */
export const TURN_HINT_BLOCKS = 4;

/** What the hints need to know about the board. */
export type HintInput = {
  /** Blocks on the board now. */
  blocks: number;
  /** True while any shadow falls outside its target. */
  extra: boolean;
  /** True once the board has been turned at all. */
  rotated: boolean;
  solved: boolean;
};

export type Hints = {
  /** Takes the board as it is now and returns the hint to show, or null for none. */
  update: (input: HintInput) => HintId | null;
  /** Every hint shown so far, in order. */
  shown: () => HintId[];
};

// The order hints are offered in when more than one is due. A problem on the
// board now (shadow in the wrong place) comes before the next lesson.
const ORDER: readonly HintId[] = ['place', 'shadows', 'extra', 'build', 'turn'];

export const createHints = (): Hints => {
  const seen: HintId[] = [];
  let current: HintId | null = null;
  /** How many blocks the player has placed in all, however many are left on the board. */
  let placed = 0;
  let last = 0;

  /** Whether a hint is due: the moment in play it belongs to has come. */
  const due = (hint: HintId, input: HintInput): boolean => {
    switch (hint) {
      case 'place':
        return placed === 0 && input.blocks === 0;
      case 'shadows':
        return placed >= 1;
      case 'build':
        return placed >= 2;
      case 'extra':
        return input.extra;
      case 'turn':
        return !input.rotated && input.blocks >= TURN_HINT_BLOCKS;
      case 'solved':
        return input.solved;
    }
  };

  /** Whether the player has done what the hint on show asks. */
  const done = (hint: HintId, input: HintInput): boolean => {
    switch (hint) {
      case 'place':
        return placed >= 1;
      case 'shadows':
        return placed >= 2;
      case 'build':
        return placed >= 3;
      case 'extra':
        return !input.extra;
      case 'turn':
        return input.rotated;
      case 'solved':
        // The last hint stays: it holds the button that ends the warm-up.
        return false;
    }
  };

  const show = (hint: HintId): void => {
    current = hint;
    seen.push(hint);
  };

  return {
    update: (input) => {
      if (input.blocks > last) placed += input.blocks - last;
      last = input.blocks;

      // Solving ends the lesson, whatever hint was on show.
      if (input.solved && !seen.includes('solved')) show('solved');
      if (current !== null && done(current, input)) current = null;
      if (current === null) {
        const next = ORDER.find((hint) => !seen.includes(hint) && due(hint, input));
        if (next) show(next);
      }
      return current;
    },
    shown: () => [...seen],
  };
};
