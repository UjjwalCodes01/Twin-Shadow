import { reddit, redis } from '@devvit/web/server';
import { parsePuzzle } from '../../shared/api';
import { tierForDate, type Puzzle, type Tier } from '../../shared/puzzle';
import { KEYS } from './keys';
import { puzzlesOfTier } from './queue';

/** The daily post goes out at this hour, UTC. */
export const DAILY_POST_UTC_HOUR = 5;

/** A claim on a date that has sat this long without a post is treated as abandoned. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * 'daily' is the one post per UTC date that streaks count: the scheduled
 * job's post, or the post made when the app is installed. 'manual' is an
 * extra post made from the moderator menu.
 */
export type PostKind = 'daily' | 'manual';

/** Everything fixed about a post, saved when it is created. */
export type PostRecord = {
  /** The N in "Twin Shadows #N": this post's place among all posts created. */
  number: number;
  kind: PostKind;
  /** This post's place among daily posts, from 1. Null for a manual post. */
  daily: number | null;
  /** UTC date the post was created, YYYY-MM-DD. */
  date: string;
  /** The post's own copy of its puzzle, id included. Never re-read from the queue. */
  puzzle: Puzzle;
};

export type CreatedPost = PostRecord & { postId: string };
export type DailyPostOutcome = 'created' | 'too-early' | 'already-created';

export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

/** The next unused puzzle of a tier, wrapping to the tier's first when it runs out. */
const nextPuzzleOfTier = async (tier: Tier): Promise<Puzzle> => {
  const pool = puzzlesOfTier(tier);
  // incrBy is atomic, so two posts created at once still get different puzzles.
  const used = await redis.incrBy(KEYS.tierCounter(tier), 1);
  const puzzle = pool[(used - 1) % pool.length];
  if (!puzzle) throw new Error(`The queue has no tier ${tier} puzzles`);
  if (used > pool.length) {
    console.warn(
      `Tier ${tier} exhausted: its post ${used} reuses puzzle ${puzzle.id} (${pool.length} in the tier). Generate more puzzles.`
    );
  }
  return puzzle;
};

/**
 * Creates one post. The one way posts are made: the daily job, the install
 * trigger and the moderator menu item all end up here. The puzzle comes from
 * the tier for the current UTC weekday, and the post keeps its own copy.
 */
export const createNextPost = async (kind: PostKind, now: Date = new Date()): Promise<CreatedPost> => {
  const number = await redis.incrBy(KEYS.postCounter, 1);
  const post = await reddit.submitCustomPost({
    title: `Twin Shadows #${number}`,
    postData: { postNumber: number },
  });
  // Chosen once Reddit has accepted the post, so a failed post uses up a
  // number but never a puzzle or a place in the daily sequence.
  const puzzle = await nextPuzzleOfTier(tierForDate(now));
  const daily = kind === 'daily' ? await redis.incrBy(KEYS.dailyCounter, 1) : null;
  const record: PostRecord = { number, kind, daily, date: utcDate(now), puzzle };
  await redis.set(KEYS.post(post.id), JSON.stringify(record));
  return { ...record, postId: post.id };
};

/** The saved record of a post, or null for a post this app version did not create. */
export const loadPost = async (postId: string): Promise<PostRecord | null> => {
  const json = await redis.get(KEYS.post(postId));
  if (json === undefined) return null;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return null;
  if (!('number' in value) || !('kind' in value) || !('daily' in value) || !('date' in value) || !('puzzle' in value)) {
    return null;
  }
  const { number, kind, daily, date } = value;
  const puzzle = parsePuzzle(value.puzzle);
  if (typeof number !== 'number' || typeof date !== 'string' || !puzzle) return null;
  if (kind !== 'daily' && kind !== 'manual') return null;
  if (daily !== null && typeof daily !== 'number') return null;
  return { number, kind, daily, date, puzzle };
};

/** How many daily posts exist, which is also the `daily` value of the newest one. */
export const newestDaily = async (): Promise<number> => Number((await redis.get(KEYS.dailyCounter)) ?? 0);

const PENDING = 'pending:';

/**
 * Claims a UTC date for the run that will create its daily post. Returns the
 * claim on success, or null when the date already has a post or another run
 * is working on it.
 */
const claimDate = async (date: string, now: number): Promise<string | null> => {
  const claim = `${PENDING}${now}`;
  // hSetNX writes only when the field is new: of two runs at once, one gets 1.
  if ((await redis.hSetNX(KEYS.postDates, date, claim)) === 1) return claim;

  const current = await redis.hGet(KEYS.postDates, date);
  if (current === undefined || !current.startsWith('pending')) return null;
  const claimedAt = Number(current.slice(PENDING.length));
  // A fresh claim belongs to a run still at work. (A claim with no readable
  // time counts as stale.)
  if (now - claimedAt <= STALE_CLAIM_MS) return null;

  // The run that made this claim died before recording a post. Each stale
  // claim has its own takeover field, so only one run can win it.
  if ((await redis.hSetNX(KEYS.takeovers, `${date}|${current}`, String(now))) !== 1) return null;
  await redis.hSet(KEYS.postDates, { [date]: claim });
  return claim;
};

/**
 * Creates the daily post for the UTC date of `now`, unless that date already
 * has one. Safe to run any number of times and from overlapping requests.
 */
export const createDailyPost = async (now: Date): Promise<DailyPostOutcome> => {
  const date = utcDate(now);
  const claim = await claimDate(date, now.getTime());
  if (!claim) return 'already-created';
  try {
    const { postId } = await createNextPost('daily', now);
    await redis.hSet(KEYS.postDates, { [date]: postId });
    return 'created';
  } catch (error) {
    // Release the claim so the next run can try again, unless it is no
    // longer ours.
    if ((await redis.hGet(KEYS.postDates, date)) === claim) await redis.hDel(KEYS.postDates, [date]);
    throw error;
  }
};

/** The scheduled job: does nothing before the posting hour, then posts once per UTC date. */
export const runDailyPost = async (now: Date): Promise<DailyPostOutcome> =>
  now.getUTCHours() < DAILY_POST_UTC_HOUR ? 'too-early' : createDailyPost(now);
