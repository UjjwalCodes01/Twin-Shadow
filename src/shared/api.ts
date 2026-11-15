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

/** One line of a post's leaderboard. */
export type LeaderboardRow = {
  /** 1 for the fewest blocks. Players with the same block count share a rank. */
  rank: number;
  username: string;
  blocks: number;
  /** True on the caller's own row. */
  you: boolean;
};

/** Everything the result card shows for one player on one post. */
export type Result = {
  blocks: number;
  par: number;
  stars: Stars;
  rank: number;
  /** How many players hold that rank, the caller included. */
  tied: number;
  /** How many players have submitted for this post. */
  solvers: number;
  /** The first rows of the leaderboard, best first. */
  leaderboard: LeaderboardRow[];
  /** The caller's row when it is not among `leaderboard`, otherwise null. */
  own: LeaderboardRow | null;
  /** The fewest blocks anyone has submitted for this post so far. */
  record: { blocks: number; underPar: boolean };
  rarity: {
    /** Solvers who built exactly this sculpture, the caller included. */
    same: number;
    /** `same` as a share of all solvers, from 0 to 1. */
    share: number;
    /** True when there are too few solvers for the share to mean anything. */
    smallSample: boolean;
  };
  /** Daily puzzles in a row. `current` is 0 once the latest finished one was missed. */
  streak: { current: number; best: number };
  /** True once the caller has shared this result as a comment on the post. */
  shared: boolean;
  /** True while the caller has not yet answered the "Join the community" prompt. */
  joinPrompt: boolean;
};

/** Response of GET /api/result. Only a player who has submitted gets the data. */
export type ResultResponse =
  | { status: 'ok'; result: Result }
  | { status: 'not-submitted'; message: string };

/**
 * Response of POST /api/share. `shared` the first time; `already-shared`
 * changes nothing. `failed` means no comment was posted and the player may
 * try again.
 */
export type ShareResponse =
  | { status: 'shared' | 'already-shared' }
  | { status: 'not-submitted' | 'failed'; message: string };

export const JOIN_CHOICES = ['join', 'dismiss'] as const;
/** The player's answer to the "Join the community" prompt. */
export type JoinChoice = (typeof JOIN_CHOICES)[number];

/** Body of POST /api/join. */
export type JoinRequest = { choice: JoinChoice };

/** Response of POST /api/join. `failed` means the answer was not recorded. */
export type JoinResponse = { status: 'ok' } | { status: 'failed'; message: string };

export const GALLERY_SORTS = ['rarest', 'leanest'] as const;
/** 'rarest': fewest builders first. 'leanest': fewest blocks first. */
export type GallerySort = (typeof GALLERY_SORTS)[number];

/** One distinct sculpture players have submitted for a post. */
export type GalleryEntry = {
  /** A short name for the sculpture, the same for everyone who built it. */
  id: string;
  blocks: number;
  /** How many players submitted exactly this sculpture. */
  builders: number;
  /** The first player to submit it. */
  first: string;
  /** The sculpture, as "x,y,z" keys. */
  sculpture: string[];
  /** True on the sculpture the caller submitted. */
  yours: boolean;
};

/** One page of a post's gallery. */
export type Gallery = {
  sort: GallerySort;
  /** This page, from 1. */
  page: number;
  /** How many pages there are, at least 1. */
  pages: number;
  /** How many distinct sculptures the gallery holds. */
  total: number;
  entries: GalleryEntry[];
};

/** Response of GET /api/gallery. Like the result, only for a player who has submitted. */
export type GalleryResponse =
  | { status: 'ok'; gallery: Gallery }
  | { status: 'not-submitted'; message: string };

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

export const isGallerySort = (value: unknown): value is GallerySort =>
  GALLERY_SORTS.some((sort) => sort === value);

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
  const { blocks, par, stars, sculpture } = value;
  if (!isCount(blocks) || !isCount(par) || !isStars(stars)) return null;
  if (!isBlockKeys(sculpture)) return null;
  return { blocks, par, stars, sculpture: [...sculpture] };
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

const parseLeaderboardRow = (value: unknown): LeaderboardRow | null => {
  if (!isRecord(value)) return null;
  const { rank, username, blocks, you } = value;
  if (!isCount(rank) || rank < 1 || !isCount(blocks)) return null;
  if (typeof username !== 'string' || typeof you !== 'boolean') return null;
  return { rank, username, blocks, you };
};

const parseResult = (value: unknown): Result | null => {
  if (!isRecord(value)) return null;
  const { blocks, par, stars, rank, tied, solvers, leaderboard, record, rarity, streak } = value;
  if (!isCount(blocks) || !isCount(par) || !isStars(stars)) return null;
  if (!isCount(rank) || rank < 1 || !isCount(tied) || tied < 1 || !isCount(solvers) || solvers < 1) return null;

  if (!Array.isArray(leaderboard)) return null;
  const rows: LeaderboardRow[] = [];
  for (const entry of leaderboard) {
    const row = parseLeaderboardRow(entry);
    if (!row) return null;
    rows.push(row);
  }
  const own = value.own === null ? null : parseLeaderboardRow(value.own);
  if (value.own !== null && !own) return null;

  if (!isRecord(record) || !isCount(record.blocks) || typeof record.underPar !== 'boolean') return null;
  if (!isRecord(rarity) || !isCount(rarity.same) || typeof rarity.smallSample !== 'boolean') return null;
  const { share } = rarity;
  if (typeof share !== 'number' || !(share >= 0 && share <= 1)) return null;
  if (!isRecord(streak) || !isCount(streak.current) || !isCount(streak.best)) return null;
  const { shared, joinPrompt } = value;
  if (typeof shared !== 'boolean' || typeof joinPrompt !== 'boolean') return null;

  return {
    blocks,
    par,
    stars,
    rank,
    tied,
    solvers,
    leaderboard: rows,
    own,
    record: { blocks: record.blocks, underPar: record.underPar },
    rarity: { same: rarity.same, share, smallSample: rarity.smallSample },
    streak: { current: streak.current, best: streak.best },
    shared,
    joinPrompt,
  };
};

export const parseResultResponse = (value: unknown): ResultResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'not-submitted' && typeof value.message === 'string') {
    return { status: 'not-submitted', message: value.message };
  }
  if (value.status !== 'ok') return null;
  const result = parseResult(value.result);
  return result ? { status: 'ok', result } : null;
};

export const parseShareResponse = (value: unknown): ShareResponse | null => {
  if (!isRecord(value)) return null;
  const { status, message } = value;
  if (status === 'shared' || status === 'already-shared') return { status };
  if ((status === 'not-submitted' || status === 'failed') && typeof message === 'string') return { status, message };
  return null;
};

export const parseJoinRequest = (value: unknown): JoinRequest | null => {
  if (!isRecord(value)) return null;
  const choice = JOIN_CHOICES.find((known) => known === value.choice);
  return choice ? { choice } : null;
};

export const parseJoinResponse = (value: unknown): JoinResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'ok') return { status: 'ok' };
  if (value.status === 'failed' && typeof value.message === 'string') return { status: 'failed', message: value.message };
  return null;
};

const parseGalleryEntry = (value: unknown): GalleryEntry | null => {
  if (!isRecord(value)) return null;
  const { id, blocks, builders, first, sculpture, yours } = value;
  if (typeof id !== 'string' || id === '' || typeof first !== 'string' || typeof yours !== 'boolean') return null;
  if (!isCount(blocks) || !isCount(builders) || builders < 1) return null;
  if (!isBlockKeys(sculpture)) return null;
  return { id, blocks, builders, first, sculpture: [...sculpture], yours };
};

export const parseGalleryResponse = (value: unknown): GalleryResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'not-submitted' && typeof value.message === 'string') {
    return { status: 'not-submitted', message: value.message };
  }
  if (value.status !== 'ok' || !isRecord(value.gallery)) return null;
  const { sort, page, pages, total, entries } = value.gallery;
  if (!isGallerySort(sort) || !isCount(page) || page < 1 || !isCount(pages) || pages < 1) return null;
  if (!isCount(total) || !Array.isArray(entries)) return null;
  const parsed: GalleryEntry[] = [];
  for (const entry of entries) {
    const row = parseGalleryEntry(entry);
    if (!row) return null;
    parsed.push(row);
  }
  return { status: 'ok', gallery: { sort, page, pages, total, entries: parsed } };
};

export const parseDebugPuzzleResponse = (value: unknown): DebugPuzzleResponse | null => {
  if (!isRecord(value) || !isCount(value.count)) return null;
  const puzzle = parsePuzzle(value.puzzle);
  return puzzle ? { puzzle, count: value.count } : null;
};
