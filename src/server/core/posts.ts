import { reddit, redis } from '@devvit/web/server';
import { KEYS } from './keys';
import { QUEUE, puzzleByNumber } from './queue';

/** The daily post goes out at this hour, UTC. */
export const DAILY_POST_UTC_HOUR = 5;

export type CreatedPost = { postId: string; number: number };
export type DailyPostOutcome = 'created' | 'too-early' | 'already-created';

export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Creates the post for the next puzzle in the queue. The one way posts are
 * made: the daily job, the moderator menu item and the install trigger all
 * call this.
 */
export const createNextPost = async (now: Date = new Date()): Promise<CreatedPost> => {
  // incrBy is atomic, so two posts created at once still get different puzzles.
  const created = await redis.incrBy(KEYS.postCounter, 1);
  const number = ((created - 1) % QUEUE.length) + 1;
  if (created > QUEUE.length) {
    console.warn(
      `Puzzle queue exhausted: post ${created} reuses puzzle ${number} of ${QUEUE.length}. Generate more puzzles.`
    );
  }
  // The number travels with the post, so an old post keeps its own puzzle.
  const post = await reddit.submitCustomPost({
    title: `Twin Shadows #${number}`,
    postData: { puzzleNumber: number },
  });
  await redis.set(KEYS.postPuzzle(post.id), String(number));
  await redis.hSet(KEYS.postDates, { [utcDate(now)]: post.id });
  return { postId: post.id, number };
};

/** The puzzle number a post was created with. */
export const puzzleNumberForPost = async (
  postId: string,
  postData: Readonly<Record<string, unknown>> | undefined
): Promise<number | undefined> => {
  const fromPost = postData?.puzzleNumber;
  if (typeof fromPost === 'number' && puzzleByNumber(fromPost)) return fromPost;
  const stored = Number(await redis.get(KEYS.postPuzzle(postId)));
  return puzzleByNumber(stored) ? stored : undefined;
};

/**
 * Creates today's post, once. Safe to run any number of times: it does
 * nothing before the posting hour, and nothing if a post already exists for
 * this UTC date, whichever path created it.
 */
export const runDailyPost = async (now: Date): Promise<DailyPostOutcome> => {
  if (now.getUTCHours() < DAILY_POST_UTC_HOUR) return 'too-early';
  const date = utcDate(now);
  // hSetNX claims the date atomically: of two runs at once, only one gets 1.
  const claimed = await redis.hSetNX(KEYS.postDates, date, 'pending');
  if (claimed !== 1) return 'already-created';
  try {
    await createNextPost(now);
    return 'created';
  } catch (error) {
    // Release the claim so the next run can try again.
    await redis.hDel(KEYS.postDates, [date]);
    throw error;
  }
};
