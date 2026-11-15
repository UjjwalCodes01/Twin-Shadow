// Streak flair: user flair in this subreddit for a player's best streak.

import { reddit } from '@devvit/web/server';

/**
 * Best-streak lengths, in days, that earn flair. Flair follows the best
 * streak, not the current one, so it never has to be taken away.
 */
export const STREAK_FLAIR_DAYS: readonly number[] = [3, 7, 30];

/** The highest milestone a best streak has reached, or 0 for none. */
export const flairMilestone = (best: number): number =>
  STREAK_FLAIR_DAYS.reduce((reached, days) => (best >= days ? Math.max(reached, days) : reached), 0);

export const streakFlairText = (days: number): string => `${days}-day streak`;

/**
 * Gives a player the flair for a milestone. Returns whether it was set. It
 * never throws: flair is a bonus, and a failure here must not turn a good
 * submission into an error. Nothing is set when the subreddit has user flair
 * turned off.
 */
export const setStreakFlair = async (username: string, days: number): Promise<boolean> => {
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    if (!subreddit.userFlairsEnabled) {
      console.warn(`User flair is off in r/${subreddit.name}: no ${streakFlairText(days)} flair for ${username}`);
      return false;
    }
    await reddit.setUserFlair({ subredditName: subreddit.name, username, text: streakFlairText(days) });
    return true;
  } catch (error) {
    console.error(`Could not set streak flair for ${username}: ${error}`);
    return false;
  }
};
