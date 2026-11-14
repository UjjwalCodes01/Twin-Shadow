import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from './keys';
import { QUEUE } from './queue';

const devvit = await vi.hoisted(async () => {
  const { createFakeDevvit } = await import('../testing/fakeDevvit');
  return createFakeDevvit();
});
vi.mock('@devvit/web/server', () => devvit);

const { DAILY_POST_UTC_HOUR, createNextPost, puzzleNumberForPost, runDailyPost } = await import('./posts');
const { menu } = await import('../routes/menu');
const { triggers } = await import('../routes/triggers');
const { scheduler } = await import('../routes/scheduler');

const at = (iso: string): Date => new Date(iso);
const postJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => devvit.reset());

describe('createNextPost', () => {
  it('assigns consecutive puzzle numbers and titles', async () => {
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await createNextPost()).number);
    expect(numbers).toEqual([1, 2, 3]);
    expect(devvit.posts.map((post) => post.title)).toEqual([
      'Twin Shadows #1',
      'Twin Shadows #2',
      'Twin Shadows #3',
    ]);
  });

  it('ties each post to its number in the post data and in Redis', async () => {
    await createNextPost();
    const { postId, number } = await createNextPost();
    const post = devvit.posts.at(-1);
    expect(post?.postData).toEqual({ puzzleNumber: 2 });
    expect(devvit.stringValue(KEYS.postPuzzle(postId))).toBe('2');
    expect(await puzzleNumberForPost(postId, post?.postData)).toBe(number);
    // Without post data, Redis still knows.
    expect(await puzzleNumberForPost(postId, undefined)).toBe(2);
    expect(await puzzleNumberForPost('t3_unknown', undefined)).toBeUndefined();
  });

  it('gives different numbers to posts created at the same moment', async () => {
    const created = await Promise.all([createNextPost(), createNextPost(), createNextPost()]);
    expect(created.map((post) => post.number).sort()).toEqual([1, 2, 3]);
  });

  it('wraps to puzzle 1 after the last puzzle and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await devvit.redis.set(KEYS.postCounter, String(QUEUE.length - 1));
      expect((await createNextPost()).number).toBe(QUEUE.length);
      expect(warn).not.toHaveBeenCalled();
      expect((await createNextPost()).number).toBe(1);
      expect(warn).toHaveBeenCalledOnce();
      expect((await createNextPost()).number).toBe(2);
      expect(devvit.posts.at(-2)?.title).toBe('Twin Shadows #1');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('runDailyPost', () => {
  it('creates one post when run twice on the same UTC date', async () => {
    expect(await runDailyPost(at('2026-12-01T05:00:00Z'))).toBe('created');
    expect(await runDailyPost(at('2026-12-01T05:00:30Z'))).toBe('already-created');
    expect(await runDailyPost(at('2026-12-01T23:00:00Z'))).toBe('already-created');
    expect(devvit.posts).toHaveLength(1);
  });

  it('creates one post when two runs overlap', async () => {
    const outcomes = await Promise.all([
      runDailyPost(at('2026-12-01T05:00:00Z')),
      runDailyPost(at('2026-12-01T05:00:00Z')),
    ]);
    expect(outcomes.sort()).toEqual(['already-created', 'created']);
    expect(devvit.posts).toHaveLength(1);
  });

  it('creates the next puzzle on the next date', async () => {
    await runDailyPost(at('2026-12-01T05:00:00Z'));
    expect(await runDailyPost(at('2026-12-02T05:00:00Z'))).toBe('created');
    expect(devvit.posts.map((post) => post.title)).toEqual(['Twin Shadows #1', 'Twin Shadows #2']);
    expect(devvit.hashContents(KEYS.postDates)).toEqual({
      '2026-12-01': 't3_post1',
      '2026-12-02': 't3_post2',
    });
  });

  it('does nothing before the posting hour', async () => {
    const early = `2026-12-01T0${DAILY_POST_UTC_HOUR - 1}:59:59Z`;
    expect(await runDailyPost(at(early))).toBe('too-early');
    expect(devvit.posts).toHaveLength(0);
  });

  it('skips the day when a post was already created by hand', async () => {
    await createNextPost(at('2026-12-01T02:00:00Z'));
    expect(await runDailyPost(at('2026-12-01T05:00:00Z'))).toBe('already-created');
    expect(devvit.posts).toHaveLength(1);
  });

  it('lets a later run retry after a failed one', async () => {
    devvit.failNextPost();
    await expect(runDailyPost(at('2026-12-01T05:00:00Z'))).rejects.toThrow('Reddit is down');
    expect(await runDailyPost(at('2026-12-01T06:00:00Z'))).toBe('created');
    expect(devvit.posts).toHaveLength(1);
  });
});

describe('the three ways a post is made', () => {
  it('all go through the same counter', async () => {
    devvit.context.subredditName = 'some_game';
    const installed = await triggers.request('/on-app-install', postJson({ type: 'AppInstall' }));
    expect(installed.status).toBe(200);

    const fromMenu = await menu.request('/post-create', postJson({}));
    expect(fromMenu.status).toBe(200);
    const menuBody: unknown = await fromMenu.json();
    expect(menuBody).toEqual({ navigateTo: 'https://reddit.com/r/some_game/comments/t3_post2' });

    // The scheduled task: a hand-made post already exists today, so move on a day.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000);
      vi.setSystemTime(new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z'));
      const scheduled = await scheduler.request('/daily-post', postJson({ name: 'daily-post' }));
      expect(scheduled.status).toBe(200);
      await scheduler.request('/daily-post', postJson({ name: 'daily-post' }));
    } finally {
      vi.useRealTimers();
    }

    expect(devvit.posts.map((post) => post.title)).toEqual([
      'Twin Shadows #1',
      'Twin Shadows #2',
      'Twin Shadows #3',
    ]);
  });
});
