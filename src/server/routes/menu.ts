import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { callerIsModerator } from '../core/moderators';
import { createNextPost } from '../core/posts';

export const menu = new Hono();

// "Create a new post" in the subreddit menu, moderators only: makes an extra
// post straight away. It does not replace or count as the day's daily post.
menu.post('/post-create', async (c) => {
  try {
    if (!(await callerIsModerator())) {
      // Logged, so a moderator who is wrongly refused shows up in `devvit logs`.
      console.warn(`Post creation refused: ${context.username ?? 'a logged-out caller'} is not a moderator`);
      return c.json<UiResponse>({ showToast: 'Only moderators can create posts' }, 403);
    }
    const { postId, number, puzzle } = await createNextPost('manual');
    console.log(`Menu post created: Twin Shadows #${number} (${postId}) with puzzle ${puzzle.id}`);
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
