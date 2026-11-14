import { parsePuzzle } from '../../shared/api';
import type { Puzzle } from '../../shared/puzzle';
// Written by `npm run generate`. Holds silhouettes and par only: the seed
// sculptures and par solutions live in src/generator/data and are never
// imported here.
import generated from '../data/puzzles.json';

/** The daily puzzles in order. Puzzle number n is at index n - 1. */
export const QUEUE: readonly Puzzle[] = generated.map((entry, index) => {
  const puzzle = parsePuzzle(entry);
  if (!puzzle || puzzle.number !== index + 1) {
    throw new Error(`puzzles.json entry ${index + 1} is not a valid puzzle`);
  }
  return puzzle;
});

export const puzzleByNumber = (number: number): Puzzle | undefined =>
  Number.isInteger(number) ? QUEUE[number - 1] : undefined;
