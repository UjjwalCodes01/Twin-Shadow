// Everything derived from accepted submissions: the leaderboard, rarity
// counts, the gallery and streaks, and what a player sees of them.

import { createHash } from 'node:crypto';
import { redis } from '@devvit/web/server';
import type { Gallery, GalleryEntry, GallerySort, LeaderboardRow, MakerResult, Result } from '../../shared/api';
import { starsFor } from '../../shared/score';
import { markDailySolver } from './community';
import { flairMilestone, setStreakFlair } from './flair';
import { KEYS } from './keys';
import { newestDaily, type PostRecord } from './posts';
import { parseStored, storeSubmission, type StoreOutcome, type StoredSubmission } from './submissions';

/** Leaderboard rows sent with a result. */
export const LEADERBOARD_ROWS = 10;
/** Below this many solvers, a rarity percentage would mean nothing. */
export const MIN_RARITY_SAMPLE = 5;
/** Sculptures on one page of the gallery. */
export const GALLERY_PAGE_SIZE = 20;

/**
 * Leaderboard score: block count first, submission time as tie-break. One
 * step is larger than any millisecond timestamp, and the total stays far
 * inside the range where a number holds whole values exactly.
 */
const SCORE_STEP = 1e13;
const scoreFor = (blocks: number, submittedAt: number): number => blocks * SCORE_STEP + submittedAt;
const blocksFromScore = (score: number): number => Math.floor(score / SCORE_STEP);

/** A short, fixed-length name for a sculpture, the same for everyone who built it. */
export const sculptureHash = (canonical: string): string =>
  createHash('sha256').update(canonical).digest('hex').slice(0, 16);

/** Field of the sculpture counts: block count and hash together. */
const sculptureField = (blocks: number, hash: string): string => `${blocks}:${hash}`;

// --- Streaks -------------------------------------------------------------------

type Streak = {
  current: number;
  best: number;
  /** The `daily` value of the last daily post counted, 0 for none. */
  last: number;
  /** The streak flair already given, in days, 0 for none. */
  flair: number;
};

const NO_STREAK: Streak = { current: 0, best: 0, last: 0, flair: 0 };

const readStreak = async (userId: string): Promise<Streak> => {
  const json = await redis.hGet(KEYS.streaks, userId);
  if (json === undefined) return NO_STREAK;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return NO_STREAK;
  if (!('current' in value) || !('best' in value) || !('last' in value)) return NO_STREAK;
  const { current, best, last } = value;
  if (typeof current !== 'number' || typeof best !== 'number' || typeof last !== 'number') return NO_STREAK;
  const flair = 'flair' in value && typeof value.flair === 'number' ? value.flair : 0;
  return { current, best, last, flair };
};

const writeStreak = (userId: string, streak: Streak): Promise<number> =>
  redis.hSet(KEYS.streaks, { [userId]: JSON.stringify(streak) });

/**
 * Counts a solve towards the player's streak. Only a daily post counts, and
 * only while it is the newest daily post: an older post, or an extra post made
 * from the menu, changes nothing. A best streak that reaches a flair milestone
 * earns the flair, once.
 */
const updateStreak = async (userId: string, username: string, daily: number | null): Promise<void> => {
  if (daily === null || daily !== (await newestDaily())) return;
  const streak = await readStreak(userId);
  if (streak.last === daily) return;
  const current = (await aliveAt(userId, streak.last, daily)) ? streak.current + 1 : 1;
  const next: Streak = { ...streak, current, best: Math.max(streak.best, current), last: daily };
  await writeStreak(userId, next);

  // Flair comes after the streak is safely stored. If setting it fails, the
  // record still says the old flair, so the next counted solve tries again.
  const earned = flairMilestone(next.best);
  if (earned > next.flair && (await setStreakFlair(username, earned))) {
    await writeStreak(userId, { ...next, flair: earned });
  }
};

/**
 * Whether a streak whose last counted daily post is `last` is still unbroken
 * when the daily post `daily` comes to be played or looked at. It is when
 * nothing was missed in between, and also when the only day missed was one
 * whose puzzle this player made: a maker cannot submit their own puzzle, so
 * that day is carried over instead of counted against them.
 */
const aliveAt = async (userId: string, last: number, daily: number): Promise<boolean> => {
  if (last >= daily - 1) return true;
  if (last !== daily - 2) return false;
  return (await redis.hGet(KEYS.dailyMakers, String(daily - 1))) === userId;
};

/**
 * The streak as shown. The newest daily post is still open, so having solved
 * it or the one before keeps the streak alive; missing the one before, which
 * is the latest finished post, shows zero. A day whose puzzle the player made
 * does not count as missed.
 */
const shownStreak = async (userId: string, streak: Streak, newest: number): Promise<Result['streak']> => {
  const madeNewest = (await redis.hGet(KEYS.dailyMakers, String(newest))) === userId;
  // Their own puzzle is the newest: the day before it is the one that matters.
  const alive = await aliveAt(userId, streak.last, madeNewest ? newest - 1 : newest);
  return { current: alive ? streak.current : 0, best: streak.best };
};

/** A player's streak of daily puzzles as it stands now: 0 once the latest finished one was missed. */
export const currentStreak = async (userId: string): Promise<number> =>
  (await shownStreak(userId, await readStreak(userId), await newestDaily())).current;

/** How many players have submitted a solution for a post. */
export const solverCount = (postId: string): Promise<number> => redis.hLen(KEYS.submissions(postId));

// --- Counting a solve ------------------------------------------------------------

type CountStep = 'board' | 'tally' | 'sculpture';
const COUNT_STEPS: readonly CountStep[] = ['board', 'tally', 'sculpture'];
const stepField = (step: CountStep, userId: string): string => `${step}:${userId}`;

/** What the gallery keeps for each distinct sculpture. */
type SavedSculpture = { sculpture: string; first: string };

/**
 * Adds a stored submission to the post's leaderboard, block-count tally and
 * sculpture counts. Each of the three is claimed first with hSetNX, which
 * writes only when the field is new, so however many requests call this for
 * the same player, each step runs once. Calling it again for a submission
 * that was only partly counted finishes the job.
 */
const countSolve = async (stored: StoredSubmission): Promise<void> => {
  const { postId, userId, username, blocks, sculpture, submittedAt } = stored;
  const claim = async (step: CountStep): Promise<boolean> =>
    (await redis.hSetNX(KEYS.counted(postId), stepField(step, userId), '1')) === 1;

  if (await claim('board')) {
    await redis.zAdd(KEYS.leaderboard(postId), { member: userId, score: scoreFor(blocks, submittedAt) });
  }
  if (await claim('tally')) {
    await redis.hIncrBy(KEYS.blockCounts(postId), String(blocks), 1);
  }
  if (await claim('sculpture')) {
    const hash = sculptureHash(sculpture);
    // Kept from the first player to build it; later builders only add to the count.
    const saved: SavedSculpture = { sculpture, first: username };
    await redis.hSetNX(KEYS.gallery(postId), hash, JSON.stringify(saved));
    await redis.hIncrBy(KEYS.sculptures(postId), sculptureField(blocks, hash), 1);
  }
};

/**
 * Makes sure a stored submission has been counted. Normally it has; this
 * repairs the rare case where the server stopped between storing a submission
 * and counting it.
 */
const ensureCounted = async (stored: StoredSubmission): Promise<void> => {
  const marks = await redis.hMGet(
    KEYS.counted(stored.postId),
    COUNT_STEPS.map((step) => stepField(step, stored.userId))
  );
  if (marks.some((mark) => mark === null || mark === undefined)) await countSolve(stored);
};

/**
 * Stores a solved sculpture and, the first time only, counts it. Of any
 * number of requests from one player for one post, exactly one is 'accepted'
 * by storeSubmission. Only that one touches the streak, and countSolve claims
 * each of its steps, so the leaderboard, the counts and the streak each
 * change once per player per post. The maker of the post's puzzle gets
 * 'own-puzzle' and nothing is stored or counted.
 */
export const acceptSubmission = async (
  postId: string,
  post: PostRecord,
  player: { userId: string; username: string },
  blocks: readonly string[],
  now: number
): Promise<StoreOutcome> => {
  const outcome = await storeSubmission(postId, post, player, blocks, now);
  if (outcome.status === 'accepted') {
    await countSolve(outcome.stored);
    await updateStreak(player.userId, player.username, post.daily);
    // Having submitted a daily puzzle is what lets a player make one.
    if (post.kind === 'daily') await markDailySolver(player.userId);
  }
  return outcome;
};

// --- Reading a result ------------------------------------------------------------

/** The result for a player who has submitted. `stored` must be the caller's own record. */
export const buildResult = async (post: PostRecord, stored: StoredSubmission): Promise<Result> => {
  await ensureCounted(stored);
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

  const field = sculptureField(blocks, sculptureHash(stored.sculpture));
  const same = Math.max(Number(await redis.hGet(KEYS.sculptures(postId), field)) || 0, 1);

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
    streak: await shownStreak(userId, await readStreak(userId), await newestDaily()),
    // A share still being posted counts: the button must not offer a second one.
    shared: (await redis.hGet(KEYS.shares(postId), userId)) !== undefined,
    joinPrompt: (await redis.hGet(KEYS.joinPrompt, userId)) === undefined,
  };
};

/**
 * What the maker of a post's puzzle sees of its results: the same leaderboard
 * and record as anyone, with no place of their own. Only call this for the maker.
 */
export const buildMakerResult = async (post: PostRecord, postId: string): Promise<MakerResult> => {
  const { par } = post.puzzle;
  const tallies = Object.entries(await redis.hGetAll(KEYS.blockCounts(postId)))
    .map(([count, players]) => ({ blocks: Number(count), players: Number(players) }))
    .filter((tally) => Number.isInteger(tally.blocks) && tally.players > 0);
  const rankOf = (count: number): number =>
    1 + tallies.reduce((fewer, tally) => fewer + (tally.blocks < count ? tally.players : 0), 0);
  const fewest = tallies.length > 0 ? Math.min(...tallies.map((tally) => tally.blocks)) : null;

  const top = await redis.zRange(KEYS.leaderboard(postId), 0, LEADERBOARD_ROWS - 1, { by: 'rank' });
  const records =
    top.length > 0
      ? await redis.hMGet(
          KEYS.submissions(postId),
          top.map((entry) => entry.member)
        )
      : [];
  const leaderboard: LeaderboardRow[] = top.map((entry, index) => {
    const blocks = blocksFromScore(entry.score);
    // Only the name is taken from a player's record, never the sculpture.
    return { rank: rankOf(blocks), username: parseStored(records[index])?.username ?? 'unknown', blocks, you: false };
  });
  return {
    par,
    solvers: await solverCount(postId),
    leaderboard,
    record: fewest === null ? null : { blocks: fewest, underPar: fewest < par },
  };
};

// --- Reading the gallery ---------------------------------------------------------

const parseSaved = (json: string | null | undefined): SavedSculpture | null => {
  if (json === undefined || json === null) return null;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null || !('sculpture' in value) || !('first' in value)) return null;
  const { sculpture, first } = value;
  return typeof sculpture === 'string' && typeof first === 'string' ? { sculpture, first } : null;
};

/**
 * One page of the distinct sculptures submitted for a post. Only call this
 * for a player who has submitted, with their own record as `stored`, or for
 * the puzzle's maker, who has none and passes null.
 */
export const buildGallery = async (
  postId: string,
  stored: StoredSubmission | null,
  sort: GallerySort,
  requestedPage: number
): Promise<Gallery> => {
  if (stored) await ensureCounted(stored);
  const ownHash = stored ? sculptureHash(stored.sculpture) : null;

  // Block count, hash and builders for every distinct sculpture, in one read.
  const all = Object.entries(await redis.hGetAll(KEYS.sculptures(postId)))
    .map(([field, builders]) => {
      const [blocks = '', hash = ''] = field.split(':');
      return { hash, blocks: Number(blocks), builders: Number(builders) };
    })
    .filter((entry) => entry.hash !== '' && Number.isInteger(entry.blocks) && entry.builders > 0);

  // The hash is the last tie-break, so pages never shuffle between requests.
  const byName = (a: { hash: string }, b: { hash: string }): number => (a.hash < b.hash ? -1 : 1);
  all.sort(
    sort === 'rarest'
      ? (a, b) => a.builders - b.builders || a.blocks - b.blocks || byName(a, b)
      : (a, b) => a.blocks - b.blocks || a.builders - b.builders || byName(a, b)
  );

  const pages = Math.max(1, Math.ceil(all.length / GALLERY_PAGE_SIZE));
  const page = Math.min(Math.max(Math.trunc(requestedPage) || 1, 1), pages);
  const shown = all.slice((page - 1) * GALLERY_PAGE_SIZE, page * GALLERY_PAGE_SIZE);
  const saved =
    shown.length > 0
      ? await redis.hMGet(
          KEYS.gallery(postId),
          shown.map((entry) => entry.hash)
        )
      : [];

  const entries: GalleryEntry[] = shown.flatMap((entry, index) => {
    const details = parseSaved(saved[index]);
    if (!details) return [];
    return [
      {
        id: entry.hash,
        blocks: entry.blocks,
        builders: entry.builders,
        first: details.first,
        sculpture: details.sculpture === '' ? [] : details.sculpture.split(';'),
        yours: entry.hash === ownHash,
      },
    ];
  });
  return { sort, page, pages, total: all.length, entries };
};
