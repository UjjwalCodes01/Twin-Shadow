// What a first-time player has been through: the warm-up puzzle, and the hint
// shown the first time one of their sculptures is a valid solve. Remembered
// per player, so neither comes back.

import { redis } from '@devvit/web/server';
import type { Onboarding, OnboardingEvent } from '../../shared/api';
import { KEYS } from './keys';

/** How the warm-up ended, or null while it has not. */
type Stored = { warmup: 'finished' | 'skipped' | null; solveHint: boolean };

const NOTHING_YET: Stored = { warmup: null, solveHint: false };

/** A player with no record: everything is still to be shown. */
export const BRAND_NEW: Onboarding = { warmup: true, solveHint: true };

const read = async (userId: string): Promise<Stored> => {
  const json = await redis.hGet(KEYS.onboarding, userId);
  if (json === undefined) return NOTHING_YET;
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) return NOTHING_YET;
  const warmup =
    'warmup' in value && (value.warmup === 'finished' || value.warmup === 'skipped') ? value.warmup : null;
  const solveHint = 'solveHint' in value && value.solveHint === true;
  return { warmup, solveHint };
};

/** What a player has still to be shown. */
export const getOnboarding = async (userId: string): Promise<Onboarding> => {
  const stored = await read(userId);
  return { warmup: stored.warmup === null, solveHint: !stored.solveHint };
};

/**
 * Records one thing a player has now done or seen. Replaying the warm-up and
 * ending it a second time just records how it ended last.
 */
export const recordOnboarding = async (userId: string, event: OnboardingEvent): Promise<void> => {
  const stored = await read(userId);
  const next: Stored =
    event === 'solve-hint-seen'
      ? { ...stored, solveHint: true }
      : { ...stored, warmup: event === 'warmup-finished' ? 'finished' : 'skipped' };
  await redis.hSet(KEYS.onboarding, { [userId]: JSON.stringify(next) });
};
