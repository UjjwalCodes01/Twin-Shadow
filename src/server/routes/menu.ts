import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createNextPost } from '../core/posts';

export const menu = new Hono();

// "Create a new post" in the subreddit menu, moderators only: posts the next
// puzzle straight away.
menu.post('/post-create', async (c) => {
  try {
    const { postId } = await createNextPost();
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
