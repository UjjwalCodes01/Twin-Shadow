// Debug board states, reachable only with ?debug=1 in the URL.
//   ?debug=1&state=empty|solution|broken|big&rot=0..3

import { canPlace, formatSilhouette, parseKey, projectFront, projectSide, toKey } from '../shared/logic';
import { TEST_PUZZLE, TEST_SOLUTION, type Puzzle, type Size } from '../shared/puzzle';
import { createRandom } from '../shared/random';

export type DebugSetup = { puzzle: Puzzle; blocks: readonly string[] };

export const DEBUG_STATES = ['empty', 'solution', 'broken', 'big'] as const;

const BIG_SIZE: Size = { w: 5, d: 5, h: 5 };
const BIG_BLOCKS = 20;
const BIG_SEED = 20261114;

const STEPS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/**
 * A 5x5x5 board holding a random sculpture grown outward from one floor cell,
 * so every block connects to the floor. Both silhouettes are derived from it,
 * which means the board starts solved.
 */
const bigSetup = (): DebugSetup => {
  const random = createRandom(BIG_SEED);
  const pick = random.int;
  const blocks = [toKey(pick(BIG_SIZE.w), 0, pick(BIG_SIZE.d))];
  const placed = new Set(blocks);

  for (let attempt = 0; blocks.length < BIG_BLOCKS && attempt < 10_000; attempt++) {
    const from = blocks[pick(blocks.length)];
    const step = STEPS[pick(STEPS.length)];
    if (from === undefined || step === undefined) continue;
    const { x, y, z } = parseKey(from);
    const next = toKey(x + step[0], y + step[1], z + step[2]);
    if (!canPlace(next, placed, BIG_SIZE)) continue;
    placed.add(next);
    blocks.push(next);
  }

  return {
    puzzle: {
      id: 'debug-big',
      number: 0,
      tier: 3,
      size: BIG_SIZE,
      front: formatSilhouette(projectFront(placed, BIG_SIZE)),
      side: formatSilhouette(projectSide(placed, BIG_SIZE)),
      par: blocks.length,
    },
    blocks,
  };
};

export const debugSetup = (state: string | null): DebugSetup => {
  switch (state) {
    case 'solution':
      return { puzzle: TEST_PUZZLE, blocks: TEST_SOLUTION };
    case 'broken':
      // Solution plus an extra block at 1,0,0 and a floating block at 1,2,2.
      return { puzzle: TEST_PUZZLE, blocks: [...TEST_SOLUTION, '1,0,0', '1,2,2'] };
    case 'big':
      return bigSetup();
    default:
      return { puzzle: TEST_PUZZLE, blocks: [] };
  }
};
