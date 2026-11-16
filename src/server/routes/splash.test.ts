import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePuzzleResponse, parseSplashResponse, type SplashResponse } from '../../shared/api';
import { canonicalSculpture } from '../../shared/score';
import type { Puzzle } from '../../shared/puzzle';
import { KEYS } from '../core/keys';
import type { FakePost } from '../testing/fakeDevvit';
import { parSolution, solutionWith } from '../testing/solutions';

const devvit = await vi.hoisted(async () => {
  const { createFakeDevvit } = await import('../testing/fakeDevvit');
  return createFakeDevvit();
});
vi.mock('@devvit/web/server', () => devvit);

const { api } = await import('./api');
const { createDailyPost, createNextPost, loadPost } = await import('../core/posts');

type Opened = { post: FakePost; puzzle: Puzzle; number: number };

// 2026-11-30 is a Monday.
const MONDAY = new Date('2026-11-30T12:00:00Z');

const opened = async (): Promise<Opened> => {
  const post = devvit.posts.at(-1);
  const record = post ? await loadPost(post.id) : null;
  if (!post || !record) throw new Error('No post was created');
  return { post, puzzle: record.puzzle, number: record.number };
};

const manualPost = async (): Promise<Opened> => {
  await createNextPost('manual', MONDAY);
  return opened();
};

const dailyPost = async (date: string): Promise<Opened> => {
  expect(await createDailyPost(new Date(`${date}T05:00:00Z`))).toBe('created');
  return opened();
};

const as = (target: Opened, name: string | undefined): void =>
  devvit.enterPost(target.post, name === undefined ? undefined : `t2_${name}`);

const submitAs = async (target: Opened, name: string, blocks: readonly string[]): Promise<void> => {
  as(target, name);
  const response = await api.request('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  expect(response.status).toBe(200);
};

const solveAs = (target: Opened, name: string): Promise<void> =>
  submitAs(target, name, parSolution(target.puzzle.number));

const splashFor = async (target: Opened, name: string | undefined) => {
  as(target, name);
  const response = await api.request('/splash');
  const body: unknown = await response.json();
  return { status: response.status, body, text: JSON.stringify(body), parsed: parseSplashResponse(body) };
};

const splash = async (target: Opened, name: string | undefined): Promise<SplashResponse> => {
  const { parsed, text } = await splashFor(target, name);
  if (!parsed) throw new Error(`Unreadable splash: ${text}`);
  return parsed;
};

const onboardingFor = async (target: Opened, name: string | undefined) => {
  as(target, name);
  const body: unknown = await (await api.request('/puzzle')).json();
  const parsed = parsePuzzleResponse(body);
  if (!parsed) throw new Error(`Unreadable puzzle response: ${JSON.stringify(body)}`);
  return parsed.onboarding;
};

const record = async (target: Opened, name: string | undefined, body: unknown) => {
  as(target, name);
  const response = await api.request('/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as unknown };
};

beforeEach(() => {
  devvit.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MONDAY);
});

describe('GET /api/splash', () => {
  it('gives a player who has not played the post, its silhouettes and no result', async () => {
    const target = await manualPost();
    const { status, body } = await splashFor(target, 'ann');
    expect(status).toBe(200);
    expect(body).toEqual({
      number: target.number,
      date: '2026-11-30',
      size: target.puzzle.size,
      front: target.puzzle.front,
      side: target.puzzle.side,
      played: null,
      streak: 0,
      solvers: 0,
      maker: null,
    });
  });

  it('gives a player who has solved it their stars and their blocks against par', async () => {
    const target = await manualPost();
    const { par } = target.puzzle;
    await submitAs(target, 'ann', solutionWith(target.puzzle, par + 1));
    expect((await splash(target, 'ann')).played).toEqual({ blocks: par + 1, par, stars: 2 });
    // Another player still sees it as not played.
    expect((await splash(target, 'bea')).played).toBeNull();
  });

  it('gives a logged-out visitor the same post with no result and no streak', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    const view = await splash(target, undefined);
    expect(view.played).toBeNull();
    expect(view.streak).toBeNull();
    expect(view.solvers).toBe(1);
    expect(view.front).toEqual(target.puzzle.front);
  });

  it('counts how many players have solved the post', async () => {
    const target = await manualPost();
    expect((await splash(target, 'zed')).solvers).toBe(0);
    for (const name of ['ann', 'bea', 'cal']) await solveAs(target, name);
    expect((await splash(target, 'zed')).solvers).toBe(3);
    // Another post has its own count.
    const other = await manualPost();
    expect((await splash(other, 'zed')).solvers).toBe(0);
  });

  it('gives the current streak of daily puzzles', async () => {
    const first = await dailyPost('2026-11-30');
    await solveAs(first, 'ann');
    expect((await splash(first, 'ann')).streak).toBe(1);
    const second = await dailyPost('2026-12-01');
    await solveAs(second, 'ann');
    expect((await splash(second, 'ann')).streak).toBe(2);
    expect((await splash(second, 'bea')).streak).toBe(0);
  });

  it('leaks nothing that helps to solve the puzzle, and nothing of another player', async () => {
    const target = await manualPost();
    const blocks = parSolution(target.puzzle.number);
    await submitAs(target, 'ann', blocks);
    await submitAs(target, 'bea', solutionWith(target.puzzle, target.puzzle.par + 2));

    for (const viewer of ['ann', 'cal', undefined]) {
      const { text, body } = await splashFor(target, viewer);
      // No sculpture, no usernames, no ids, and nothing about the puzzle's solution.
      expect(text).not.toContain(canonicalSculpture(blocks));
      expect(text).not.toContain('bea');
      expect(text).not.toContain('t2_');
      expect(text).not.toContain('parIsOptimal');
      expect(text).not.toContain('sculpture');
      expect(Object.keys(Object(body)).sort()).toEqual(
        ['date', 'front', 'maker', 'number', 'played', 'side', 'size', 'solvers', 'streak'].sort()
      );
    }
    // Par is only sent with the caller's own result, once they have solved it.
    expect((await splashFor(target, 'cal')).text).not.toContain('"par"');
    expect((await splashFor(target, 'ann')).text).toContain('"par"');
  });

  it('answers 404 outside a post that has a puzzle', async () => {
    devvit.enterPost({ id: 't3_other', title: 'Other', postData: undefined }, 't2_ann');
    const response = await api.request('/splash');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'error', message: 'This post has no puzzle.' });
  });
});

describe('onboarding', () => {
  it('tells a brand new player they have the warm-up and the first-solve hint to come', async () => {
    const target = await manualPost();
    expect(await onboardingFor(target, 'ann')).toEqual({ warmup: true, solveHint: true });
  });

  it('counts a logged-out visitor as new, and cannot remember them', async () => {
    const target = await manualPost();
    expect(await onboardingFor(target, undefined)).toEqual({ warmup: true, solveHint: true });
    expect((await record(target, undefined, { event: 'warmup-skipped' })).status).toBe(401);
    expect(devvit.hashContents(KEYS.onboarding)).toEqual({});
  });

  it('never offers the warm-up again once it has been finished', async () => {
    const target = await manualPost();
    expect((await record(target, 'ann', { event: 'warmup-finished' })).body).toEqual({ status: 'ok' });
    expect(await onboardingFor(target, 'ann')).toEqual({ warmup: false, solveHint: true });
    // Nor on a later post.
    const later = await manualPost();
    expect((await onboardingFor(later, 'ann')).warmup).toBe(false);
  });

  it('remembers a skip just the same', async () => {
    const target = await manualPost();
    await record(target, 'ann', { event: 'warmup-skipped' });
    expect((await onboardingFor(target, 'ann')).warmup).toBe(false);
    expect(devvit.hashContents(KEYS.onboarding)).toEqual({
      t2_ann: JSON.stringify({ warmup: 'skipped', solveHint: false }),
    });
  });

  it('keeps the warm-up finished when it is replayed and ended again', async () => {
    const target = await manualPost();
    await record(target, 'ann', { event: 'warmup-skipped' });
    await record(target, 'ann', { event: 'warmup-finished' });
    expect((await onboardingFor(target, 'ann')).warmup).toBe(false);
  });

  it('remembers the first-solve hint separately from the warm-up', async () => {
    const target = await manualPost();
    await record(target, 'ann', { event: 'solve-hint-seen' });
    expect(await onboardingFor(target, 'ann')).toEqual({ warmup: true, solveHint: false });
    await record(target, 'ann', { event: 'warmup-finished' });
    expect(await onboardingFor(target, 'ann')).toEqual({ warmup: false, solveHint: false });
  });

  it('keeps each player`s record apart', async () => {
    const target = await manualPost();
    await record(target, 'ann', { event: 'warmup-finished' });
    expect((await onboardingFor(target, 'bea')).warmup).toBe(true);
  });

  it('refuses an event it does not know', async () => {
    const target = await manualPost();
    for (const body of [{ event: 'warmup' }, { event: 7 }, {}, null]) {
      expect((await record(target, 'ann', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(devvit.hashContents(KEYS.onboarding)).toEqual({});
  });
});
