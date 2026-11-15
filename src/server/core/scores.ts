// Everything derived from accepted submissions: the leaderboard, rarity
// counts and streaks, and the result a player sees for a post.

import { createHash } from 'node:crypto';
import { redis } from '@devvit/web/server';
import type { LeaderboardRow, Result } from '../../shared/api';
import { starsFor } from '../../shared/score';
import { KEYS } from './keys';
import { newestDaily, type PostRecord } from './posts';
import { parseStored, storeSubmission, type StoreOutcome, type StoredSubmission } from './submissions';

/** Leaderboard rows sent with a result. */
export const LEADERBOARD_ROWS = 10;
/** Below this many solvers, a rarity percentage would mean nothing. */
export const MIN_RARITY_SAMPLE = 5;

/**
 * Leaderboard score: block count first, submission time as tie-break. One
 * step is larger than any millisecond timestamp, and the total stays far
 * inside the range where a number holds whole values exactly.
 */
const SCORE_STEP = 1e13;
const scoreFor = (blocks: number, submittedAt: number): number => blocks * SCORE_STEP + submittedAt;
const blocksFromScore = (score: number): number => Math.floor(score / SCORE_STEP);

/** A short, fixed-length name for a sculpture, used as a hash field. */
export const sculptureHash = (canonical: string): string =>
  createHash('sha256').update(canonical).digest('hex').slice(0, 16);

// --- Streaks -------------------------------------------------------------------

/** `last` is the `daily` value of the last daily post counted, 0 for none. */
type Streak = { current: number; best: number; last: number };

const NO_STREAK: Streak = { current: 0, best: 0, last: 0 };

const readStreak = async (userId: string): Promise<Streak> => {
  const json = await redis.hGet(KEYS.streaks, userId);
  if (json === undefined) return NO_STREAK;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return NO_STREAK;
  if (!('current' in value) || !('best' in value) || !('last' in value)) return NO_STREAK;
  const { current, best, last } = value;
  if (typeof current !== 'number' || typeof best !== 'number' || typeof last !== 'number') return NO_STREAK;
  return { current, best, last };
};

/**
 * Counts a solve towards the player's streak. Only a daily post counts, and
 * only while it is the newest daily post: an older post, or an extra post made
 * from the menu, changes nothing.
 */
const updateStreak = async (userId: string, daily: number | null): Promise<void> => {
  if (daily === null || daily !== (await newestDaily())) return;
  const streak = await readStreak(userId);
  if (streak.last === daily) return;
  const current = streak.last === daily - 1 ? streak.current + 1 : 1;
  const next: Streak = { current, best: Math.max(streak.best, current), last: daily };
  await redis.hSet(KEYS.streaks, { [userId]: JSON.stringify(next) });
};

/**
 * The streak as shown. The newest daily post is still open, so having solved
 * it or the one before keeps the streak alive; missing the one before, which
 * is the latest finished post, shows zero.
 */
const shownStreak = (streak: Streak, newest: number): Result['streak'] => ({
  current: streak.last >= newest - 1 ? streak.current : 0,
  best: streak.best,
});

// --- Recording a solve -----------------------------------------------------------

/** Adds one newly stored submission to the post's leaderboard and counts, and to the player's streak. */
const recordSolve = async (post: PostRecord, stored: StoredSubmission): Promise<void> => {
  const { postId, userId, blocks, sculpture, submittedAt } = stored;
  await redis.zAdd(KEYS.leaderboard(postId), { member: userId, score: scoreFor(blocks, submittedAt) });
  await redis.hIncrBy(KEYS.blockCounts(postId), String(blocks), 1);
  await redis.hIncrBy(KEYS.sculptures(postId), sculptureHash(sculpture), 1);
  await updateStreak(userId, post.daily);
};

/**
 * Stores a solved sculpture and, the first time only, counts it. Of any
 * number of requests from one player for one post, exactly one is 'accepted'
 * by storeSubmission, and only that one reaches recordSolve: the leaderboard,
 * rarity counts and streak each change once per player per post.
 */
export const acceptSubmission = async (
  postId: string,
  post: PostRecord,
  player: { userId: string; username: string },
  blocks: readonly string[],
  now: number
): Promise<StoreOutcome> => {
  const outcome = await storeSubmission(postId, post, player, blocks, now);
  if (outcome.status === 'accepted') await recordSolve(post, outcome.stored);
  return outcome;
};

// --- Reading a result ------------------------------------------------------------

/** The result for a player who has submitted. `stored` must be the caller's own record. */
export const buildResult = async (post: PostRecord, stored: StoredSubmission): Promise<Result> => {
  const { postId, userId, blocks } = stored;
  const { par } = post.puzzle;

  // Solvers per block count. A rank is one more than the number of players
  // with strictly fewer blocks, so equal counts share a rank.
  const tallies = Object.entries(await redis.hGetAll(KEYS.blockCounts(postId)))
    .map(([count, players]) => ({ blocks: Number(count), players: Number(players) }))
    .filter((tally) => Number.isInteger(tally.blocks) && tally.players > 0);
  const playersWith = (count: number): number =>
    tallies.find((tally) => tally.blocks === count)?.players ?? 0;
  const rankOf = (count: number): number =>
    1 + tallies.reduce((fewer, tally) => fewer + (tally.blocks < count ? tally.players : 0), 0);
  const solvers = Math.max(tallies.reduce((total, tally) => total + tally.players, 0), 1);
  const fewest = Math.min(blocks, ...tallies.map((tally) => tally.blocks));

  const top = await redis.zRange(KEYS.leaderboard(postId), 0, LEADERBOARD_ROWS - 1, { by: 'rank' });
  const records =
    top.length > 0
      ? await redis.hMGet(
          KEYS.submissions(postId),
          top.map((entry) => entry.member)
        )
      : [];
  const leaderboard: LeaderboardRow[] = top.map((entry, index) => {
    const rowBlocks = blocksFromScore(entry.score);
    // Only the name is taken from another player's record, never the sculpture.
    const username = parseStored(records[index])?.username ?? 'unknown';
    return { rank: rankOf(rowBlocks), username, blocks: rowBlocks, you: entry.member === userId };
  });
  const own: LeaderboardRow | null = leaderboard.some((row) => row.you)
    ? null
    : { rank: rankOf(blocks), username: stored.username, blocks, you: true };

  const same = Math.max(Number(await redis.hGet(KEYS.sculptures(postId), sculptureHash(stored.sculpture))) || 0, 1);

  return {
    blocks,
    par,
    stars: starsFor(blocks, par),
    rank: rankOf(blocks),
    tied: Math.max(playersWith(blocks), 1),
    solvers,
    leaderboard,
    own,
    record: { blocks: fewest, underPar: fewest < par },
    rarity: { same, share: Math.min(same / solvers, 1), smallSample: solvers < MIN_RARITY_SAMPLE },
    streak: shownStreak(await readStreak(userId), await newestDaily()),
  };
};
