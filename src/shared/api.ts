// Shapes of the JSON that travels between client and server, and the checks
// each side runs on it before trusting the data.

import type { Puzzle, QueuedPuzzle, Size, Tier } from './puzzle';
import type { Stars } from './score';

// --- Types -------------------------------------------------------------------

/** A player's recorded result for one post, as shown back to that player. */
export type Submission = {
  /** Blocks in the submitted sculpture. */
  blocks: number;
  par: number;
  stars: Stars;
  /** Seconds from first opening the puzzle to submitting, when known. */
  seconds: number | null;
  /** The submitted sculpture, as "x,y,z" keys. */
  sculpture: string[];
};

/** Response of GET /api/puzzle: the puzzle for the post the client runs in. */
export type PuzzleResponse = {
  puzzle: Puzzle;
  /** False for a logged-out player, who can play but not submit. */
  canSubmit: boolean;
  /** The caller's stored result for this post, if they already submitted. */
  submission: Submission | null;
  /** True only in the app's dev subreddit. Unlocks the temporary debug states. */
  debug: boolean;
};

/** Body of POST /api/submit. */
export type SubmitRequest = { blocks: string[] };

export const SUBMIT_REJECTIONS = ['logged-out', 'malformed', 'not-solved', 'no-puzzle'] as const;
export type SubmitRejection = (typeof SUBMIT_REJECTIONS)[number];

/** Response of POST /api/submit. */
export type SubmitResponse =
  /** `accepted` the first time; `already-submitted` returns the stored result unchanged. */
  | { status: 'accepted' | 'already-submitted'; submission: Submission }
  | { status: 'rejected'; reason: SubmitRejection; message: string };

/**
 * TEMPORARY: response of GET /api/debug/puzzle/:number, which exists only in
 * the app's dev subreddit.
 */
export type DebugPuzzleResponse = {
  puzzle: Puzzle;
  /** How many puzzles the queue holds. */
  count: number;
};

/** Largest board edge the client will draw. */
export const MAX_BOARD_EDGE = 8;

// --- Small checks ------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoardEdge = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_BOARD_EDGE;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isTier = (value: unknown): value is Tier => value === 1 || value === 2 || value === 3;

const isStars = (value: unknown): value is Stars => value === 1 || value === 2 || value === 3;

const isSubmitRejection = (value: unknown): value is SubmitRejection =>
  SUBMIT_REJECTIONS.some((reason) => reason === value);

/** A block key: three whole numbers, no signs, no padding. */
const BLOCK_KEY = /^(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*)$/;

const isBlockKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((key) => typeof key === 'string' && BLOCK_KEY.test(key));

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

// --- Parsers -----------------------------------------------------------------

/**
 * Checks that an unknown value is a well-formed puzzle and returns a clean
 * copy holding only the player-facing fields, or null. Sizes must be whole
 * numbers from 1 to MAX_BOARD_EDGE, `front` must be h rows of w characters,
 * `side` h rows of d characters.
 */
export const parsePuzzle = (value: unknown): Puzzle | null => {
  if (!isRecord(value) || !isRecord(value.size)) return null;
  const { id, number, tier, par } = value;
  const { w, d, h } = value.size;
  if (typeof id !== 'string' || id === '') return null;
  if (!isCount(number) || !isTier(tier) || !isCount(par)) return null;
  if (!isBoardEdge(w) || !isBoardEdge(d) || !isBoardEdge(h)) return null;
  const size: Size = { w, d, h };
  const front = parseRows(value.front, h, w);
  const side = parseRows(value.side, h, d);
  if (!front || !side) return null;
  return { id, number, tier, size, front, side, par };
};

/** A puzzle from the generated queue file, which also carries `parIsOptimal`. */
export const parseQueuedPuzzle = (value: unknown): QueuedPuzzle | null => {
  const puzzle = parsePuzzle(value);
  if (!puzzle || !isRecord(value) || typeof value.parIsOptimal !== 'boolean') return null;
  return { ...puzzle, parIsOptimal: value.parIsOptimal };
};

export const parseSubmission = (value: unknown): Submission | null => {
  if (!isRecord(value)) return null;
  const { blocks, par, stars, seconds, sculpture } = value;
  if (!isCount(blocks) || !isCount(par) || !isStars(stars)) return null;
  if (seconds !== null && !(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)) {
    return null;
  }
  if (!isBlockKeys(sculpture)) return null;
  return { blocks, par, stars, seconds, sculpture: [...sculpture] };
};

export const parsePuzzleResponse = (value: unknown): PuzzleResponse | null => {
  if (!isRecord(value)) return null;
  const { debug, canSubmit } = value;
  if (typeof debug !== 'boolean' || typeof canSubmit !== 'boolean') return null;
  const puzzle = parsePuzzle(value.puzzle);
  if (!puzzle) return null;
  if (value.submission === null) return { puzzle, canSubmit, submission: null, debug };
  const submission = parseSubmission(value.submission);
  return submission ? { puzzle, canSubmit, submission, debug } : null;
};

/**
 * Checks the shape of a submit request: an array of "x,y,z" strings with no
 * duplicates and no more entries than the board has cells. Whether the
 * sculpture actually solves the puzzle is a separate check, with isSolved.
 */
export const parseSubmitRequest = (value: unknown, size: Size): SubmitRequest | null => {
  if (!isRecord(value) || !isBlockKeys(value.blocks)) return null;
  const { blocks } = value;
  if (blocks.length > size.w * size.d * size.h) return null;
  if (new Set(blocks).size !== blocks.length) return null;
  return { blocks: [...blocks] };
};

export const parseSubmitResponse = (value: unknown): SubmitResponse | null => {
  if (!isRecord(value)) return null;
  const { status } = value;
  if (status === 'accepted' || status === 'already-submitted') {
    const submission = parseSubmission(value.submission);
    return submission ? { status, submission } : null;
  }
  if (status === 'rejected' && isSubmitRejection(value.reason) && typeof value.message === 'string') {
    return { status, reason: value.reason, message: value.message };
  }
  return null;
};

export const parseDebugPuzzleResponse = (value: unknown): DebugPuzzleResponse | null => {
  if (!isRecord(value) || !isCount(value.count)) return null;
  const puzzle = parsePuzzle(value.puzzle);
  return puzzle ? { puzzle, count: value.count } : null;
};
