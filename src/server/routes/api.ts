import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  DebugPuzzleResponse,
  GalleryResponse,
  JoinResponse,
  OnboardingResponse,
  PrefsRequest,
  PuzzleResponse,
  ResultResponse,
  ShareResponse,
  SplashResponse,
  SubmitRejection,
  SubmitResponse,
} from '../../shared/api';
import {
  isGallerySort,
  parseJoinRequest,
  parseOnboardingRequest,
  parsePrefsRequest,
  parseSoundReport,
  parseSubmitRequest,
} from '../../shared/api';
import { makerStatus, pendingCount } from '../core/community';
import { isSolved } from '../../shared/logic';
import { isDevSubreddit } from '../core/dev';
import { loadPost, type PostRecord } from '../core/posts';
import { QUEUE, puzzleByNumber } from '../core/queue';
import { callerIsModerator } from '../core/moderators';
import { BRAND_NEW, getOnboarding, recordOnboarding } from '../core/onboarding';
import { isMuted, setMuted } from '../core/prefs';
import {
  acceptSubmission,
  buildGallery,
  buildMakerResult,
  buildResult,
  currentStreak,
  solverCount,
} from '../core/scores';
import { answerJoinPrompt, shareResult } from '../core/share';
import { getStored, getSubmission } from '../core/submissions';

// Mounted at /api in index.ts, so every route here starts with /api/.
export const api = new Hono();

const NO_PUZZLE = 'This post has no puzzle.';

/** Whether a player made the puzzle of a post. A maker sees its results but is never ranked on it. */
const isMaker = (post: PostRecord, userId: string | undefined): boolean =>
  userId !== undefined && post.maker?.userId === userId;

/** The saved record of the post this request comes from, with its own puzzle copy. */
const currentPost = async (): Promise<{ postId: string; post: PostRecord } | null> => {
  const { postId } = context;
  if (!postId) return null;
  const post = await loadPost(postId);
  // Logged, so a post that cannot be played shows up in `devvit logs`.
  if (!post) console.warn(`No saved puzzle for post ${postId}`);
  return post ? { postId, post } : null;
};

api.get('/puzzle', async (c) => {
  const { userId, subredditName } = context;
  const current = await currentPost();
  if (!current) return c.json({ status: 'error', message: NO_PUZZLE }, 404);
  const { puzzle, maker } = current.post;
  return c.json<PuzzleResponse>({
    puzzle,
    canSubmit: userId !== undefined,
    // Read with the caller's own id, so nobody receives another player's sculpture.
    submission: userId ? await getSubmission(current.postId, userId, puzzle) : null,
    debug: isDevSubreddit(subredditName),
    // A logged-out visitor has no record, so counts as new; the client remembers for them.
    onboarding: userId ? await getOnboarding(userId) : BRAND_NEW,
    post: current.post.number,
    // The only credit a community puzzle carries: its maker's username.
    maker: maker?.username ?? null,
    yours: isMaker(current.post, userId),
    community: {
      ...(await makerStatus(userId, Date.now())),
      // The count is for moderators only; everyone else gets null.
      review: (await callerIsModerator()) ? await pendingCount() : null,
    },
    muted: userId ? await isMuted(userId) : false,
  });
});

// What the inline view in the feed shows: the post's number and date, the two
// silhouettes, how many have solved it, and the caller's own result and
// streak. The silhouettes are what every player is shown anyway; no
// sculpture, no par before solving, and nothing of any other player's.
api.get('/splash', async (c) => {
  const { userId } = context;
  const current = await currentPost();
  if (!current) return c.json({ status: 'error', message: NO_PUZZLE }, 404);
  const { postId, post } = current;
  const { puzzle } = post;
  const own = userId ? await getSubmission(postId, userId, puzzle) : null;
  return c.json<SplashResponse>({
    number: post.number,
    date: post.date,
    size: puzzle.size,
    front: puzzle.front,
    side: puzzle.side,
    played: own ? { blocks: own.blocks, par: own.par, stars: own.stars } : null,
    streak: userId ? await currentStreak(userId) : null,
    solvers: await solverCount(postId),
    maker: post.maker?.username ?? null,
  });
});

// Remembers whether a player has turned sound off, so it follows them to another device.
api.post('/prefs', async (c) => {
  const { userId } = context;
  if (!userId) return c.json({ status: 'failed', message: 'Log in to be remembered.' }, 401);
  const body: unknown = await c.req.json().catch(() => null);
  const request: PrefsRequest | null = parsePrefsRequest(body);
  if (!request) return c.json({ status: 'failed', message: 'That could not be read.' }, 400);
  await setMuted(userId, request.muted);
  return c.json({ status: 'ok' });
});

// One log line the first time a session plays a sound, so it can be seen in
// `devvit logs` that sound really starts on players' devices. Nothing is
// stored. `state` is what the device's audio set-up said at that moment:
// 'running' is sound that can be heard.
api.post('/sound', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const report = parseSoundReport(body);
  if (!report) return c.json({ status: 'failed', message: 'That could not be read.' }, 400);
  console.log(`Sound: first sound of a session for ${context.username ?? 'a logged-out visitor'} (audio ${report.state})`);
  return c.json({ status: 'ok' });
});

// Remembers that a first-time player has finished or skipped the warm-up, or
// has seen the first-solve hint, so neither is shown to them again.
api.post('/onboarding', async (c) => {
  const { userId } = context;
  if (!userId) return c.json<OnboardingResponse>({ status: 'failed', message: 'Log in to be remembered.' }, 401);
  const body: unknown = await c.req.json().catch(() => null);
  const request = parseOnboardingRequest(body);
  if (!request) return c.json<OnboardingResponse>({ status: 'failed', message: 'That could not be read.' }, 400);
  await recordOnboarding(userId, request.event);
  return c.json<OnboardingResponse>({ status: 'ok' });
});

const REJECTIONS: Record<SubmitRejection, { status: 400 | 401 | 403 | 404 | 422; message: string }> = {
  'no-puzzle': { status: 404, message: NO_PUZZLE },
  'logged-out': { status: 401, message: 'Log in to submit your solution.' },
  'malformed': { status: 400, message: 'That submission could not be read.' },
  'not-solved': { status: 422, message: 'That sculpture does not solve the puzzle.' },
  'own-puzzle': { status: 403, message: 'You made this puzzle, so you are not ranked on it.' },
};

api.post('/submit', async (c) => {
  const reject = (reason: SubmitRejection) => {
    const { status, message } = REJECTIONS[reason];
    return c.json<SubmitResponse>({ status: 'rejected', reason, message }, status);
  };

  const { userId } = context;
  const current = await currentPost();
  if (!current) return reject('no-puzzle');
  if (!userId) return reject('logged-out');
  const { postId, post } = current;
  // The maker knows the answer: they can look, but never take a place on the board.
  if (isMaker(post, userId)) return reject('own-puzzle');

  const body: unknown = await c.req.json().catch(() => null);
  const request = parseSubmitRequest(body, post.puzzle.size);
  if (!request) return reject('malformed');

  // Only the first submission counts. A later attempt, valid or not, gets the
  // stored result back and changes nothing.
  const existing = await getSubmission(postId, userId, post.puzzle);
  if (existing) return c.json<SubmitResponse>({ status: 'already-submitted', submission: existing });

  // The server decides whether it is solved. Nothing the client claims is used.
  if (!isSolved(new Set(request.blocks), post.puzzle)) return reject('not-solved');

  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'unknown';
  const outcome = await acceptSubmission(postId, post, { userId, username }, request.blocks, Date.now());
  // Checked above already; the store checks again for itself.
  if (outcome.status === 'own-puzzle') return reject('own-puzzle');
  return c.json<SubmitResponse>({ status: outcome.status, submission: outcome.submission });
});

const NOT_SUBMITTED = { status: 'not-submitted', message: 'Submit your solution to see the results.' } as const;

// Results are only for players who have submitted, so nobody can read the
// leaderboard or the record before solving.
api.get('/result', async (c) => {
  const { userId } = context;
  const current = await currentPost();
  if (!current) return c.json({ status: 'error', message: NO_PUZZLE }, 404);
  // The puzzle's maker sees how players are doing without having submitted, and with no place of their own.
  if (isMaker(current.post, userId)) {
    return c.json<ResultResponse>({ status: 'maker', result: await buildMakerResult(current.post, current.postId) });
  }
  const stored = userId ? await getStored(current.postId, userId) : null;
  if (!stored) return c.json<ResultResponse>(NOT_SUBMITTED, 403);
  return c.json<ResultResponse>({ status: 'ok', result: await buildResult(current.post, stored) });
});

// The gallery holds other players' sculptures, which are answers. Like the
// result, it is only for a player who has already submitted for this post.
api.get('/gallery', async (c) => {
  const { userId } = context;
  const current = await currentPost();
  if (!current) return c.json({ status: 'error', message: NO_PUZZLE }, 404);
  const stored = userId ? await getStored(current.postId, userId) : null;
  // The maker already knows an answer, so the others' are no secret from them.
  if (!stored && !isMaker(current.post, userId)) return c.json<GalleryResponse>(NOT_SUBMITTED, 403);
  const sort = c.req.query('sort');
  const gallery = await buildGallery(
    current.postId,
    stored,
    isGallerySort(sort) ? sort : 'rarest',
    Number(c.req.query('page'))
  );
  return c.json<GalleryResponse>({ status: 'ok', gallery });
});

// Posts the caller's result as a comment on the post. The client calls this
// only from the player's own tap on Share, after Reddit's consent check. Like
// the result itself, it is only for a player who has submitted.
api.post('/share', async (c) => {
  const { userId } = context;
  const current = await currentPost();
  if (!current) return c.json({ status: 'error', message: NO_PUZZLE }, 404);
  const stored = userId ? await getStored(current.postId, userId) : null;
  if (!stored) return c.json<ShareResponse>(NOT_SUBMITTED, 403);
  const outcome = await shareResult(current.postId, current.post, stored);
  if (outcome === 'failed') {
    return c.json<ShareResponse>({ status: 'failed', message: "Couldn't share your result. Try again." }, 502);
  }
  return c.json<ShareResponse>({ status: outcome });
});

// Records the caller's answer to the "Join the community" prompt, and for
// 'join' subscribes them to this subreddit. Called only from the player's
// own tap on one of the prompt's two buttons.
api.post('/join', async (c) => {
  const { userId } = context;
  if (!userId) return c.json<JoinResponse>({ status: 'failed', message: 'Log in to join.' }, 401);
  const body: unknown = await c.req.json().catch(() => null);
  const request = parseJoinRequest(body);
  if (!request) return c.json<JoinResponse>({ status: 'failed', message: 'That answer could not be read.' }, 400);
  if (!(await answerJoinPrompt(userId, request.choice))) {
    return c.json<JoinResponse>({ status: 'failed', message: "Couldn't join. Try again." }, 502);
  }
  return c.json<JoinResponse>({ status: 'ok' });
});

// TEMPORARY: lets the dev subreddit play any puzzle in the queue. Anywhere
// else this route answers 404, as if it did not exist. Remove with the rest
// of the debug code.
api.get('/debug/puzzle/:number', (c) => {
  const puzzle = isDevSubreddit(context.subredditName)
    ? puzzleByNumber(Number(c.req.param('number')))
    : undefined;
  if (!puzzle) return c.json({ status: 'error', message: 'Not found' }, 404);
  return c.json<DebugPuzzleResponse>({ puzzle, count: QUEUE.length });
});
