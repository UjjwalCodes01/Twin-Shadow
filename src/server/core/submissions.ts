import { redis } from '@devvit/web/server';
import type { Submission } from '../../shared/api';
import type { Puzzle } from '../../shared/puzzle';
import { canonicalSculpture, starsFor } from '../../shared/score';
import { KEYS } from './keys';
import type { PostRecord } from './posts';

/** What is kept in Redis for each counted submission. */
export type StoredSubmission = {
  userId: string;
  /** The player's name when they submitted, for the leaderboard. */
  username: string;
  postId: string;
  puzzleId: string;
  /** Number of blocks in the sculpture. */
  blocks: number;
  /** The sculpture in canonical form: block keys sorted and joined with ';'. */
  sculpture: string;
  /** Server time of the submission, in milliseconds. */
  submittedAt: number;
};

export const parseStored = (json: string | null | undefined): StoredSubmission | null => {
  if (json === undefined || json === null) return null;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return null;
  if (
    !('userId' in value) ||
    !('username' in value) ||
    !('postId' in value) ||
    !('puzzleId' in value) ||
    !('blocks' in value) ||
    !('sculpture' in value) ||
    !('submittedAt' in value)
  ) {
    return null;
  }
  const { userId, username, postId, puzzleId, blocks, sculpture, submittedAt } = value;
  if (typeof userId !== 'string' || typeof username !== 'string' || typeof postId !== 'string') return null;
  if (typeof puzzleId !== 'string' || typeof sculpture !== 'string') return null;
  if (typeof blocks !== 'number' || typeof submittedAt !== 'number') return null;
  return { userId, username, postId, puzzleId, blocks, sculpture, submittedAt };
};

/** A stored submission in the form the player sees. Stars are worked out here, never stored. */
const forPlayer = (stored: StoredSubmission, puzzle: Puzzle): Submission => ({
  blocks: stored.blocks,
  par: puzzle.par,
  stars: starsFor(stored.blocks, puzzle.par),
  sculpture: stored.sculpture === '' ? [] : stored.sculpture.split(';'),
});

/** The caller's own stored record for a post. Only ever read with the caller's user id. */
export const getStored = async (postId: string, userId: string): Promise<StoredSubmission | null> =>
  parseStored(await redis.hGet(KEYS.submissions(postId), userId));

export const getSubmission = async (
  postId: string,
  userId: string,
  puzzle: Puzzle
): Promise<Submission | null> => {
  const stored = await getStored(postId, userId);
  return stored ? forPlayer(stored, puzzle) : null;
};

export type StoreOutcome =
  | {
      status: 'accepted' | 'already-submitted';
      submission: Submission;
      /** The record now in Redis: the new one when accepted, the earlier one otherwise. */
      stored: StoredSubmission;
    }
  /** The player made this post's puzzle. Nothing was stored. */
  | { status: 'own-puzzle' };

/**
 * Stores a sculpture the caller has already checked with isSolved. Only a
 * player's first submission for a post is kept: hSetNX writes only when the
 * field is new, so of two requests at once exactly one is 'accepted'.
 * Routes call acceptSubmission in scores.ts, which also updates the counts.
 *
 * The maker of the post's puzzle is turned away here, before anything is
 * written, whatever the route did: a maker knows the answer, so no record of
 * theirs may exist for the leaderboard, the counts or the gallery to pick up.
 */
export const storeSubmission = async (
  postId: string,
  post: PostRecord,
  player: { userId: string; username: string },
  blocks: readonly string[],
  now: number
): Promise<StoreOutcome> => {
  const { userId, username } = player;
  if (post.maker?.userId === userId) return { status: 'own-puzzle' };
  const record: StoredSubmission = {
    userId,
    username,
    postId,
    puzzleId: post.puzzle.id,
    blocks: blocks.length,
    sculpture: canonicalSculpture(blocks),
    submittedAt: now,
  };
  const written = await redis.hSetNX(KEYS.submissions(postId), userId, JSON.stringify(record));
  if (written === 1) {
    return { status: 'accepted', submission: forPlayer(record, post.puzzle), stored: record };
  }

  const existing = await getStored(postId, userId);
  if (!existing) throw new Error(`Stored submission for ${userId} on ${postId} is unreadable`);
  return { status: 'already-submitted', submission: forPlayer(existing, post.puzzle), stored: existing };
};
