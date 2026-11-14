// Offline generator for the daily puzzle queue. Pure: no file access here, so
// tests can run it. cli.ts writes the results to disk.
//
// Every puzzle comes from a hidden seed sculpture, so it is solvable by
// construction, and everything is driven by one seeded random stream, so the
// same seed always gives the same queue.

import {
  canPlace,
  findFloating,
  formatSilhouette,
  isSolved,
  parseKey,
  parseSilhouette,
  projectFront,
  projectSide,
  toKey,
  type Grid,
} from '../shared/logic';
import type { QueuedPuzzle, Size, Tier } from '../shared/puzzle';
import { createRandom, type Random } from '../shared/random';
import { sortBlocks } from '../shared/score';
import {
  canonicalKey,
  columnSpan,
  countLit,
  countOverhangs,
  hasFlatColumns,
  isSolidRectangle,
  lowerBound,
  peakRow,
} from './analysis';

// --- Settings ----------------------------------------------------------------

export type TierSettings = {
  size: Size;
  /** Blocks in the seed sculpture, both ends included. */
  minBlocks: number;
  maxBlocks: number;
  /** Only place blocks on the floor or directly on top of another block. */
  stackOnly: boolean;
  /** Overhang cells needed across the two silhouettes. */
  minOverhangs: number;
  /** Overhang cells allowed across the two silhouettes, or null for no limit. */
  maxOverhangs: number | null;
  /** At least one silhouette must reach this row, counting the floor row as 1. */
  minPeakRow: number;
  /**
   * Par limits, both ends included. Below the range a puzzle is too slight
   * for the tier; above it there is too much tapping for a daily.
   */
  minPar: number;
  maxPar: number;
};

/** Board sizes and difficulty per tier. Change sizes here. */
export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  1: {
    size: { w: 4, d: 4, h: 4 },
    minBlocks: 8,
    maxBlocks: 12,
    stackOnly: true,
    minOverhangs: 0,
    maxOverhangs: 0,
    minPeakRow: 3,
    minPar: 6,
    maxPar: 10,
  },
  2: {
    size: { w: 5, d: 5, h: 4 },
    minBlocks: 12,
    maxBlocks: 18,
    stackOnly: false,
    minOverhangs: 1,
    maxOverhangs: null,
    minPeakRow: 3,
    minPar: 9,
    maxPar: 14,
  },
  3: {
    size: { w: 5, d: 5, h: 5 },
    minBlocks: 16,
    maxBlocks: 26,
    stackOnly: false,
    minOverhangs: 3,
    maxOverhangs: null,
    minPeakRow: 4,
    minPar: 12,
    maxPar: 18,
  },
};

/** Tier for each day of the week, Monday first. Puzzle 1 is a Monday. */
export const WEEK_PATTERN: readonly Tier[] = [1, 1, 2, 2, 3, 3, 3];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type GeneratorOptions = {
  seed: number;
  /** How many puzzles to produce. */
  count: number;
  /** Random removal orders tried when searching for par. */
  parOrders: number;
  /** Refinement steps after that: add a few blocks back, then prune again. */
  parRefinements: number;
  /** Blocks put back in each refinement step. */
  parRefinementBlocks: number;
  /** A seed sculpture starts from this many separate floor cells. */
  minStarts: number;
  maxStarts: number;
  /** How strongly growth favours a block that lights a new wall cell. 0 turns it off. */
  newShadowBias: number;
  /** Fewest lit cells a silhouette may have. */
  minLitCells: number;
  /** A silhouette must span at least the board width minus this many columns. */
  spanSlack: number;
  /** Give up on a day after this many rejected candidates. */
  maxAttempts: number;
};

export const DEFAULT_OPTIONS: GeneratorOptions = {
  seed: 20261208,
  count: 60,
  parOrders: 200,
  parRefinements: 1500,
  parRefinementBlocks: 3,
  minStarts: 2,
  maxStarts: 3,
  newShadowBias: 3,
  minLitCells: 4,
  spanSlack: 1,
  maxAttempts: 20_000,
};

// --- Results -----------------------------------------------------------------

/** Why a candidate was thrown away. Only the first failing check is counted. */
export const REJECTIONS = [
  'too few lit cells',
  'solid rectangle',
  'narrow span',
  'too low',
  'flat columns',
  'identical silhouettes',
  'overhang requirement',
  'duplicate',
  'par too low',
  'par too high',
] as const;
export type Rejection = (typeof REJECTIONS)[number];

export type GeneratedPuzzle = {
  puzzle: QueuedPuzzle;
  lowerBound: number;
  /** The hidden sculpture the silhouettes were taken from. Never sent to players. */
  seed: string[];
  /** A sculpture with `par` blocks that solves the puzzle. Never sent to players. */
  parSolution: string[];
};

export type TierReport = {
  accepted: number;
  candidates: number;
  rejected: Record<Rejection, number>;
};

export type Generation = {
  puzzles: GeneratedPuzzle[];
  report: Record<Tier, TierReport>;
};

// --- Growing a seed sculpture --------------------------------------------------

const ALL_STEPS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/** Picks an index with probability proportional to its weight. */
const pickWeighted = (weights: readonly number[], random: Random): number => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random.next() * total;
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index] ?? 0;
    if (roll < 0) return index;
  }
  return weights.length - 1;
};

/** A few floor cells spread apart: no two side by side or diagonal neighbours. */
const pickStarts = (size: Size, count: number, random: Random): string[] => {
  const starts: { x: number; z: number }[] = [];
  for (let attempt = 0; starts.length < count && attempt < 200; attempt++) {
    const x = random.int(size.w);
    const z = random.int(size.d);
    const apart = starts.every((other) => Math.max(Math.abs(other.x - x), Math.abs(other.z - z)) >= 2);
    if (apart) starts.push({ x, z });
  }
  return starts.map(({ x, z }) => toKey(x, 0, z));
};

/**
 * Grows a sculpture one block at a time. Every new block sits on the floor
 * beside the sculpture or touches an existing block face to face, so nothing
 * ever floats. Growth favours blocks that light a wall cell not yet lit, which
 * spreads the shadows out instead of piling up one lump.
 */
export const growSeed = (settings: TierSettings, options: GeneratorOptions, random: Random): string[] => {
  const { size } = settings;
  const target = random.between(settings.minBlocks, settings.maxBlocks);
  const placed = new Set(pickStarts(size, random.between(options.minStarts, options.maxStarts), random));
  const litFront = new Set<string>();
  const litSide = new Set<string>();
  const light = (key: string): void => {
    const { x, y, z } = parseKey(key);
    litFront.add(`${x},${y}`);
    litSide.add(`${z},${y}`);
  };
  for (const key of placed) light(key);

  while (placed.size < target) {
    const candidates = new Set<string>();
    for (const key of placed) {
      const { x, y, z } = parseKey(key);
      for (const [dx, dy, dz] of ALL_STEPS) {
        // Tier 1 only stacks: sideways moves are allowed on the floor alone.
        if (settings.stackOnly && (dy < 0 || (dy === 0 && y > 0))) continue;
        const next = toKey(x + dx, y + dy, z + dz);
        if (canPlace(next, placed, size)) candidates.add(next);
      }
    }
    const options_ = [...candidates];
    if (options_.length === 0) break;
    const weights = options_.map((key) => {
      const { x, y, z } = parseKey(key);
      const newCells = (litFront.has(`${x},${y}`) ? 0 : 1) + (litSide.has(`${z},${y}`) ? 0 : 1);
      return 1 + options.newShadowBias * newCells;
    });
    const chosen = options_[pickWeighted(weights, random)];
    if (chosen === undefined) break;
    placed.add(chosen);
    light(chosen);
  }
  return [...placed];
};

// --- Par ---------------------------------------------------------------------

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
 * not a proof, unless it reaches the lower bound.
 */
const findPar = (
  seed: readonly string[],
  front: Grid,
  side: Grid,
  size: Size,
  bound: number,
  options: GeneratorOptions,
  random: Random
): string[] => {
  // Pruning the seed first guarantees par is never above the seed's size.
  let best = prune(seed, random);
  const largest = largestSculpture(front, side, size);
  for (let order = 0; order < options.parOrders && best.length > bound; order++) {
    const pruned = prune(largest, random);
    if (pruned.length < best.length) best = pruned;
  }

  // Refinement: put a few removed blocks back and prune again. A result that
  // is no bigger becomes the new starting point, so the search can walk
  // sideways out of a dead end that plain pruning cannot leave.
  let current = best;
  for (let step = 0; step < options.parRefinements && best.length > bound; step++) {
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

// --- Building and filtering a candidate ----------------------------------------

/** The first cheap check a candidate fails, or null. Par is checked afterwards. */
const shapeRejection = (
  front: Grid,
  side: Grid,
  frontRows: readonly string[],
  sideRows: readonly string[],
  settings: TierSettings,
  options: GeneratorOptions,
  seen: ReadonlySet<string>
): Rejection | null => {
  const { size } = settings;
  if (countLit(front) < options.minLitCells || countLit(side) < options.minLitCells) {
    return 'too few lit cells';
  }
  if (isSolidRectangle(front) || isSolidRectangle(side)) return 'solid rectangle';
  if (
    columnSpan(front) < size.w - options.spanSlack ||
    columnSpan(side) < size.d - options.spanSlack
  ) {
    return 'narrow span';
  }
  if (Math.max(peakRow(front), peakRow(side)) < settings.minPeakRow) return 'too low';
  if (hasFlatColumns(front) || hasFlatColumns(side)) return 'flat columns';
  if (frontRows.join('/') === sideRows.join('/')) return 'identical silhouettes';
  const overhangs = countOverhangs(front) + countOverhangs(side);
  if (
    overhangs < settings.minOverhangs ||
    (settings.maxOverhangs !== null && overhangs > settings.maxOverhangs)
  ) {
    return 'overhang requirement';
  }
  if (seen.has(canonicalKey(frontRows, sideRows))) return 'duplicate';
  return null;
};

const emptyReport = (): TierReport => ({
  accepted: 0,
  candidates: 0,
  rejected: {
    'too few lit cells': 0,
    'solid rectangle': 0,
    'narrow span': 0,
    'too low': 0,
    'flat columns': 0,
    'identical silhouettes': 0,
    'overhang requirement': 0,
    'duplicate': 0,
    'par too low': 0,
    'par too high': 0,
  },
});

export const tierForNumber = (number: number): Tier => WEEK_PATTERN[(number - 1) % 7] ?? 1;

/** Generates puzzles 1 to `count`. A shorter run gives a prefix of a longer one. */
export const generateQueue = (overrides: Partial<GeneratorOptions> = {}): Generation => {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const random = createRandom(options.seed);
  const seen = new Set<string>();
  const puzzles: GeneratedPuzzle[] = [];
  const report: Record<Tier, TierReport> = { 1: emptyReport(), 2: emptyReport(), 3: emptyReport() };

  for (let number = 1; number <= options.count; number++) {
    const tier = tierForNumber(number);
    const settings = TIER_SETTINGS[tier];
    const { size } = settings;
    const tally = report[tier];
    let accepted: GeneratedPuzzle | null = null;

    for (let attempt = 0; attempt < options.maxAttempts && !accepted; attempt++) {
      tally.candidates += 1;
      const seed = growSeed(settings, options, random);
      const seedBlocks = new Set(seed);
      const front = projectFront(seedBlocks, size);
      const side = projectSide(seedBlocks, size);
      const frontRows = formatSilhouette(front);
      const sideRows = formatSilhouette(side);

      const rejection = shapeRejection(front, side, frontRows, sideRows, settings, options, seen);
      if (rejection) {
        tally.rejected[rejection] += 1;
        continue;
      }

      const bound = lowerBound(front, side);
      // The par search gets its own random stream, so changing how hard it
      // searches does not change which puzzles come next.
      const parRandom = createRandom(random.int(2 ** 31));
      const parSolution = findPar(seed, front, side, size, bound, options, parRandom);
      if (parSolution.length < settings.minPar) {
        tally.rejected['par too low'] += 1;
        continue;
      }
      if (parSolution.length > settings.maxPar) {
        tally.rejected['par too high'] += 1;
        continue;
      }

      const puzzle: QueuedPuzzle = {
        id: `ts-${String(number).padStart(4, '0')}`,
        number,
        tier,
        size,
        front: frontRows,
        side: sideRows,
        par: parSolution.length,
        parIsOptimal: parSolution.length === bound,
      };
      // Solvable by construction, but check anyway: a broken puzzle must
      // never reach the queue.
      if (!isSolved(seedBlocks, puzzle) || !isSolved(new Set(parSolution), puzzle)) {
        throw new Error(`Puzzle ${number}: seed or par solution does not solve it`);
      }
      seen.add(canonicalKey(frontRows, sideRows));
      accepted = {
        puzzle,
        lowerBound: bound,
        seed: sortBlocks(seed),
        parSolution: sortBlocks(parSolution),
      };
    }

    if (!accepted) {
      throw new Error(`Puzzle ${number}: no candidate passed after ${options.maxAttempts} attempts`);
    }
    tally.accepted += 1;
    puzzles.push(accepted);
  }
  return { puzzles, report };
};

// --- Text output ---------------------------------------------------------------

/** One puzzle as text: a header line, then both silhouettes side by side. */
export const previewPuzzle = ({ puzzle, lowerBound: bound, seed }: GeneratedPuzzle): string => {
  const { number, tier, size, par, parIsOptimal, front, side } = puzzle;
  const day = WEEKDAYS[(number - 1) % 7] ?? '';
  const header =
    `#${number}  ${day}  tier ${tier}  ${size.w}x${size.d}x${size.h}  ` +
    `par ${par}  lower bound ${bound}${parIsOptimal ? '  (optimal)' : ''}  seed ${seed.length} blocks`;
  const gap = '    ';
  const titles = 'front'.padEnd(Math.max(size.w, 5)) + gap + 'side';
  const rows = front.map((row, index) => row.padEnd(Math.max(size.w, 5)) + gap + (side[index] ?? ''));
  return [header, titles, ...rows].join('\n');
};

export const previewQueue = (puzzles: readonly GeneratedPuzzle[]): string =>
  puzzles.map(previewPuzzle).join('\n\n') + '\n';

/** Re-derives a puzzle's two target grids, for checks on stored data. */
export const targetGrids = (puzzle: Pick<QueuedPuzzle, 'front' | 'side'>): { front: Grid; side: Grid } => ({
  front: parseSilhouette(puzzle.front),
  side: parseSilhouette(puzzle.side),
});
