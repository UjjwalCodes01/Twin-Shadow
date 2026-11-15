import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  DebugPuzzleResponse,
  GalleryResponse,
  PuzzleResponse,
  ResultResponse,
  SubmitRejection,
  SubmitResponse,
} from '../../shared/api';
import { isGallerySort, parseSubmitRequest } from '../../shared/api';
import { isSolved } from '../../shared/logic';
import { isDevSubreddit } from '../core/dev';
import { loadPost, type PostRecord } from '../core/posts';
import { QUEUE, puzzleByNumber } from '../core/queue';
import { acceptSubmission, buildGallery, buildResult } from '../core/scores';
import { getStored, getSubmission } from '../core/submissions';

// Mounted at /api in index.ts, so every route here starts with /api/.
export const api = new Hono();

const NO_PUZZLE = 'This post has no puzzle.';

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
  const { puzzle } = current.post;
  return c.json<PuzzleResponse>({
    puzzle,
    canSubmit: userId !== undefined,
    // Read with the caller's own id, so nobody receives another player's sculpture.
    submission: userId ? await getSubmission(current.postId, userId, puzzle) : null,
    debug: isDevSubreddit(subredditName),
  });
});

const REJECTIONS: Record<SubmitRejection, { status: 400 | 401 | 404 | 422; message: string }> = {
  'no-puzzle': { status: 404, message: NO_PUZZLE },
  'logged-out': { status: 401, message: 'Log in to submit your solution.' },
  'malformed': { status: 400, message: 'That submission could not be read.' },
  'not-solved': { status: 422, message: 'That sculpture does not solve the puzzle.' },
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
  const { status, submission } = await acceptSubmission(
    postId,
    post,
    { userId, username },
    request.blocks,
    Date.now()
  );
  return c.json<SubmitResponse>({ status, submission });
});

const NOT_SUBMITTED = { status: 'not-submitted', message: 'Submit your solution to see the results.' } as const;

// Results are only for players who have submitted, so nobody can read the
// leaderboard or the record before solving.
api.get('/result', async (c) => {
  const { userId } = context;
  const current = await currentPost();
  if (!current) return c.json({ status: 'error', message: NO_PUZZLE }, 404);
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
  if (!stored) return c.json<GalleryResponse>(NOT_SUBMITTED, 403);
  const sort = c.req.query('sort');
  const gallery = await buildGallery(stored, isGallerySort(sort) ? sort : 'rarest', Number(c.req.query('page')));
  return c.json<GalleryResponse>({ status: 'ok', gallery });
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
