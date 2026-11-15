import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tier } from '../../shared/puzzle';
import { KEYS } from './keys';
import { puzzlesOfTier } from './queue';

const devvit = await vi.hoisted(async () => {
  const { createFakeDevvit } = await import('../testing/fakeDevvit');
  return createFakeDevvit();
});
vi.mock('@devvit/web/server', () => devvit);

const { DAILY_POST_UTC_HOUR, STALE_CLAIM_MS, createNextPost, loadPost, newestDaily, runDailyPost } =
  await import('./posts');
const { menu } = await import('../routes/menu');
const { triggers } = await import('../routes/triggers');
const { scheduler } = await import('../routes/scheduler');

const at = (iso: string): Date => new Date(iso);
const postJson = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// 2026-11-30 is a Monday.
const WEEK: readonly { date: string; day: string; tier: Tier }[] = [
  { date: '2026-11-30', day: 'Monday', tier: 1 },
  { date: '2026-12-01', day: 'Tuesday', tier: 1 },
  { date: '2026-12-02', day: 'Wednesday', tier: 2 },
  { date: '2026-12-03', day: 'Thursday', tier: 2 },
  { date: '2026-12-04', day: 'Friday', tier: 3 },
  { date: '2026-12-05', day: 'Saturday', tier: 3 },
  { date: '2026-12-06', day: 'Sunday', tier: 3 },
];
const noon = (date: string): Date => at(`${date}T12:00:00Z`);

beforeEach(() => devvit.reset());

describe('createNextPost', () => {
  it('numbers posts in order, whatever puzzle each one gets', async () => {
    const numbers = [];
    for (const { date } of WEEK.slice(0, 3)) numbers.push((await createNextPost('manual', noon(date))).number);
    expect(numbers).toEqual([1, 2, 3]);
    expect(devvit.posts.map((post) => post.title)).toEqual([
      'Twin Shadows #1',
      'Twin Shadows #2',
      'Twin Shadows #3',
    ]);
  });

  it('gives different numbers and puzzles to posts created at the same moment', async () => {
    const monday = noon('2026-11-30');
    const created = await Promise.all([
      createNextPost('manual', monday),
      createNextPost('manual', monday),
      createNextPost('manual', monday),
    ]);
    expect(created.map((post) => post.number).sort()).toEqual([1, 2, 3]);
    expect(new Set(created.map((post) => post.puzzle.id)).size).toBe(3);
  });

  it('saves the post`s own copy of the puzzle, and reads it back', async () => {
    const created = await createNextPost('manual', noon('2026-11-30'));
    const saved: unknown = JSON.parse(devvit.stringValue(KEYS.post(created.postId)) ?? 'null');
    expect(saved).toEqual({
      number: 1,
      kind: 'manual',
      daily: null,
      date: '2026-11-30',
      puzzle: puzzlesOfTier(1)[0],
    });
    expect(saved).not.toHaveProperty('puzzle.parIsOptimal');
    expect(await loadPost(created.postId)).toEqual(saved);
    expect(await loadPost('t3_unknown')).toBeNull();
  });
});

describe('the puzzle follows the weekday', () => {
  it('picks the tier for each UTC weekday', async () => {
    for (const { date, day, tier } of WEEK) {
      const created = await createNextPost('manual', noon(date));
      expect(created.puzzle.tier, day).toBe(tier);
    }
  });

  it('uses the UTC weekday, not the local one', async () => {
    // Late on Tuesday in UTC is already Wednesday in most of Asia.
    expect((await createNextPost('manual', at('2026-12-01T23:59:00Z'))).puzzle.tier).toBe(1);
    expect((await createNextPost('manual', at('2026-12-02T00:00:00Z'))).puzzle.tier).toBe(2);
  });

  it('advances each tier`s counter on its own', async () => {
    const pick = async (date: string) => (await createNextPost('manual', noon(date))).puzzle;
    expect(await pick('2026-11-30')).toEqual(puzzlesOfTier(1)[0]); // Monday
    expect(await pick('2026-12-02')).toEqual(puzzlesOfTier(2)[0]); // Wednesday
    expect(await pick('2026-12-01')).toEqual(puzzlesOfTier(1)[1]); // Tuesday
    expect(await pick('2026-12-04')).toEqual(puzzlesOfTier(3)[0]); // Friday
    expect(await pick('2026-12-03')).toEqual(puzzlesOfTier(2)[1]); // Thursday
    expect(await pick('2026-12-07')).toEqual(puzzlesOfTier(1)[2]); // the next Monday
    expect(devvit.stringValue(KEYS.tierCounter(1))).toBe('3');
    expect(devvit.stringValue(KEYS.tierCounter(2))).toBe('2');
    expect(devvit.stringValue(KEYS.tierCounter(3))).toBe('1');
  });

  it('wraps to the tier`s first puzzle when the tier runs out, and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = puzzlesOfTier(1);
      await devvit.redis.set(KEYS.tierCounter(1), String(pool.length - 1));
      const monday = noon('2026-11-30');
      expect((await createNextPost('manual', monday)).puzzle).toEqual(pool.at(-1));
      expect(warn).not.toHaveBeenCalled();
      expect((await createNextPost('manual', monday)).puzzle).toEqual(pool[0]);
      expect(warn).toHaveBeenCalledOnce();
      expect((await createNextPost('manual', monday)).puzzle).toEqual(pool[1]);
      // The other tiers are untouched, and post numbers keep counting up.
      expect((await createNextPost('manual', noon('2026-12-02'))).puzzle).toEqual(puzzlesOfTier(2)[0]);
      expect(devvit.posts.map((post) => post.title).at(-1)).toBe('Twin Shadows #4');
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

  it('creates the next daily post on the next date, with the weekday`s tier', async () => {
    await runDailyPost(at('2026-12-01T05:00:00Z')); // Tuesday
    expect(await runDailyPost(at('2026-12-02T05:00:00Z'))).toBe('created'); // Wednesday
    expect(devvit.posts.map((post) => post.title)).toEqual(['Twin Shadows #1', 'Twin Shadows #2']);
    expect(devvit.hashContents(KEYS.postDates)).toEqual({
      '2026-12-01': 't3_post1',
      '2026-12-02': 't3_post2',
    });
    const [first, second] = [await loadPost('t3_post1'), await loadPost('t3_post2')];
    expect(first).toMatchObject({ kind: 'daily', daily: 1, date: '2026-12-01', puzzle: { tier: 1 } });
    expect(second).toMatchObject({ kind: 'daily', daily: 2, date: '2026-12-02', puzzle: { tier: 2 } });
    expect(await newestDaily()).toBe(2);
  });

  it('does nothing before the posting hour', async () => {
    const early = `2026-12-01T0${DAILY_POST_UTC_HOUR - 1}:59:59Z`;
    expect(await runDailyPost(at(early))).toBe('too-early');
    expect(devvit.posts).toHaveLength(0);
  });

  it('still posts on a day that already has a post made from the menu', async () => {
    await createNextPost('manual', at('2026-12-01T02:00:00Z'));
    expect(await runDailyPost(at('2026-12-01T05:00:00Z'))).toBe('created');
    await createNextPost('manual', at('2026-12-01T09:00:00Z'));
    expect(await runDailyPost(at('2026-12-01T10:00:00Z'))).toBe('already-created');
    expect(devvit.posts).toHaveLength(3);
    // Only the job's post is the day's daily post.
    expect(devvit.hashContents(KEYS.postDates)).toEqual({ '2026-12-01': 't3_post2' });
    expect((await loadPost('t3_post1'))?.daily).toBeNull();
    expect((await loadPost('t3_post2'))?.daily).toBe(1);
    expect((await loadPost('t3_post3'))?.daily).toBeNull();
    expect(await newestDaily()).toBe(1);
  });

  it('lets a later run retry after a failed one', async () => {
    devvit.failNextPost();
    await expect(runDailyPost(at('2026-12-01T05:00:00Z'))).rejects.toThrow('Reddit is down');
    expect(devvit.hashContents(KEYS.postDates)).toEqual({});
    expect(await runDailyPost(at('2026-12-01T06:00:00Z'))).toBe('created');
    expect(devvit.posts).toHaveLength(1);
    // The failed attempt used up a post number, but no puzzle and no daily place.
    expect(devvit.posts[0]?.title).toBe('Twin Shadows #2');
    expect(await loadPost('t3_post1')).toMatchObject({ daily: 1, puzzle: puzzlesOfTier(1)[0] });
  });
});

describe('a claim left pending by a run that died', () => {
  const date = '2026-12-01';
  const claimedAt = at(`${date}T05:00:00Z`).getTime();
  const leaveClaim = () => devvit.redis.hSetNX(KEYS.postDates, date, `pending:${claimedAt}`);

  it('is left alone while it is fresh', async () => {
    await leaveClaim();
    expect(await runDailyPost(new Date(claimedAt + 30_000))).toBe('already-created');
    expect(await runDailyPost(new Date(claimedAt + STALE_CLAIM_MS))).toBe('already-created');
    expect(devvit.posts).toHaveLength(0);
  });

  it('is taken over once it is more than ten minutes old', async () => {
    await leaveClaim();
    expect(await runDailyPost(new Date(claimedAt + STALE_CLAIM_MS + 1))).toBe('created');
    expect(devvit.posts).toHaveLength(1);
    expect(devvit.hashContents(KEYS.postDates)).toEqual({ [date]: 't3_post1' });
    expect(await runDailyPost(at(`${date}T07:00:00Z`))).toBe('already-created');
    expect(devvit.posts).toHaveLength(1);
  });

  it('is taken over by only one of two runs that arrive together', async () => {
    await leaveClaim();
    const later = at(`${date}T06:00:00Z`);
    const outcomes = await Promise.all([runDailyPost(later), runDailyPost(later), runDailyPost(later)]);
    expect(outcomes.sort()).toEqual(['already-created', 'already-created', 'created']);
    expect(devvit.posts).toHaveLength(1);
  });

  it('can be taken over again if the run that took it over also dies', async () => {
    await leaveClaim();
    devvit.failNextPost();
    // This run takes over, fails cleanly and releases the date.
    await expect(runDailyPost(at(`${date}T06:00:00Z`))).rejects.toThrow('Reddit is down');
    expect(await runDailyPost(at(`${date}T07:00:00Z`))).toBe('created');

    // A second date: the takeover itself is left pending, then taken over in turn.
    const next = '2026-12-02';
    const first = at(`${next}T05:00:00Z`).getTime();
    await devvit.redis.hSetNX(KEYS.postDates, next, `pending:${first}`);
    await devvit.redis.hSetNX(KEYS.takeovers, `${next}|pending:${first}`, String(first + 3_600_000));
    await devvit.redis.hSet(KEYS.postDates, { [next]: `pending:${first + 3_600_000}` });
    expect(await runDailyPost(new Date(first + 3_600_000 + 60_000))).toBe('already-created');
    expect(await runDailyPost(new Date(first + 2 * 3_600_000))).toBe('created');
    expect(devvit.posts).toHaveLength(2);
  });

  it('counts as stale when it carries no time, as claims from older versions did', async () => {
    await devvit.redis.hSetNX(KEYS.postDates, date, 'pending');
    expect(await runDailyPost(at(`${date}T06:00:00Z`))).toBe('created');
  });
});

describe('the install trigger', () => {
  const install = () => triggers.request('/on-app-install', postJson({ type: 'AppInstall' }));

  it('creates the first daily post at any hour, and the job skips the rest of that day', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(at('2026-12-01T02:00:00Z'));
      expect((await install()).status).toBe(200);
      expect(devvit.posts.map((post) => post.title)).toEqual(['Twin Shadows #1']);
      expect(await loadPost('t3_post1')).toMatchObject({ kind: 'daily', daily: 1 });
      expect(await runDailyPost(at('2026-12-01T05:00:00Z'))).toBe('already-created');
      expect(await runDailyPost(at('2026-12-02T05:00:00Z'))).toBe('created');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when called again on the same date', async () => {
    await install();
    await install();
    expect(devvit.posts).toHaveLength(1);
  });
});

describe('the moderator menu item', () => {
  const create = () => menu.request('/post-create', postJson({}));
  const actAs = (userId: string | undefined) => {
    devvit.context.userId = userId;
    devvit.context.username = userId?.replace(/^t2_/, '');
  };

  it('creates an extra post for a moderator and sends them to it', async () => {
    devvit.addModerator('mod');
    actAs('t2_mod');
    const response = await create();
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ navigateTo: 'https://reddit.com/r/some_game/comments/t3_post1' });
    expect(await loadPost('t3_post1')).toMatchObject({ kind: 'manual', daily: null });
  });

  it('refuses a caller who is not a moderator, and a logged-out caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      devvit.addModerator('mod');
      for (const caller of ['t2_player', undefined]) {
        actAs(caller);
        const response = await create();
        expect(response.status).toBe(403);
        const body: unknown = await response.json();
        expect(body).toEqual({ showToast: 'Only moderators can create posts' });
      }
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
    expect(devvit.posts).toHaveLength(0);
    expect(devvit.stringValue(KEYS.postCounter)).toBeUndefined();
  });
});

describe('the three ways a post is made', () => {
  it('share one post counter, and only the install and the job make daily posts', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(at('2026-12-01T12:00:00Z'));
      await triggers.request('/on-app-install', postJson({ type: 'AppInstall' }));

      devvit.addModerator('mod');
      devvit.context.userId = 't2_mod';
      devvit.context.username = 'mod';
      await menu.request('/post-create', postJson({}));

      vi.setSystemTime(at('2026-12-02T12:00:00Z'));
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
    const kinds = [];
    for (const post of devvit.posts) kinds.push((await loadPost(post.id))?.daily);
    expect(kinds).toEqual([1, null, 2]);
  });
});
