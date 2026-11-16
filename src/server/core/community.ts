// Puzzles made by players: sending one, the moderators' review, and the queue
// of approved puzzles the Sunday post draws from.
//
// The maker's own sculpture is kept with the puzzle as a private solution. It
// is an answer, so nothing in this file hands it to a route: the only things
// that leave are the puzzle (two silhouettes and par) and the maker's username.

import { redis } from '@devvit/web/server';
import type { CommunityStatus, LastPuzzle, ReviewDecision, ReviewPuzzle } from '../../shared/api';
import { parseLastPuzzle, parsePuzzle } from '../../shared/api';
import {
  boardFor,
  castShadows,
  CHECK_REFUSAL,
  firstShapeFailure,
  parRefusal,
  parRefusalText,
  puzzleKey,
  SERVER_PAR_LIMIT_MS,
  workOutPar,
} from '../../shared/community';
import { parseKey } from '../../shared/logic';
import type { Puzzle, Size } from '../../shared/puzzle';
import { sortBlocks } from '../../shared/score';
import { KEYS } from './keys';
import { QUEUE } from './queue';

/** A maker may send this many puzzles in any seven days. */
export const WEEKLY_LIMIT = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type Maker = { userId: string; username: string };

/** A puzzle a player has made, as stored while it waits and after it is approved. */
export type CommunityPuzzle = {
  puzzle: Puzzle;
  maker: Maker;
  /** When it was sent, in milliseconds. */
  sentAt: number;
  /** The maker's own sculpture, pruned to par. Private: never sent to any client. */
  solution: string[];
};

/** Why a puzzle was not accepted. The checks' own names, or one of these. */
export type SendRefusal =
  | 'not-eligible'
  | 'pending'
  | 'weekly-limit'
  | 'board'
  | 'out-of-bounds'
  | 'duplicate'
  | 'floating'
  | 'span'
  | 'rectangle'
  | 'different'
  | 'height'
  | 'par-low'
  | 'par-high';

export type SendOutcome =
  | { status: 'sent'; par: number }
  | { status: 'refused'; reason: SendRefusal; message: string };

const NOT_ELIGIBLE = 'Solve a daily puzzle first. Then you can make one.';
const PENDING = 'Your last puzzle is still waiting for review.';
const WEEKLY = `You can send ${WEEKLY_LIMIT} puzzles in a week. Try again in a few days.`;

const refuse = (reason: SendRefusal, message: string): SendOutcome => ({ status: 'refused', reason, message });

// Every puzzle in the generated queue, by its lookalike key, so a player's
// puzzle that matches one (mirrored or swapped included) is turned away.
const QUEUE_KEYS: ReadonlySet<string> = new Set(QUEUE.map((puzzle) => puzzleKey(puzzle.front, puzzle.side)));

// --- Who may make a puzzle -------------------------------------------------------

/** Records that a player has submitted a solution to a daily post. */
export const markDailySolver = (userId: string): Promise<number> =>
  redis.hSet(KEYS.dailySolvers, { [userId]: '1' });

/**
 * Whether a player has ever submitted a daily puzzle. A streak record counts
 * too: it is only written for a daily post, and covers players from before
 * this was kept.
 */
const hasSolvedDaily = async (userId: string): Promise<boolean> =>
  (await redis.hGet(KEYS.dailySolvers, userId)) !== undefined ||
  (await redis.hGet(KEYS.streaks, userId)) !== undefined;

/** The times a maker sent a puzzle in the seven days up to `now`. */
const recentSends = async (userId: string, now: number): Promise<number[]> => {
  const json = await redis.hGet(KEYS.communitySent, userId);
  if (json === undefined) return [];
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value.filter((time): time is number => typeof time === 'number' && now - time < WEEK_MS);
};

/** Why a player may not make a puzzle right now, or null when they may. */
const blockedBecause = async (userId: string, now: number): Promise<SendOutcome | null> => {
  if (!(await hasSolvedDaily(userId))) return refuse('not-eligible', NOT_ELIGIBLE);
  if ((await redis.hGet(KEYS.communityPendingByMaker, userId)) !== undefined) return refuse('pending', PENDING);
  if ((await recentSends(userId, now)).length >= WEEKLY_LIMIT) return refuse('weekly-limit', WEEKLY);
  return null;
};

// --- What became of a maker's last puzzle ------------------------------------------

/** Remembers what has become of a puzzle, as the last thing its maker is told about it. */
const setLast = (userId: string, id: string, last: LastPuzzle): Promise<number> =>
  redis.hSet(KEYS.communityLast, { [userId]: JSON.stringify({ id, ...last }) });

/**
 * Moves a puzzle's status on, but only while it is still the last puzzle its
 * maker sent: news of an older one never replaces the status of a newer one.
 */
const moveLast = async (userId: string, id: string, last: LastPuzzle): Promise<void> => {
  const json = await redis.hGet(KEYS.communityLast, userId);
  if (json === undefined) return;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== id) return;
  await setLast(userId, id, last);
};

/** What became of the last puzzle a player sent, or null when they have sent none. */
const lastPuzzle = async (userId: string): Promise<LastPuzzle | null> => {
  const json = await redis.hGet(KEYS.communityLast, userId);
  const last = json === undefined ? null : parseLastPuzzle(JSON.parse(json));
  if (last) return last;
  // A puzzle sent before this was kept has no record, but its waiting slot says enough.
  return (await redis.hGet(KEYS.communityPendingByMaker, userId)) === undefined ? null : { status: 'waiting' };
};

/** Records that an approved puzzle has been used for the post of `date` (UTC, YYYY-MM-DD). */
export const markUsed = ({ puzzle, maker }: CommunityPuzzle, date: string): Promise<void> =>
  moveLast(maker.userId, puzzle.id, { status: 'used', date });

/** What a player may do about community puzzles, for the game to show. `review` is filled in by the route. */
export const makerStatus = async (userId: string | undefined, now: number): Promise<Omit<CommunityStatus, 'review'>> => {
  if (!userId) return { canMake: false, why: 'Log in to make a puzzle.', last: null };
  const blocked = await blockedBecause(userId, now);
  const last = await lastPuzzle(userId);
  return blocked?.status === 'refused'
    ? { canMake: false, why: blocked.message, last }
    : { canMake: true, why: null, last };
};

// --- Sending a puzzle ------------------------------------------------------------

const parseStored = (json: string | undefined): CommunityPuzzle | null => {
  if (json === undefined) return null;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return null;
  if (!('puzzle' in value) || !('maker' in value) || !('sentAt' in value) || !('solution' in value)) return null;
  const puzzle = parsePuzzle(value.puzzle);
  const { maker, sentAt, solution } = value;
  if (!puzzle || typeof sentAt !== 'number' || typeof maker !== 'object' || maker === null) return null;
  if (!('userId' in maker) || !('username' in maker)) return null;
  if (typeof maker.userId !== 'string' || typeof maker.username !== 'string') return null;
  if (!Array.isArray(solution) || !solution.every((key): key is string => typeof key === 'string')) return null;
  return { puzzle, maker: { userId: maker.userId, username: maker.username }, sentAt, solution };
};

const inBounds = (key: string, size: Size): boolean => {
  const { x, y, z } = parseKey(key);
  return x >= 0 && x < size.w && y >= 0 && y < size.h && z >= 0 && z < size.d;
};

/**
 * Takes a puzzle a player has made. Nothing the client says about it is
 * trusted: every rule is checked again here, and the two silhouettes and par
 * are worked out here from the sculpture. Of two requests at once from one
 * maker, one is accepted.
 */
export const sendPuzzle = async (
  maker: Maker,
  size: Size,
  blocks: readonly string[],
  now: number
): Promise<SendOutcome> => {
  const blocked = await blockedBecause(maker.userId, now);
  if (blocked) return blocked;

  const board = boardFor(size);
  if (!board) return refuse('board', 'A puzzle must be made on a 4 by 4 by 4 or 5 by 5 by 5 board.');
  if (!blocks.every((key) => inBounds(key, size))) {
    return refuse('out-of-bounds', 'Every block must be inside the board.');
  }

  const sculpture = new Set(blocks);
  const failed = firstShapeFailure(sculpture, board);
  if (failed) return refuse(failed, CHECK_REFUSAL[failed]);

  const { frontRows, sideRows } = castShadows(sculpture, size);
  const key = puzzleKey(frontRows, sideRows);
  const duplicate = refuse('duplicate', 'There is already a puzzle with these two shadows.');
  if (QUEUE_KEYS.has(key) || (await redis.hGet(KEYS.communityKeys, key)) !== undefined) return duplicate;

  // Par, against the clock: one request must never run long.
  const { par, solution } = workOutPar([...blocks], size, { until: Date.now() + SERVER_PAR_LIMIT_MS, now: Date.now });
  // Said plainly, which way it is out: the maker has no way to see par while building.
  const outOfRange = parRefusal(par, board);
  if (outOfRange) return refuse(outOfRange, parRefusalText(outOfRange, par, board));

  const number = await redis.incrBy(KEYS.communityCounter, 1);
  const id = `cp-${String(number).padStart(4, '0')}`;
  // The maker's one waiting slot, then the puzzle's key: each is claimed
  // with a write that only succeeds when the field is new.
  if ((await redis.hSetNX(KEYS.communityPendingByMaker, maker.userId, id)) !== 1) return refuse('pending', PENDING);
  if ((await redis.hSetNX(KEYS.communityKeys, key, id)) !== 1) {
    await redis.hDel(KEYS.communityPendingByMaker, [maker.userId]);
    return duplicate;
  }

  const stored: CommunityPuzzle = {
    puzzle: { id, number: 0, tier: board.tier, size, front: frontRows, side: sideRows, par },
    maker,
    sentAt: now,
    solution: sortBlocks(solution),
  };
  await redis.hSet(KEYS.communityPending, { [id]: JSON.stringify(stored) });
  await redis.zAdd(KEYS.communityPendingOrder, { member: id, score: now });
  const sends = [...(await recentSends(maker.userId, now)), now];
  await redis.hSet(KEYS.communitySent, { [maker.userId]: JSON.stringify(sends) });
  await setLast(maker.userId, id, { status: 'waiting' });
  return { status: 'sent', par };
};

// --- Review ----------------------------------------------------------------------

export const pendingCount = (): Promise<number> => redis.zCard(KEYS.communityPendingOrder);

/** What a moderator is shown of a puzzle: the puzzle and the maker's name, never the maker's sculpture. */
const forReview = ({ puzzle, maker }: CommunityPuzzle): ReviewPuzzle => ({
  id: puzzle.id,
  size: puzzle.size,
  front: puzzle.front,
  side: puzzle.side,
  par: puzzle.par,
  maker: maker.username,
});

/** One waiting puzzle and where it stands in the line, oldest first. */
export type Waiting = { waiting: number; position: number; puzzle: ReviewPuzzle | null };

/**
 * The puzzle at a place in the line of those waiting, counted from 1 with the
 * one that has waited longest first. A place past the end gives the last
 * puzzle; with none waiting the place is 0 and there is no puzzle.
 */
export const pendingAt = async (at: number): Promise<Waiting> => {
  const waiting = await pendingCount();
  if (waiting === 0) return { waiting, position: 0, puzzle: null };
  const position = Math.min(Math.max(Math.trunc(at) || 1, 1), waiting);
  const [found] = await redis.zRange(KEYS.communityPendingOrder, position - 1, position - 1, { by: 'rank' });
  const stored = found ? parseStored(await redis.hGet(KEYS.communityPending, found.member)) : null;
  return { waiting, position, puzzle: stored ? forReview(stored) : null };
};

/**
 * Approves or rejects a pending puzzle. Either way it leaves the pending
 * list and the maker's slot is freed. An approved puzzle joins the community
 * queue behind those approved before it; a rejected one is removed, and its
 * shadows may be sent again. Returns false when the puzzle was not pending,
 * as when another moderator got there first.
 */
export const reviewPuzzle = async (id: string, decision: ReviewDecision, now: number): Promise<boolean> => {
  const json = await redis.hGet(KEYS.communityPending, id);
  const stored = parseStored(json);
  // Removing it from the pending list is the claim: only one review of a puzzle gets past here.
  if (json === undefined || !stored || (await redis.hDel(KEYS.communityPending, [id])) !== 1) return false;
  await redis.zRem(KEYS.communityPendingOrder, [id]);
  await redis.hDel(KEYS.communityPendingByMaker, [stored.maker.userId]);

  const { puzzle } = stored;
  if (decision === 'approve') {
    await redis.hSet(KEYS.communityApproved, { [id]: json });
    await redis.zAdd(KEYS.communityApprovedOrder, { member: id, score: now });
  } else {
    await redis.hDel(KEYS.communityKeys, [puzzleKey(puzzle.front, puzzle.side)]);
  }
  // What the maker is told the next time they open "Make a puzzle". Never why.
  await moveLast(stored.maker.userId, id, { status: decision === 'approve' ? 'approved' : 'rejected' });
  return true;
};

// --- The community queue ---------------------------------------------------------

export const approvedCount = (): Promise<number> => redis.zCard(KEYS.communityApprovedOrder);

/**
 * Takes the approved puzzle that has waited longest, for a post, or null when
 * there is none. Of two calls at once, each gets a different puzzle.
 */
export const takeApproved = async (): Promise<CommunityPuzzle | null> => {
  const waiting = await redis.zRange(KEYS.communityApprovedOrder, 0, 4, { by: 'rank' });
  for (const { member: id } of waiting) {
    // Removing it from the order is the claim.
    if ((await redis.zRem(KEYS.communityApprovedOrder, [id])) !== 1) continue;
    const stored = parseStored(await redis.hGet(KEYS.communityApproved, id));
    await redis.hDel(KEYS.communityApproved, [id]);
    if (stored) return stored;
  }
  return null;
};
