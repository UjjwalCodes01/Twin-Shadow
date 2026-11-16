import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePuzzle, parseQueuedPuzzle } from '../shared/api';
import { findFloating, isSolved } from '../shared/logic';
import type { QueuedPuzzle } from '../shared/puzzle';
import { canonicalKey, countOverhangs, lowerBound, peakRow } from '../shared/analysis';
import { COMMUNITY_BOARDS } from '../shared/community';
import { PREVIEW_PATH, PUZZLES_PATH, SOLUTIONS_PATH, puzzlesJson, solutionsJson } from './cli';
import {
  DEFAULT_OPTIONS,
  TIER_SETTINGS,
  generateQueue,
  previewQueue,
  targetGrids,
  tierForNumber,
} from './generate';

// The files `npm run generate` wrote, as committed.
type Solution = { number: number; lowerBound: number; seed: string[]; parSolution: string[] };

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const readArray = (path: string): unknown[] => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not an array`);
  return parsed;
};

const parseSolution = (value: unknown): Solution => {
  if (typeof value !== 'object' || value === null) throw new Error('Solution is not an object');
  if (!('number' in value) || !('lowerBound' in value) || !('seed' in value) || !('parSolution' in value)) {
    throw new Error('Solution is missing a field');
  }
  const { number, lowerBound: bound, seed, parSolution } = value;
  if (typeof number !== 'number' || typeof bound !== 'number') throw new Error('Bad numbers');
  if (!isStringArray(seed) || !isStringArray(parSolution)) throw new Error('Bad block lists');
  return { number, lowerBound: bound, seed, parSolution };
};

const rawPuzzles = readArray(PUZZLES_PATH);
const puzzles: QueuedPuzzle[] = rawPuzzles.map((raw, index) => {
  const puzzle = parseQueuedPuzzle(raw);
  if (!puzzle) throw new Error(`Puzzle at index ${index} fails validation`);
  return puzzle;
});
const solutions = readArray(SOLUTIONS_PATH).map(parseSolution);
const solutionFor = (puzzle: QueuedPuzzle): Solution => {
  const solution = solutions[puzzle.number - 1];
  if (!solution || solution.number !== puzzle.number) {
    throw new Error(`No solution stored for puzzle ${puzzle.number}`);
  }
  return solution;
};

describe('the committed queue', () => {
  it('holds the configured number of puzzles, numbered from 1', () => {
    expect(puzzles).toHaveLength(DEFAULT_OPTIONS.count);
    expect(solutions).toHaveLength(DEFAULT_OPTIONS.count);
    expect(puzzles.map((puzzle) => puzzle.number)).toEqual(puzzles.map((_, index) => index + 1));
  });

  it('passes the validation the client uses', () => {
    expect(puzzles).toEqual(rawPuzzles);
    for (const raw of rawPuzzles) {
      const forPlayers = parsePuzzle(raw);
      expect(forPlayers).not.toBeNull();
      // The player-facing copy drops the developer-only note.
      expect(forPlayers).not.toHaveProperty('parIsOptimal');
    }
  });

  it('follows the weekly tier pattern and each tier`s board size', () => {
    const firstWeek = puzzles.slice(0, 7).map((puzzle) => puzzle.tier);
    expect(firstWeek).toEqual([1, 1, 2, 2, 3, 3, 3]);
    for (const puzzle of puzzles) {
      expect(puzzle.tier).toBe(tierForNumber(puzzle.number));
      expect(puzzle.size).toEqual(TIER_SETTINGS[puzzle.tier].size);
    }
  });

  it('is solved by every stored seed sculpture', () => {
    for (const puzzle of puzzles) {
      const { seed } = solutionFor(puzzle);
      expect(isSolved(new Set(seed), puzzle), `seed of puzzle ${puzzle.number}`).toBe(true);
    }
  });

  it('is solved by every stored par solution, which has exactly par blocks', () => {
    for (const puzzle of puzzles) {
      const { parSolution } = solutionFor(puzzle);
      expect(new Set(parSolution).size).toBe(puzzle.par);
      expect(findFloating(new Set(parSolution))).toEqual([]);
      expect(isSolved(new Set(parSolution), puzzle), `par of puzzle ${puzzle.number}`).toBe(true);
    }
  });

  it('never has par below the lower bound or above the seed`s block count', () => {
    for (const puzzle of puzzles) {
      const { seed, lowerBound: stored } = solutionFor(puzzle);
      const { front, side } = targetGrids(puzzle);
      expect(stored).toBe(lowerBound(front, side));
      expect(puzzle.par).toBeGreaterThanOrEqual(stored);
      expect(puzzle.par).toBeLessThanOrEqual(seed.length);
      expect(puzzle.parIsOptimal).toBe(puzzle.par === stored);
    }
  });

  it('meets each tier`s block count, overhang, height and par rules', () => {
    for (const puzzle of puzzles) {
      const settings = TIER_SETTINGS[puzzle.tier];
      const { front, side } = targetGrids(puzzle);
      const overhangs = countOverhangs(front) + countOverhangs(side);
      const seedSize = solutionFor(puzzle).seed.length;
      expect(seedSize).toBeGreaterThanOrEqual(settings.minBlocks);
      expect(seedSize).toBeLessThanOrEqual(settings.maxBlocks);
      expect(overhangs).toBeGreaterThanOrEqual(settings.minOverhangs);
      if (settings.maxOverhangs !== null) expect(overhangs).toBeLessThanOrEqual(settings.maxOverhangs);
      expect(puzzle.par).toBeGreaterThanOrEqual(settings.minPar);
      expect(puzzle.par).toBeLessThanOrEqual(settings.maxPar);
      expect(Math.max(peakRow(front), peakRow(side))).toBeGreaterThanOrEqual(settings.minPeakRow);
    }
  });

  it('has no duplicates, counting swapped and mirrored pairs as the same', () => {
    const keys = puzzles.map((puzzle) => canonicalKey(puzzle.front, puzzle.side));
    expect(new Set(keys).size).toBe(puzzles.length);
  });
});

describe('generateQueue', () => {
  // One week covers all three tiers and keeps the test quick.
  const WEEK = 7;

  it('gives identical output for the same seed, matching the committed files', () => {
    const first = generateQueue({ count: WEEK });
    const second = generateQueue({ count: WEEK });
    expect(puzzlesJson(second.puzzles)).toBe(puzzlesJson(first.puzzles));
    expect(solutionsJson(second.puzzles)).toBe(solutionsJson(first.puzzles));

    // A short run is a prefix of the full one, so it must match what is on disk.
    expect(first.puzzles.map((generated) => generated.puzzle)).toEqual(puzzles.slice(0, WEEK));
    expect(first.puzzles.map((generated) => generated.seed)).toEqual(
      solutions.slice(0, WEEK).map((solution) => solution.seed)
    );
    expect(first.puzzles.map((generated) => generated.parSolution)).toEqual(
      solutions.slice(0, WEEK).map((solution) => solution.parSolution)
    );
    const preview = readFileSync(PREVIEW_PATH, 'utf8');
    expect(preview.startsWith(previewQueue(first.puzzles).trimEnd())).toBe(true);
  }, 120_000);

  it('gives a different queue for a different seed', () => {
    const other = generateQueue({ count: 2, seed: DEFAULT_OPTIONS.seed + 1 });
    expect(other.puzzles.map((generated) => generated.puzzle)).not.toEqual(puzzles.slice(0, 2));
  }, 120_000);
});

describe('the boards players make puzzles on', () => {
  it('take their limits from the generated puzzles of the same size', () => {
    for (const board of COMMUNITY_BOARDS) {
      const tier = TIER_SETTINGS[board.tier];
      expect(tier.size).toEqual(board.size);
      expect([board.minPeakRow, board.minPar, board.maxPar]).toEqual([tier.minPeakRow, tier.minPar, tier.maxPar]);
    }
  });
});
