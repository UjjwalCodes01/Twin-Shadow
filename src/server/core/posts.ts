import { reddit, redis } from '@devvit/web/server';
import { parsePuzzle } from '../../shared/api';
import { isCommunityDay, tierForDate, type Puzzle, type Tier } from '../../shared/puzzle';
import { markUsed, takeApproved, type CommunityPuzzle, type Maker } from './community';
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
  /** The player who made the puzzle, or null for a generated one. */
  maker: Maker | null;
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
 *
 * TEMPORARY: `communityNow` makes a post from the oldest approved community
 * puzzle whatever the day and the kind, for the dev subreddit's test menu
 * item. To remove: delete the parameter and its one use below.
 */
export const createNextPost = async (
  kind: PostKind,
  now: Date = new Date(),
  communityNow = false
): Promise<CreatedPost> => {
  const number = await redis.incrBy(KEYS.postCounter, 1);
  const post = await reddit.submitCustomPost({
    title: `Twin Shadows #${number}`,
    postData: { postNumber: number },
  });
  // Chosen once Reddit has accepted the post, so a failed post uses up a
  // number but never a puzzle or a place in the daily sequence.
  // On the community's day the daily post is the approved puzzle that has
  // waited longest. With none waiting, it is the generated puzzle as usual.
  const fromCommunity = communityNow || (kind === 'daily' && isCommunityDay(now));
  const community: CommunityPuzzle | null = fromCommunity ? await takeApproved() : null;
  const puzzle = community ? community.puzzle : await nextPuzzleOfTier(tierForDate(now));
  const maker = community ? community.maker : null;
  const daily = kind === 'daily' ? await redis.incrBy(KEYS.dailyCounter, 1) : null;
  const record: PostRecord = { number, kind, daily, date: utcDate(now), puzzle, maker };
  await redis.set(KEYS.post(post.id), JSON.stringify(record));
  if (community && maker) {
    // The maker cannot submit their own puzzle; this lets their streak carry across the day.
    if (daily !== null) await redis.hSet(KEYS.dailyMakers, { [String(daily)]: maker.userId });
    // What the maker is told when they next open "Make a puzzle".
    await markUsed(community, record.date);
    await creditMaker(post.id, maker.username);
  }
  return { ...record, postId: post.id };
};

/** The comment that credits a puzzle's maker. Only their username: makers give no other text. */
export const creditText = (username: string): string => `Today's puzzle was made by u/${username}.`;

/**
 * Adds one comment from the app's account crediting the maker, and pins it.
 * A bonus: it never throws, so a failure here cannot undo the post.
 */
const creditMaker = async (postId: string, username: string): Promise<void> => {
  try {
    if (!postId.startsWith('t3_')) return;
    const comment = await reddit.submitComment({ id: `t3_${postId.slice(3)}`, text: creditText(username) });
    try {
      // Distinguished as a moderator and stuck to the top of the comments.
      await comment.distinguish(true);
    } catch (error) {
      console.warn(`Could not pin the credit comment on ${postId}: ${error}`);
    }
  } catch (error) {
    console.error(`Could not credit ${username} on ${postId}: ${error}`);
  }
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
  return { number, kind, daily, date, puzzle, maker: parseMaker(value) };
};

/** The maker in a saved post record. A post from before community puzzles has none. */
const parseMaker = (record: object): Maker | null => {
  if (!('maker' in record)) return null;
  const { maker } = record;
  if (typeof maker !== 'object' || maker === null || !('userId' in maker) || !('username' in maker)) return null;
  return typeof maker.userId === 'string' && typeof maker.username === 'string'
    ? { userId: maker.userId, username: maker.username }
    : null;
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
