// Known solutions for queue puzzles, for tests only. Read from the generator's
// records with the file system, never imported, so they cannot be bundled.

import { readFileSync } from 'node:fs';
import { findFloating, isSolved, parseSilhouette, toKey } from '../../shared/logic';
import type { Puzzle } from '../../shared/puzzle';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const readSolutions = (): unknown[] => {
  const all: unknown = JSON.parse(readFileSync('src/generator/data/solutions.json', 'utf8'));
  if (!Array.isArray(all)) throw new Error('solutions.json is not an array');
  return all;
};

/** The generator's par solution for the queue puzzle with this number. */
export const parSolution = (number: number): string[] => {
  const entry: unknown = readSolutions()[number - 1];
  if (typeof entry !== 'object' || entry === null || !('parSolution' in entry)) {
    throw new Error(`No solution for puzzle ${number}`);
  }
  const { parSolution: blocks } = entry;
  if (!isStringArray(blocks)) throw new Error(`Bad solution for puzzle ${number}`);
  return blocks;
};

/** Cells that could hold a block without changing either shadow. */
const shadowNeutralCells = (puzzle: Puzzle, used: ReadonlySet<string>): string[] => {
  const front = parseSilhouette(puzzle.front);
  const side = parseSilhouette(puzzle.side);
  const cells: string[] = [];
  for (let y = 0; y < puzzle.size.h; y++) {
    for (let x = 0; x < puzzle.size.w; x++) {
      for (let z = 0; z < puzzle.size.d; z++) {
        const key = toKey(x, y, z);
        if (!used.has(key) && front[y]?.[x] && side[y]?.[z]) cells.push(key);
      }
    }
  }
  return cells;
};

/**
 * A valid solution with exactly `blocks` blocks: the par solution plus extra
 * blocks that leave both shadows alone and connect to the floor.
 */
export const solutionWith = (puzzle: Puzzle, blocks: number): string[] => {
  const built = new Set(parSolution(puzzle.number));
  while (built.size < blocks) {
    const extra = shadowNeutralCells(puzzle, built).find(
      (key) => findFloating(new Set([...built, key])).length === 0
    );
    if (!extra) throw new Error(`Puzzle ${puzzle.number} has no valid solution with ${blocks} blocks`);
    built.add(extra);
  }
  if (built.size !== blocks || !isSolved(built, puzzle)) {
    throw new Error(`Could not build a ${blocks}-block solution for puzzle ${puzzle.number}`);
  }
  return [...built];
};

/**
 * A sculpture that casts both target shadows but has exactly one floating
 * block: the par solution plus one block that touches nothing.
 */
export const floatingVariant = (puzzle: Puzzle): string[] | null => {
  const solution = parSolution(puzzle.number);
  for (const key of shadowNeutralCells(puzzle, new Set(solution))) {
    const floating = findFloating(new Set([...solution, key]));
    if (floating.length === 1 && floating[0] === key) return [...solution, key];
  }
  return null;
};
