import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/posts';

export const triggers = new Hono();

// Installing the app creates the first post straight away, whatever the hour.
// It counts as that date's daily post, so the scheduled job skips the rest of
// the day, and calling this route again on the same date does nothing.
triggers.post('/on-app-install', async (c) => {
  try {
    const outcome = await createDailyPost(new Date());
    return c.json<TriggerResponse>(
      { status: 'success', message: `Install post in r/${context.subredditName}: ${outcome}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create post' }, 400);
  }
});
