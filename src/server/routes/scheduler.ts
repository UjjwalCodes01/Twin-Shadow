import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import { runDailyPost } from '../core/posts';

export const scheduler = new Hono();

// Called every hour by the `daily-post` task in devvit.json. runDailyPost
// decides whether there is anything to do, so extra calls are harmless.
scheduler.post('/daily-post', async (c) => {
  const outcome = await runDailyPost(new Date());
  if (outcome === 'created') console.log('Daily post created');
  return c.json<TaskResponse>({});
});
