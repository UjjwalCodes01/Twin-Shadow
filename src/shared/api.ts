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
  /** What a first-time player has still to be shown. Both true for a logged-out visitor. */
  onboarding: Onboarding;
  /** The N in the post's title, "Twin Shadows #N". */
  post: number;
  /** The username of the player who made this puzzle, or null for a generated one. */
  maker: string | null;
  /** True when the caller made this puzzle: they can look at its results, but are never ranked on it. */
  yours: boolean;
  /** What the caller may do about puzzles made by players. */
  community: CommunityStatus;
  /** Whether the caller has turned sound off. False for a logged-out visitor, whose device remembers instead. */
  muted: boolean;
};

/**
 * What became of the last puzzle a player sent: it waits for review, it was
 * approved and is in line for a Sunday, it was used for the daily post of
 * `date` (UTC, YYYY-MM-DD), or it was not approved. No reason is ever given.
 */
export type LastPuzzle = { status: 'waiting' | 'approved' | 'rejected' } | { status: 'used'; date: string };

/** What the caller may do about puzzles made by players. */
export type CommunityStatus = {
  /** Whether the caller may make and send a puzzle now. */
  canMake: boolean;
  /** Why not, in a sentence for the player, or null when they may. */
  why: string | null;
  /** What became of the last puzzle the caller sent, or null when they have sent none. */
  last: LastPuzzle | null;
  /** For a moderator of this community: how many puzzles wait for review. Null for everyone else. */
  review: number | null;
};

/** Body of POST /api/community/puzzles: the sculpture whose shadows become the puzzle. */
export type MakePuzzleRequest = { size: Size; blocks: string[] };

/**
 * Response of POST /api/community/puzzles. `sent` carries the par the server
 * worked out. `refused` carries which rule stopped it and a sentence saying so.
 */
export type MakePuzzleResponse =
  | { status: 'sent'; par: number }
  | { status: 'refused'; reason: string; message: string };

/** A puzzle waiting for review, as a moderator sees it. Never the maker's own sculpture. */
export type ReviewPuzzle = {
  id: string;
  size: Size;
  front: string[];
  side: string[];
  par: number;
  /** The maker's username: the only credit a puzzle carries. */
  maker: string;
};

export const REVIEW_DECISIONS = ['approve', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Body of POST /api/community/review. `at` is where in the line the
 * moderator was looking, from 1, so the reply can show what stands there next.
 */
export type ReviewRequest = { id: string; decision: ReviewDecision; at: number };

/**
 * Response of GET and POST /api/community/review: how many puzzles wait, and
 * one of them with its place in the line, oldest first: "2 of 5" is
 * `position` 2 of `waiting` 5. With none waiting, `position` is 0 and
 * `puzzle` is null. `refused` for anyone but a moderator.
 */
export type ReviewResponse =
  | { status: 'ok'; waiting: number; position: number; puzzle: ReviewPuzzle | null }
  | { status: 'refused'; message: string };

/** Body of POST /api/sound: what the device's sound set-up said when the first sound of a session was played. */
export type SoundReport = { state: string };

/** Body of POST /api/prefs. */
export type PrefsRequest = { muted: boolean };

/** What a player has still to be shown the first time: each is true until it has happened. */
export type Onboarding = {
  /** The warm-up puzzle with its hints, until it is finished or skipped. */
  warmup: boolean;
  /** The hint shown the first time a sculpture on a real puzzle is a valid solve. */
  solveHint: boolean;
};

export const ONBOARDING_EVENTS = ['warmup-finished', 'warmup-skipped', 'solve-hint-seen'] as const;
/** Something a first-time player has now done or seen, to be remembered. */
export type OnboardingEvent = (typeof ONBOARDING_EVENTS)[number];

/** Body of POST /api/onboarding. */
export type OnboardingRequest = { event: OnboardingEvent };

/** Response of POST /api/onboarding. `failed` means the event was not recorded. */
export type OnboardingResponse = { status: 'ok' } | { status: 'failed'; message: string };

/**
 * Response of GET /api/splash: what the inline view in the feed shows. The two
 * silhouettes are the puzzle as every player sees it; nothing here helps to
 * solve it beyond them, and nothing belongs to any other player.
 */
export type SplashResponse = {
  /** The N in "Puzzle #N". */
  number: number;
  /** UTC date the post was made, YYYY-MM-DD. */
  date: string;
  size: Size;
  front: string[];
  side: string[];
  /** The caller's own result, or null when they have not solved it or are logged out. */
  played: { blocks: number; par: number; stars: Stars } | null;
  /** The caller's current streak of daily puzzles, or null when logged out. */
  streak: number | null;
  /** How many players have solved this post. */
  solvers: number;
  /** The username of the player who made this puzzle, or null for a generated one. */
  maker: string | null;
};

/** Body of POST /api/submit. */
export type SubmitRequest = { blocks: string[] };

export const SUBMIT_REJECTIONS = ['logged-out', 'malformed', 'not-solved', 'no-puzzle', 'own-puzzle'] as const;
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

/**
 * What the maker of a puzzle sees of its results: how the players are doing,
 * with no place of their own, because the maker is never ranked on it.
 */
export type MakerResult = {
  par: number;
  /** How many players have submitted for this post. */
  solvers: number;
  leaderboard: LeaderboardRow[];
  /** The fewest blocks anyone has submitted so far, or null when nobody has. */
  record: { blocks: number; underPar: boolean } | null;
};

/**
 * Response of GET /api/result. A player who has submitted gets their result;
 * the puzzle's maker gets the maker's view; nobody else gets anything.
 */
export type ResultResponse =
  | { status: 'ok'; result: Result }
  | { status: 'maker'; result: MakerResult }
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

const isUtcDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const parseLastPuzzle = (value: unknown): LastPuzzle | null => {
  if (!isRecord(value)) return null;
  const { status, date } = value;
  if (status === 'used') return isUtcDate(date) ? { status, date } : null;
  return status === 'waiting' || status === 'approved' || status === 'rejected' ? { status } : null;
};

const parseCommunityStatus = (value: unknown): CommunityStatus | null => {
  if (!isRecord(value)) return null;
  const { canMake, why, review } = value;
  if (typeof canMake !== 'boolean' || (why !== null && typeof why !== 'string')) return null;
  if (review !== null && !isCount(review)) return null;
  const last = value.last === null ? null : parseLastPuzzle(value.last);
  if (value.last !== null && !last) return null;
  return { canMake, why, last, review };
};

const parseOnboarding = (value: unknown): Onboarding | null => {
  if (!isRecord(value)) return null;
  const { warmup, solveHint } = value;
  return typeof warmup === 'boolean' && typeof solveHint === 'boolean' ? { warmup, solveHint } : null;
};

export const parsePuzzleResponse = (value: unknown): PuzzleResponse | null => {
  if (!isRecord(value)) return null;
  const { debug, canSubmit } = value;
  if (typeof debug !== 'boolean' || typeof canSubmit !== 'boolean') return null;
  const puzzle = parsePuzzle(value.puzzle);
  if (!puzzle) return null;
  const onboarding = parseOnboarding(value.onboarding);
  if (!onboarding) return null;
  const { post, maker, yours, muted } = value;
  if (!isCount(post) || (maker !== null && typeof maker !== 'string')) return null;
  if (typeof yours !== 'boolean' || typeof muted !== 'boolean') return null;
  const community = parseCommunityStatus(value.community);
  if (!community) return null;
  const rest = { puzzle, canSubmit, debug, onboarding, post, maker, yours, community, muted };
  if (value.submission === null) return { ...rest, submission: null };
  const submission = parseSubmission(value.submission);
  return submission ? { ...rest, submission } : null;
};

const parseSize = (value: unknown): Size | null => {
  if (!isRecord(value)) return null;
  const { w, d, h } = value;
  return isBoardEdge(w) && isBoardEdge(d) && isBoardEdge(h) ? { w, d, h } : null;
};

export const parseMakePuzzleRequest = (value: unknown): MakePuzzleRequest | null => {
  if (!isRecord(value) || !isBlockKeys(value.blocks)) return null;
  const size = parseSize(value.size);
  if (!size) return null;
  const { blocks } = value;
  if (blocks.length > size.w * size.d * size.h || new Set(blocks).size !== blocks.length) return null;
  return { size, blocks: [...blocks] };
};

export const parseMakePuzzleResponse = (value: unknown): MakePuzzleResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'sent' && isCount(value.par)) return { status: 'sent', par: value.par };
  if (value.status === 'refused' && typeof value.reason === 'string' && typeof value.message === 'string') {
    return { status: 'refused', reason: value.reason, message: value.message };
  }
  return null;
};

const parseReviewPuzzle = (value: unknown): ReviewPuzzle | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.maker !== 'string') return null;
  // The silhouettes and par are checked exactly as a puzzle's are.
  const puzzle = parsePuzzle({ ...value, number: 0, tier: 1 });
  if (!puzzle) return null;
  return { id: value.id, size: puzzle.size, front: puzzle.front, side: puzzle.side, par: puzzle.par, maker: value.maker };
};

export const parseReviewRequest = (value: unknown): ReviewRequest | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
  const decision = REVIEW_DECISIONS.find((known) => known === value.decision);
  if (!decision) return null;
  // A request that does not say where the moderator was looking is answered from the front of the line.
  const { at } = value;
  if (at !== undefined && !isCount(at)) return null;
  return { id: value.id, decision, at: at === undefined ? 1 : Math.max(at, 1) };
};

export const parseReviewResponse = (value: unknown): ReviewResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'refused' && typeof value.message === 'string') {
    return { status: 'refused', message: value.message };
  }
  const { waiting, position } = value;
  if (value.status !== 'ok' || !isCount(waiting) || !isCount(position) || position > waiting) return null;
  if (value.puzzle === null) return { status: 'ok', waiting, position, puzzle: null };
  const puzzle = parseReviewPuzzle(value.puzzle);
  return puzzle && position >= 1 ? { status: 'ok', waiting, position, puzzle } : null;
};

/** The state is only ever logged, so it is kept short and to plain letters. */
export const parseSoundReport = (value: unknown): SoundReport | null =>
  isRecord(value) && typeof value.state === 'string' && /^[a-z-]{1,16}$/.test(value.state)
    ? { state: value.state }
    : null;

export const parsePrefsRequest = (value: unknown): PrefsRequest | null =>
  isRecord(value) && typeof value.muted === 'boolean' ? { muted: value.muted } : null;

export const parseOnboardingRequest = (value: unknown): OnboardingRequest | null => {
  if (!isRecord(value)) return null;
  const event = ONBOARDING_EVENTS.find((known) => known === value.event);
  return event ? { event } : null;
};

export const parseOnboardingResponse = (value: unknown): OnboardingResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'ok') return { status: 'ok' };
  if (value.status === 'failed' && typeof value.message === 'string') return { status: 'failed', message: value.message };
  return null;
};

export const parseSplashResponse = (value: unknown): SplashResponse | null => {
  if (!isRecord(value)) return null;
  const { number, date, played, streak, solvers } = value;
  if (!isCount(number) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // The silhouettes are checked exactly as a puzzle's are.
  const puzzle = parsePuzzle({ id: 'splash', number, tier: 1, par: 0, size: value.size, front: value.front, side: value.side });
  if (!puzzle) return null;
  if (!isCount(solvers) || (streak !== null && !isCount(streak))) return null;
  const { maker } = value;
  if (maker !== null && typeof maker !== 'string') return null;
  let own: SplashResponse['played'] = null;
  if (played !== null) {
    if (!isRecord(played) || !isCount(played.blocks) || !isCount(played.par) || !isStars(played.stars)) return null;
    own = { blocks: played.blocks, par: played.par, stars: played.stars };
  }
  return { number, date, size: puzzle.size, front: puzzle.front, side: puzzle.side, played: own, streak, solvers, maker };
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

const parseMakerResult = (value: unknown): MakerResult | null => {
  if (!isRecord(value)) return null;
  const { par, solvers, leaderboard, record } = value;
  if (!isCount(par) || !isCount(solvers) || !Array.isArray(leaderboard)) return null;
  const rows: LeaderboardRow[] = [];
  for (const entry of leaderboard) {
    const row = parseLeaderboardRow(entry);
    if (!row) return null;
    rows.push(row);
  }
  if (record === null) return { par, solvers, leaderboard: rows, record: null };
  if (!isRecord(record) || !isCount(record.blocks) || typeof record.underPar !== 'boolean') return null;
  return { par, solvers, leaderboard: rows, record: { blocks: record.blocks, underPar: record.underPar } };
};

export const parseResultResponse = (value: unknown): ResultResponse | null => {
  if (!isRecord(value)) return null;
  if (value.status === 'not-submitted' && typeof value.message === 'string') {
    return { status: 'not-submitted', message: value.message };
  }
  if (value.status === 'maker') {
    const result = parseMakerResult(value.result);
    return result ? { status: 'maker', result } : null;
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
