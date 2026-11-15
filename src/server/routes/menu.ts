import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import { createNextPost } from '../core/posts';

export const menu = new Hono();

/**
 * Reddit only shows the menu item to moderators, but nothing found in the
 * Devvit packages says a client cannot call this route directly. So the route
 * checks for itself that the caller moderates this subreddit.
 */
const callerIsModerator = async (): Promise<boolean> => {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) return false;
  const found = await reddit.getModerators({ subredditName: context.subredditName, username }).all();
  return found.length > 0;
};

// "Create a new post" in the subreddit menu, moderators only: makes an extra
// post straight away. It does not replace or count as the day's daily post.
menu.post('/post-create', async (c) => {
  try {
    if (!(await callerIsModerator())) {
      // Logged, so a moderator who is wrongly refused shows up in `devvit logs`.
      console.warn(`Post creation refused: ${context.username ?? 'a logged-out caller'} is not a moderator`);
      return c.json<UiResponse>({ showToast: 'Only moderators can create posts' }, 403);
    }
    const { postId } = await createNextPost('manual');
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
