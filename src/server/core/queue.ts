import { parsePuzzle, parseQueuedPuzzle } from '../../shared/api';
import type { Puzzle, QueuedPuzzle } from '../../shared/puzzle';
// Written by `npm run generate`. Holds silhouettes and par only: the seed
// sculptures and par solutions live in src/generator/data and are never
// imported here.
import generated from '../data/puzzles.json';

/** The daily puzzles in order, as stored. Puzzle number n is at index n - 1. */
export const QUEUE: readonly QueuedPuzzle[] = generated.map((entry, index) => {
  const puzzle = parseQueuedPuzzle(entry);
  if (!puzzle || puzzle.number !== index + 1) {
    throw new Error(`puzzles.json entry ${index + 1} is not a valid puzzle`);
  }
  return puzzle;
});

// The copies sent to players. parsePuzzle keeps the player-facing fields
// only, so developer notes such as parIsOptimal never leave the server.
const FOR_PLAYERS: readonly Puzzle[] = QUEUE.flatMap((entry) => {
  const puzzle = parsePuzzle(entry);
  return puzzle ? [puzzle] : [];
});

/** The player-facing puzzle with this number, if the queue has one. */
export const puzzleByNumber = (number: number): Puzzle | undefined =>
  Number.isInteger(number) ? FOR_PLAYERS[number - 1] : undefined;
