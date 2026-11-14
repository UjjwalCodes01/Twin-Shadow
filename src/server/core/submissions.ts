import { redis } from '@devvit/web/server';
import type { Submission } from '../../shared/api';
import type { Puzzle } from '../../shared/puzzle';
import { canonicalSculpture, starsFor } from '../../shared/score';
import { KEYS } from './keys';

/** What is kept in Redis for each counted submission. */
export type StoredSubmission = {
  userId: string;
  postId: string;
  puzzleNumber: number;
  /** Number of blocks in the sculpture. */
  blocks: number;
  /** The sculpture in canonical form: block keys sorted and joined with ';'. */
  sculpture: string;
  /** Server time of the submission, in milliseconds. */
  submittedAt: number;
  /** Seconds since this player first loaded this post's puzzle, when known. */
  seconds: number | null;
};

const parseStored = (json: string | undefined): StoredSubmission | null => {
  if (json === undefined) return null;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return null;
  if (
    !('userId' in value) ||
    !('postId' in value) ||
    !('puzzleNumber' in value) ||
    !('blocks' in value) ||
    !('sculpture' in value) ||
    !('submittedAt' in value) ||
    !('seconds' in value)
  ) {
    return null;
  }
  const { userId, postId, puzzleNumber, blocks, sculpture, submittedAt, seconds } = value;
  if (typeof userId !== 'string' || typeof postId !== 'string' || typeof sculpture !== 'string') return null;
  if (typeof puzzleNumber !== 'number' || typeof blocks !== 'number' || typeof submittedAt !== 'number') {
    return null;
  }
  if (seconds !== null && typeof seconds !== 'number') return null;
  return { userId, postId, puzzleNumber, blocks, sculpture, submittedAt, seconds };
};

/** A stored submission in the form the player sees. Stars are worked out here, never stored. */
const forPlayer = (stored: StoredSubmission, puzzle: Puzzle): Submission => ({
  blocks: stored.blocks,
  par: puzzle.par,
  stars: starsFor(stored.blocks, puzzle.par),
  seconds: stored.seconds,
  sculpture: stored.sculpture === '' ? [] : stored.sculpture.split(';'),
});

/** Notes when a player first loaded a post's puzzle. Later calls change nothing. */
export const recordFirstLoad = async (postId: string, userId: string, now: number): Promise<void> => {
  await redis.hSetNX(KEYS.firstLoads(postId), userId, String(now));
};

export const getSubmission = async (
  postId: string,
  userId: string,
  puzzle: Puzzle
): Promise<Submission | null> => {
  const stored = parseStored(await redis.hGet(KEYS.submissions(postId), userId));
  return stored ? forPlayer(stored, puzzle) : null;
};

/**
 * Records a sculpture the caller has already checked with isSolved. Only a
 * player's first submission for a post is kept: hSetNX writes only when the
 * field is new, so two requests at once cannot both be stored.
 */
export const storeSubmission = async (
  postId: string,
  userId: string,
  puzzle: Puzzle,
  blocks: readonly string[],
  now: number
): Promise<{ status: 'accepted' | 'already-submitted'; submission: Submission }> => {
  const startedAt = Number(await redis.hGet(KEYS.firstLoads(postId), userId));
  const record: StoredSubmission = {
    userId,
    postId,
    puzzleNumber: puzzle.number,
    blocks: blocks.length,
    sculpture: canonicalSculpture(blocks),
    submittedAt: now,
    seconds: startedAt > 0 ? Math.max(0, Math.round((now - startedAt) / 1000)) : null,
  };
  const written = await redis.hSetNX(KEYS.submissions(postId), userId, JSON.stringify(record));
  if (written === 1) return { status: 'accepted', submission: forPlayer(record, puzzle) };

  const existing = parseStored(await redis.hGet(KEYS.submissions(postId), userId));
  if (!existing) throw new Error(`Stored submission for ${userId} on ${postId} is unreadable`);
  return { status: 'already-submitted', submission: forPlayer(existing, puzzle) };
};
