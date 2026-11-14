import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import type { DebugPuzzleResponse, PuzzleResponse } from '../../shared/api';
import { isDevSubreddit, todayResponse } from '../core/puzzle';
import { QUEUE, puzzleByNumber } from '../core/queue';

// Mounted at /api in index.ts, so every route here starts with /api/.
export const api = new Hono();

api.get('/puzzle/today', (c) => c.json<PuzzleResponse>(todayResponse(context.subredditName)));

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
