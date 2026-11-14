import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createNextPost } from '../core/posts';

export const triggers = new Hono();

// Installing the app creates the first post, which is puzzle 1 on a fresh install.
triggers.post('/on-app-install', async (c) => {
  try {
    const { postId, number } = await createNextPost();
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Puzzle ${number} posted in r/${context.subredditName} as ${postId} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create post' }, 400);
  }
});
