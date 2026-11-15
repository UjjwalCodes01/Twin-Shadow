import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseResultResponse, parseSubmitResponse, type Result } from '../../shared/api';
import { TEST_PUZZLE, TEST_SOLUTION, type Puzzle } from '../../shared/puzzle';
import { canonicalSculpture } from '../../shared/score';
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

type Opened = { post: FakePost; puzzle: Puzzle };

// 2026-11-30 is a Monday.
const MONDAY = new Date('2026-11-30T12:00:00Z');
const DAYS = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'] as const;

const opened = async (): Promise<Opened> => {
  const post = devvit.posts.at(-1);
  const record = post ? await loadPost(post.id) : null;
  if (!post || !record) throw new Error('No post was created');
  return { post, puzzle: record.puzzle };
};

const manualPost = async (now: Date = MONDAY): Promise<Opened> => {
  await createNextPost('manual', now);
  return opened();
};

/** The daily post for one of DAYS, made at the posting hour. */
const dailyPost = async (day: number): Promise<Opened> => {
  const date = DAYS[day];
  if (date === undefined) throw new Error(`No day ${day}`);
  expect(await createDailyPost(new Date(`${date}T05:00:00Z`))).toBe('created');
  return opened();
};

// Each submission happens one second after the last, so "earlier" is unambiguous.
let clock = MONDAY.getTime();

const submitAs = async ({ post }: Opened, name: string, blocks: readonly string[]): Promise<string> => {
  devvit.enterPost(post, `t2_${name}`);
  clock += 1000;
  vi.setSystemTime(clock);
  const response = await api.request('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  const raw: unknown = await response.json();
  const body = parseSubmitResponse(raw);
  if (!body) throw new Error(`Unreadable submit response: ${JSON.stringify(raw)}`);
  return body.status;
};

/** Submits the generator's par solution for the post's puzzle. */
const solveAs = (target: Opened, name: string): Promise<string> =>
  submitAs(target, name, parSolution(target.puzzle.number));

const fetchResult = async ({ post }: Opened, name: string | undefined) => {
  devvit.enterPost(post, name === undefined ? undefined : `t2_${name}`);
  const response = await api.request('/result');
  const body: unknown = await response.json();
  return { status: response.status, body, parsed: parseResultResponse(body) };
};

const resultFor = async (target: Opened, name: string): Promise<Result> => {
  const { parsed, body } = await fetchResult(target, name);
  if (parsed?.status !== 'ok') throw new Error(`No result for ${name}: ${JSON.stringify(body)}`);
  return parsed.result;
};

beforeEach(() => {
  devvit.reset();
  clock = MONDAY.getTime();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/result', () => {
  it('refuses a player who has not submitted, with nothing to peek at', async () => {
    const target = await manualPost();
    await solveAs(target, 'alice');

    for (const visitor of ['bob', undefined]) {
      const { status, body, parsed } = await fetchResult(target, visitor);
      expect(status).toBe(403);
      expect(parsed?.status).toBe('not-submitted');
      expect(Object.keys(Object(body)).sort()).toEqual(['message', 'status']);
    }
  });

  it('answers 404 outside a post that has a puzzle', async () => {
    devvit.context.postId = 't3_stranger';
    devvit.context.userId = 't2_alice';
    expect((await api.request('/result')).status).toBe(404);
  });

  it('returns the player`s own blocks, par and stars', async () => {
    const target = await manualPost();
    const { par } = target.puzzle;
    await submitAs(target, 'alice', solutionWith(target.puzzle, par + 1));
    expect(await resultFor(target, 'alice')).toMatchObject({
      blocks: par + 1,
      par,
      stars: 2,
      rank: 1,
      tied: 1,
      solvers: 1,
      record: { blocks: par + 1, underPar: false },
    });
  });

  it('never sends another player`s sculpture', async () => {
    const target = await manualPost();
    const { par } = target.puzzle;
    const secret = solutionWith(target.puzzle, par + 2);
    await submitAs(target, 'alice', secret);
    await solveAs(target, 'bob');
    const { body } = await fetchResult(target, 'bob');
    const text = JSON.stringify(body);
    expect(text).toContain('alice');
    expect(text).not.toContain('sculpture');
    expect(text).not.toContain(canonicalSculpture(secret));
    expect(text).not.toContain('t2_alice');
  });
});

describe('ranking', () => {
  it('puts fewer blocks first, shares a rank between equal counts, and lists earlier submissions first', async () => {
    const target = await manualPost();
    const { puzzle } = target;
    const { par } = puzzle;
    await submitAs(target, 'bea', solutionWith(puzzle, par + 2));
    await submitAs(target, 'ann', solutionWith(puzzle, par));
    await submitAs(target, 'dee', solutionWith(puzzle, par + 1));
    await submitAs(target, 'cat', solutionWith(puzzle, par));

    const ann = await resultFor(target, 'ann');
    expect(ann).toMatchObject({ rank: 1, tied: 2, solvers: 4, own: null });
    expect(ann.leaderboard).toEqual([
      { rank: 1, username: 'ann', blocks: par, you: true },
      { rank: 1, username: 'cat', blocks: par, you: false },
      { rank: 3, username: 'dee', blocks: par + 1, you: false },
      { rank: 4, username: 'bea', blocks: par + 2, you: false },
    ]);

    expect(await resultFor(target, 'cat')).toMatchObject({ rank: 1, tied: 2 });
    expect(await resultFor(target, 'dee')).toMatchObject({ rank: 3, tied: 1 });
    const bea = await resultFor(target, 'bea');
    expect(bea).toMatchObject({ rank: 4, tied: 1, solvers: 4, own: null });
    expect(bea.leaderboard.map((row) => row.you)).toEqual([false, false, false, true]);
  });

  it('gives a player outside the first ten rows their own row and the right rank', async () => {
    const target = await manualPost();
    const { puzzle } = target;
    const { par } = puzzle;
    const names = Array.from({ length: 11 }, (_, index) => `p${String(index + 1).padStart(2, '0')}`);
    for (const name of names) await solveAs(target, name);
    await submitAs(target, 'late', solutionWith(puzzle, par + 2));

    const late = await resultFor(target, 'late');
    expect(late).toMatchObject({ rank: 12, tied: 1, solvers: 12 });
    expect(late.leaderboard).toHaveLength(10);
    expect(late.leaderboard.map((row) => row.username)).toEqual(names.slice(0, 10));
    expect(late.leaderboard.some((row) => row.you)).toBe(false);
    expect(late.own).toEqual({ rank: 12, username: 'late', blocks: par + 2, you: true });

    // The eleventh of the tied players is also off the list, on the shared rank.
    const eleventh = await resultFor(target, 'p11');
    expect(eleventh).toMatchObject({ rank: 1, tied: 11, solvers: 12 });
    expect(eleventh.own).toEqual({ rank: 1, username: 'p11', blocks: par, you: true });

    // A player on the list has no separate row.
    expect((await resultFor(target, 'p03')).own).toBeNull();
  });

  it('reports the community record, and whether it is under par', async () => {
    const target = await manualPost();
    const { puzzle } = target;
    await submitAs(target, 'ann', solutionWith(puzzle, puzzle.par + 2));
    expect((await resultFor(target, 'ann')).record).toEqual({ blocks: puzzle.par + 2, underPar: false });
    await solveAs(target, 'bea');
    expect((await resultFor(target, 'ann')).record).toEqual({ blocks: puzzle.par, underPar: false });

    // A post whose par can be beaten: the test puzzle, saved with a par of 8.
    const generous = await manualPost();
    const saved = { number: 2, kind: 'manual', daily: null, date: '2026-11-30', puzzle: { ...TEST_PUZZLE, par: 8 } };
    await devvit.redis.set(KEYS.post(generous.post.id), JSON.stringify(saved));
    await submitAs(generous, 'ann', TEST_SOLUTION);
    expect(await resultFor(generous, 'ann')).toMatchObject({
      blocks: 6,
      par: 8,
      stars: 3,
      record: { blocks: 6, underPar: true },
    });
  });
});

describe('rarity', () => {
  it('counts identical sculptures together and different ones apart', async () => {
    const target = await manualPost();
    const { puzzle } = target;
    const common = parSolution(puzzle.number);
    await submitAs(target, 'ann', common);
    // The same sculpture, with its blocks sent in another order.
    await submitAs(target, 'bea', [...common].reverse());
    await submitAs(target, 'cat', solutionWith(puzzle, puzzle.par + 1));
    await submitAs(target, 'dee', solutionWith(puzzle, puzzle.par + 2));

    // Four solvers: too few for a percentage.
    expect((await resultFor(target, 'ann')).rarity).toEqual({ same: 2, share: 0.5, smallSample: true });
    expect((await resultFor(target, 'cat')).rarity).toEqual({ same: 1, share: 0.25, smallSample: true });

    await submitAs(target, 'eve', common);
    expect((await resultFor(target, 'ann')).rarity).toEqual({ same: 3, share: 0.6, smallSample: false });
    expect((await resultFor(target, 'bea')).rarity).toEqual({ same: 3, share: 0.6, smallSample: false });
    expect((await resultFor(target, 'cat')).rarity).toEqual({ same: 1, share: 0.2, smallSample: false });
    expect((await resultFor(target, 'dee')).rarity).toEqual({ same: 1, share: 0.2, smallSample: false });

    const counts = Object.values(devvit.hashContents(KEYS.sculptures(target.post.id))).map(Number);
    expect(counts.sort()).toEqual([1, 1, 3]);
  });
});

describe('streaks', () => {
  it('starts at one on a first solve', async () => {
    const day1 = await dailyPost(0);
    await solveAs(day1, 'ann');
    expect((await resultFor(day1, 'ann')).streak).toEqual({ current: 1, best: 1 });
  });

  it('grows with each consecutive daily post solved while it was the newest', async () => {
    const day1 = await dailyPost(0);
    await solveAs(day1, 'ann');
    const day2 = await dailyPost(1);
    await solveAs(day2, 'ann');
    const day3 = await dailyPost(2);
    await solveAs(day3, 'ann');
    expect((await resultFor(day3, 'ann')).streak).toEqual({ current: 3, best: 3 });
  });

  it('goes back to one after a missed day, keeping the best', async () => {
    const day1 = await dailyPost(0);
    await solveAs(day1, 'ann');
    const day2 = await dailyPost(1);
    await solveAs(day2, 'ann');
    await dailyPost(2); // missed
    const day4 = await dailyPost(3);
    await solveAs(day4, 'ann');
    expect((await resultFor(day4, 'ann')).streak).toEqual({ current: 1, best: 2 });
  });

  it('is unchanged by solving an older post', async () => {
    const day1 = await dailyPost(0);
    const day2 = await dailyPost(1);
    // Day 1 is no longer the newest, so solving it now counts for nothing.
    await solveAs(day1, 'ann');
    expect((await resultFor(day1, 'ann')).streak).toEqual({ current: 0, best: 0 });
    await solveAs(day2, 'ann');
    expect((await resultFor(day2, 'ann')).streak).toEqual({ current: 1, best: 1 });

    // Going back to an older post later does not disturb a streak either.
    const day3 = await dailyPost(2);
    await solveAs(day3, 'bea');
    await solveAs(day3, 'ann');
    await solveAs(day1, 'bea');
    expect((await resultFor(day3, 'ann')).streak).toEqual({ current: 2, best: 2 });
    expect((await resultFor(day3, 'bea')).streak).toEqual({ current: 1, best: 1 });
  });

  it('counts the same post once', async () => {
    const day1 = await dailyPost(0);
    expect(await solveAs(day1, 'ann')).toBe('accepted');
    expect(await solveAs(day1, 'ann')).toBe('already-submitted');
    expect(await solveAs(day1, 'ann')).toBe('already-submitted');
    expect((await resultFor(day1, 'ann')).streak).toEqual({ current: 1, best: 1 });
  });

  it('ignores extra posts made from the menu', async () => {
    const day1 = await dailyPost(0);
    await solveAs(day1, 'ann');
    // Two extra posts on the same day: solving one, or skipping one, changes nothing.
    const extra = await manualPost(new Date(`${DAYS[0]}T09:00:00Z`));
    await manualPost(new Date(`${DAYS[0]}T10:00:00Z`));
    await solveAs(extra, 'ann');
    expect((await resultFor(extra, 'ann')).streak).toEqual({ current: 1, best: 1 });

    const day2 = await dailyPost(1);
    await solveAs(day2, 'ann');
    expect((await resultFor(day2, 'ann')).streak).toEqual({ current: 2, best: 2 });

    // A player who only ever solved an extra post has no streak.
    await solveAs(extra, 'bea');
    expect((await resultFor(extra, 'bea')).streak).toEqual({ current: 0, best: 0 });
  });

  it('shows zero once the most recent finished post was missed', async () => {
    const day1 = await dailyPost(0);
    await solveAs(day1, 'ann');
    // Day 2 is out but still open: the streak from day 1 stands.
    await dailyPost(1);
    expect((await resultFor(day1, 'ann')).streak).toEqual({ current: 1, best: 1 });
    // Day 3 is out, so day 2 is finished and was missed.
    await dailyPost(2);
    expect((await resultFor(day1, 'ann')).streak).toEqual({ current: 0, best: 1 });
  });
});

describe('two simultaneous submissions from one player', () => {
  it('update the leaderboard, the counts and the streak once', async () => {
    const day1 = await dailyPost(0);
    const blocks = parSolution(day1.puzzle.number);
    devvit.enterPost(day1.post, 't2_ann');
    const send = () =>
      api.request('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });
    const responses = await Promise.all([send(), send(), send()]);
    const statuses = [];
    for (const response of responses) {
      const raw: unknown = await response.json();
      statuses.push(parseSubmitResponse(raw)?.status);
    }
    expect(statuses.sort()).toEqual(['accepted', 'already-submitted', 'already-submitted']);

    const postId = day1.post.id;
    expect(devvit.sortedSetMembers(KEYS.leaderboard(postId))).toEqual(['t2_ann']);
    expect(devvit.hashContents(KEYS.blockCounts(postId))).toEqual({ [String(blocks.length)]: '1' });
    expect(Object.values(devvit.hashContents(KEYS.sculptures(postId)))).toEqual(['1']);
    expect(JSON.parse(devvit.hashContents(KEYS.streaks).t2_ann ?? '{}')).toEqual({ current: 1, best: 1, last: 1 });
    expect(await resultFor(day1, 'ann')).toMatchObject({
      rank: 1,
      tied: 1,
      solvers: 1,
      rarity: { same: 1 },
      streak: { current: 1, best: 1 },
    });
  });
});
