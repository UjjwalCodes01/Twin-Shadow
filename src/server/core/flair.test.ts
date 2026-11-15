import { describe, expect, it } from 'vitest';
import { STREAK_FLAIR_DAYS, flairMilestone, streakFlairText } from './flair';

describe('flairMilestone', () => {
  it('is the highest milestone a best streak has reached', () => {
    expect(STREAK_FLAIR_DAYS).toEqual([3, 7, 30]);
    expect([0, 1, 2].map(flairMilestone)).toEqual([0, 0, 0]);
    expect([3, 4, 6].map(flairMilestone)).toEqual([3, 3, 3]);
    expect([7, 8, 29].map(flairMilestone)).toEqual([7, 7, 7]);
    expect([30, 31, 365].map(flairMilestone)).toEqual([30, 30, 30]);
  });

  it('names the flair by its length in days', () => {
    expect(STREAK_FLAIR_DAYS.map(streakFlairText)).toEqual(['3-day streak', '7-day streak', '30-day streak']);
  });
});
