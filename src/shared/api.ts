// Shapes of the server's JSON responses, and the checks the client runs on
// them before trusting the data.

import type { Puzzle, Size } from './puzzle';

/** Response of GET /api/puzzle/today. */
export type PuzzleResponse = {
  puzzle: Puzzle;
  /** True only in the app's dev subreddit. Unlocks the temporary debug states. */
  debug: boolean;
};

/** Largest board edge the client will draw. */
export const MAX_BOARD_EDGE = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoardEdge = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_BOARD_EDGE;

/** `rows` strings of exactly `columns` characters, each '#' or '.'. */
const parseRows = (value: unknown, rows: number, columns: number): string[] | null => {
  if (!Array.isArray(value) || value.length !== rows) return null;
  const parsed: string[] = [];
  for (const row of value) {
    if (typeof row !== 'string' || row.length !== columns || !/^[#.]*$/.test(row)) return null;
    parsed.push(row);
  }
  return parsed;
};

/**
 * Checks that an unknown value is a well-formed puzzle and returns a clean
 * copy, or null. Sizes must be whole numbers from 1 to MAX_BOARD_EDGE, `front`
 * must be h rows of w characters, `side` h rows of d characters.
 */
export const parsePuzzle = (value: unknown): Puzzle | null => {
  if (!isRecord(value) || !isRecord(value.size)) return null;
  const { id, par } = value;
  const { w, d, h } = value.size;
  if (typeof id !== 'string' || id === '') return null;
  if (!isBoardEdge(w) || !isBoardEdge(d) || !isBoardEdge(h)) return null;
  if (typeof par !== 'number' || !Number.isInteger(par) || par < 0) return null;
  const size: Size = { w, d, h };
  const front = parseRows(value.front, h, w);
  const side = parseRows(value.side, h, d);
  if (!front || !side) return null;
  return { id, size, front, side, par };
};

export const parsePuzzleResponse = (value: unknown): PuzzleResponse | null => {
  if (!isRecord(value) || typeof value.debug !== 'boolean') return null;
  const puzzle = parsePuzzle(value.puzzle);
  return puzzle ? { puzzle, debug: value.debug } : null;
};
