// The par search: the smallest sculpture that can be found casting a given
// pair of shadows. Used offline by the puzzle generator, and by the server on
// a puzzle a player has made, where it runs against a time limit.
//
// Everything is driven by the random stream it is given, so the same stream
// always gives the same answer when no time limit cuts it short.

import { findFloating, parseKey, toKey, type Grid } from './logic';
import type { Size } from './puzzle';
import type { Random } from './random';

/** How hard to search. */
export type ParOptions = {
  /** Random removal orders tried on the largest sculpture. */
  parOrders: number;
  /** Refinement steps after that: add a few blocks back, then prune again. */
  parRefinements: number;
  /** Blocks put back in each refinement step. */
  parRefinementBlocks: number;
};

/**
 * A time limit on the search: it stops, keeping the best found so far, once
 * `now()` reaches `until`. Without one the search always runs to the end.
 */
export type ParDeadline = { until: number; now: () => number };

const ALL_STEPS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/**
 * The largest sculpture that casts exactly these shadows: every cell lit on
 * both walls, minus anything not connected to the floor.
 */
export const largestSculpture = (front: Grid, side: Grid, size: Size): string[] => {
  const blocks = new Set<string>();
  for (let y = 0; y < size.h; y++) {
    for (let x = 0; x < size.w; x++) {
      if (!front[y]?.[x]) continue;
      for (let z = 0; z < size.d; z++) {
        if (side[y]?.[z]) blocks.add(toKey(x, y, z));
      }
    }
  }
  for (const key of findFloating(blocks)) blocks.delete(key);
  return [...blocks];
};

/** True when no other block can depend on this one to reach the floor. */
const isLooseEnd = (key: string, others: ReadonlySet<string>): boolean => {
  const { x, y, z } = parseKey(key);
  let neighbours = 0;
  for (const [dx, dy, dz] of ALL_STEPS) {
    if (others.has(toKey(x + dx, y + dy, z + dz))) neighbours += 1;
  }
  return neighbours === 0 || (y > 0 && neighbours === 1);
};

/**
 * Removes blocks in random order for as long as both shadows stay complete
 * and nothing floats. Stops when no block can go.
 */
const prune = (start: readonly string[], random: Random): string[] => {
  const blocks = new Set(start);
  const frontCover = new Map<string, number>();
  const sideCover = new Map<string, number>();
  const cells = (key: string): { front: string; side: string } => {
    const { x, y, z } = parseKey(key);
    return { front: `${x},${y}`, side: `${z},${y}` };
  };
  for (const key of blocks) {
    const { front, side } = cells(key);
    frontCover.set(front, (frontCover.get(front) ?? 0) + 1);
    sideCover.set(side, (sideCover.get(side) ?? 0) + 1);
  }

  let removedAny = true;
  while (removedAny) {
    removedAny = false;
    for (const key of random.shuffle([...blocks])) {
      const { front, side } = cells(key);
      const frontCount = frontCover.get(front) ?? 0;
      const sideCount = sideCover.get(side) ?? 0;
      // The last block lighting a wall cell has to stay.
      if (frontCount <= 1 || sideCount <= 1) continue;
      blocks.delete(key);
      // A block above the floor with at most one neighbour holds nothing up,
      // so the full connectivity check is only needed for the others.
      if (!isLooseEnd(key, blocks) && findFloating(blocks).length > 0) {
        blocks.add(key);
        continue;
      }
      frontCover.set(front, frontCount - 1);
      sideCover.set(side, sideCount - 1);
      removedAny = true;
    }
  }
  return [...blocks];
};

/**
 * The smallest solution found: the seed pruned once, the largest sculpture
 * pruned in many random orders, then a refinement pass. A strong estimate,
 * not a proof, unless it reaches the lower bound `bound`.
 *
 * `seed` must cast exactly the shadows `front` and `side` with nothing
 * floating. With a `deadline` the search stops when time is up and returns
 * the best it has; the seed is always pruned once first, so there is always
 * an answer, and it is never larger than the seed.
 */
export const findPar = (
  seed: readonly string[],
  front: Grid,
  side: Grid,
  size: Size,
  bound: number,
  options: ParOptions,
  random: Random,
  deadline?: ParDeadline
): string[] => {
  const timeUp = (): boolean => deadline !== undefined && deadline.now() >= deadline.until;

  // Pruning the seed first guarantees par is never above the seed's size.
  let best = prune(seed, random);
  const largest = largestSculpture(front, side, size);
  for (let order = 0; order < options.parOrders && best.length > bound && !timeUp(); order++) {
    const pruned = prune(largest, random);
    if (pruned.length < best.length) best = pruned;
  }

  // Refinement: put a few removed blocks back and prune again. A result that
  // is no bigger becomes the new starting point, so the search can walk
  // sideways out of a dead end that plain pruning cannot leave.
  let current = best;
  for (let step = 0; step < options.parRefinements && best.length > bound && !timeUp(); step++) {
    const inUse = new Set(current);
    const spare = random.shuffle(largest.filter((key) => !inUse.has(key)));
    const widened = new Set([...current, ...spare.slice(0, options.parRefinementBlocks)]);
    // A block put back may touch nothing; pruning must start with none floating.
    for (const key of findFloating(widened)) widened.delete(key);
    const pruned = prune([...widened], random);
    if (pruned.length <= current.length) current = pruned;
    if (current.length < best.length) best = current;
  }
  return best;
};
