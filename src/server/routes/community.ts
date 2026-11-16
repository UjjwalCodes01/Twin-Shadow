// Routes for puzzles made by players: sending one, and the moderators' review.

import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { MakePuzzleResponse, ReviewResponse } from '../../shared/api';
import { parseMakePuzzleRequest, parseReviewRequest } from '../../shared/api';
import { pendingAt, reviewPuzzle, sendPuzzle } from '../core/community';
import { callerIsModerator } from '../core/moderators';

// Mounted at /api/community in index.ts.
export const community = new Hono();

// A player sends the sculpture they built. The server works out the puzzle
// from it: the client is never asked for the silhouettes or for par.
community.post('/puzzles', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<MakePuzzleResponse>(
      { status: 'refused', reason: 'logged-out', message: 'Log in to make a puzzle.' },
      401
    );
  }
  const body: unknown = await c.req.json().catch(() => null);
  const request = parseMakePuzzleRequest(body);
  if (!request) {
    return c.json<MakePuzzleResponse>(
      { status: 'refused', reason: 'malformed', message: 'That puzzle could not be read.' },
      400
    );
  }
  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'unknown';
  const outcome = await sendPuzzle({ userId, username }, request.size, request.blocks, Date.now());
  return c.json<MakePuzzleResponse>(outcome, outcome.status === 'sent' ? 200 : 422);
});

const NOT_A_MODERATOR = { status: 'refused', message: 'Only moderators can review puzzles.' } as const;

/** How many puzzles wait, and the one at a place in the line, oldest first. */
const waiting = async (at: number): Promise<ReviewResponse> => ({ status: 'ok', ...(await pendingAt(at)) });

// Both review routes check for themselves that the caller moderates this subreddit.
// `?at=2` asks for the second puzzle in the line; without it, the one that has waited longest.
community.get('/review', async (c) => {
  if (!(await callerIsModerator())) return c.json<ReviewResponse>(NOT_A_MODERATOR, 403);
  return c.json<ReviewResponse>(await waiting(Number(c.req.query('at'))));
});

community.post('/review', async (c) => {
  if (!(await callerIsModerator())) {
    console.warn(`Review refused: ${context.username ?? 'a logged-out caller'} is not a moderator`);
    return c.json<ReviewResponse>(NOT_A_MODERATOR, 403);
  }
  const body: unknown = await c.req.json().catch(() => null);
  const request = parseReviewRequest(body);
  if (!request) return c.json<ReviewResponse>({ status: 'refused', message: 'That review could not be read.' }, 400);
  const done = await reviewPuzzle(request.id, request.decision, Date.now());
  if (done) console.log(`Community puzzle ${request.id}: ${request.decision} by ${context.username ?? 'a moderator'}`);
  // Whether or not this review was the one that counted, the answer is what now
  // stands where the moderator was looking: the next puzzle in the line.
  return c.json<ReviewResponse>(await waiting(request.at));
});
