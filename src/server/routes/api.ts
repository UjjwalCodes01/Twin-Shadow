import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import type {
  DebugPuzzleResponse,
  PuzzleResponse,
  SubmitRejection,
  SubmitResponse,
} from '../../shared/api';
import { parseSubmitRequest } from '../../shared/api';
import { isSolved } from '../../shared/logic';
import type { Puzzle } from '../../shared/puzzle';
import { isDevSubreddit } from '../core/dev';
import { puzzleNumberForPost } from '../core/posts';
import { QUEUE, puzzleByNumber } from '../core/queue';
import { getSubmission, recordFirstLoad, storeSubmission } from '../core/submissions';

// Mounted at /api in index.ts, so every route here starts with /api/.
export const api = new Hono();

/** The puzzle tied to the post this request comes from. */
const puzzleForCurrentPost = async (): Promise<Puzzle | undefined> => {
  const { postId, postData } = context;
  if (!postId) return undefined;
  const number = await puzzleNumberForPost(postId, postData);
  return number === undefined ? undefined : puzzleByNumber(number);
};

api.get('/puzzle', async (c) => {
  const { postId, userId, subredditName } = context;
  const puzzle = await puzzleForCurrentPost();
  if (!postId || !puzzle) {
    return c.json({ status: 'error', message: 'This post has no puzzle.' }, 404);
  }
  let submission: PuzzleResponse['submission'] = null;
  if (userId) {
    await recordFirstLoad(postId, userId, Date.now());
    submission = await getSubmission(postId, userId, puzzle);
  }
  return c.json<PuzzleResponse>({
    puzzle,
    canSubmit: userId !== undefined,
    submission,
    debug: isDevSubreddit(subredditName),
  });
});

const REJECTIONS: Record<SubmitRejection, { status: 400 | 401 | 404 | 422; message: string }> = {
  'no-puzzle': { status: 404, message: 'This post has no puzzle.' },
  'logged-out': { status: 401, message: 'Log in to submit your solution.' },
  'malformed': { status: 400, message: 'That submission could not be read.' },
  'not-solved': { status: 422, message: 'That sculpture does not solve the puzzle.' },
};

api.post('/submit', async (c) => {
  const reject = (reason: SubmitRejection) => {
    const { status, message } = REJECTIONS[reason];
    return c.json<SubmitResponse>({ status: 'rejected', reason, message }, status);
  };

  const { postId, userId } = context;
  const puzzle = await puzzleForCurrentPost();
  if (!postId || !puzzle) return reject('no-puzzle');
  if (!userId) return reject('logged-out');

  const body: unknown = await c.req.json().catch(() => null);
  const request = parseSubmitRequest(body, puzzle.size);
  if (!request) return reject('malformed');

  // Only the first submission counts. A later attempt, valid or not, gets the
  // stored result back and changes nothing.
  const existing = await getSubmission(postId, userId, puzzle);
  if (existing) return c.json<SubmitResponse>({ status: 'already-submitted', submission: existing });

  // The server decides whether it is solved. Nothing the client claims is used.
  if (!isSolved(new Set(request.blocks), puzzle)) return reject('not-solved');

  const result = await storeSubmission(postId, userId, puzzle, request.blocks, Date.now());
  return c.json<SubmitResponse>(result);
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
