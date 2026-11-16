// Who counts as a moderator of the subreddit the app is installed in.

import { context, reddit } from '@devvit/web/server';

/**
 * Whether the caller moderates this subreddit. Reddit only shows moderator
 * controls to moderators, but nothing found in the Devvit packages says a
 * client cannot call a route directly, so every moderator-only route checks
 * for itself.
 */
export const callerIsModerator = async (): Promise<boolean> => {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) return false;
  const found = await reddit.getModerators({ subredditName: context.subredditName, username }).all();
  return found.length > 0;
};
