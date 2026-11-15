import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseGalleryResponse,
  parseResultResponse,
  parseSubmitResponse,
  type Gallery,
  type Result,
} from '../../shared/api';
import { TEST_PUZZLE, TEST_SOLUTION, type Puzzle } from '../../shared/puzzle';
import { canonicalSculpture } from '../../shared/score';
import { KEYS } from '../core/keys';
import { sculptureHash } from '../core/scores';
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

const fetchGallery = async ({ post }: Opened, name: string | undefined, query = '') => {
  devvit.enterPost(post, name === undefined ? undefined : `t2_${name}`);
  const response = await api.request(`/gallery${query}`);
  const body: unknown = await response.json();
  return { status: response.status, body, parsed: parseGalleryResponse(body) };
};

const galleryFor = async (target: Opened, name: string, query = ''): Promise<Gallery> => {
  const { parsed, body } = await fetchGallery(target, name, query);
  if (parsed?.status !== 'ok') throw new Error(`No gallery for ${name}: ${JSON.stringify(body)}`);
  return parsed.gallery;
};

/**
 * Stores a submission the way the server would, then stops before counting
 * it: what is left behind if the server dies between the two.
 */
const storeUncounted = async ({ post, puzzle }: Opened, name: string, blocks: readonly string[]) => {
  clock += 1000;
  const record = {
    userId: `t2_${name}`,
    username: name,
    postId: post.id,
    puzzleId: puzzle.id,
    blocks: blocks.length,
    sculpture: canonicalSculpture(blocks),
    submittedAt: clock,
  };
  await devvit.redis.hSetNX(KEYS.submissions(post.id), record.userId, JSON.stringify(record));
};

const countsOf = (postId: string) => ({
  leaderboard: devvit.sortedSetMembers(KEYS.leaderboard(postId)),
  tally: devvit.hashContents(KEYS.blockCounts(postId)),
  sculptures: Object.values(devvit.hashContents(KEYS.sculptures(postId))).map(Number).sort(),
});

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
    expect(JSON.parse(devvit.hashContents(KEYS.streaks).t2_ann ?? '{}')).toEqual({
      current: 1,
      best: 1,
      last: 1,
      flair: 0,
    });
    expect(await resultFor(day1, 'ann')).toMatchObject({
      rank: 1,
      tied: 1,
      solvers: 1,
      rarity: { same: 1 },
      streak: { current: 1, best: 1 },
    });
  });
});

describe('a submission that was stored but never counted', () => {
  it('is added once when its result is fetched, and not again', async () => {
    const target = await manualPost();
    const { puzzle, post } = target;
    await solveAs(target, 'ann');
    await storeUncounted(target, 'bea', solutionWith(puzzle, puzzle.par + 1));
    expect(countsOf(post.id).leaderboard).toEqual(['t2_ann']);

    const healed = await resultFor(target, 'bea');
    expect(healed).toMatchObject({ rank: 2, tied: 1, solvers: 2, rarity: { same: 1 } });
    expect(healed.leaderboard.map((row) => row.username)).toEqual(['ann', 'bea']);

    const after = countsOf(post.id);
    expect(after).toEqual({
      leaderboard: ['t2_ann', 't2_bea'],
      tally: { [String(puzzle.par)]: '1', [String(puzzle.par + 1)]: '1' },
      sculptures: [1, 1],
    });
    await resultFor(target, 'bea');
    await resultFor(target, 'bea');
    expect(countsOf(post.id)).toEqual(after);
    // The player who was counted normally is untouched throughout.
    expect(await resultFor(target, 'ann')).toMatchObject({ rank: 1, tied: 1, solvers: 2 });
    expect(countsOf(post.id)).toEqual(after);
  });

  it('is added once when several requests find it at the same moment', async () => {
    const target = await manualPost();
    await storeUncounted(target, 'ann', parSolution(target.puzzle.number));
    devvit.enterPost(target.post, 't2_ann');
    const responses = await Promise.all([api.request('/result'), api.request('/result'), api.request('/gallery')]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(countsOf(target.post.id)).toEqual({
      leaderboard: ['t2_ann'],
      tally: { [String(target.puzzle.par)]: '1' },
      sculptures: [1],
    });
  });

  it('is finished when only some of it was counted', async () => {
    const target = await manualPost();
    const { post, puzzle } = target;
    const blocks = parSolution(puzzle.number);
    await storeUncounted(target, 'ann', blocks);
    // The leaderboard step had already happened when the server stopped.
    await devvit.redis.hSetNX(KEYS.counted(post.id), 'board:t2_ann', '1');
    await devvit.redis.zAdd(KEYS.leaderboard(post.id), { member: 't2_ann', score: blocks.length * 1e13 + clock });

    expect(await resultFor(target, 'ann')).toMatchObject({ rank: 1, tied: 1, solvers: 1, rarity: { same: 1 } });
    expect(countsOf(post.id)).toEqual({
      leaderboard: ['t2_ann'],
      tally: { [String(puzzle.par)]: '1' },
      sculptures: [1],
    });
  });

  it('is also repaired when the gallery is opened first', async () => {
    const target = await manualPost();
    await storeUncounted(target, 'ann', parSolution(target.puzzle.number));
    const gallery = await galleryFor(target, 'ann');
    expect(gallery.entries).toHaveLength(1);
    expect(gallery.entries[0]).toMatchObject({ builders: 1, first: 'ann', yours: true });
  });
});

describe('GET /api/gallery', () => {
  it('refuses a player who has not submitted, with nothing to peek at', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    for (const visitor of ['bob', undefined]) {
      const { status, body, parsed } = await fetchGallery(target, visitor);
      expect(status).toBe(403);
      expect(parsed?.status).toBe('not-submitted');
      expect(Object.keys(Object(body)).sort()).toEqual(['message', 'status']);
      expect(JSON.stringify(body)).not.toContain('sculpture');
    }
  });

  it('answers 404 outside a post that has a puzzle', async () => {
    devvit.context.postId = 't3_stranger';
    devvit.context.userId = 't2_ann';
    expect((await api.request('/gallery')).status).toBe(404);
  });

  it('saves each distinct sculpture once, counts its builders and keeps the first builder', async () => {
    const target = await manualPost();
    const { puzzle, post } = target;
    const common = parSolution(puzzle.number);
    const rare = solutionWith(puzzle, puzzle.par + 1);
    await submitAs(target, 'ann', common);
    await submitAs(target, 'bea', rare);
    // The same sculpture as ann's, sent in another order.
    await submitAs(target, 'cat', [...common].reverse());
    await submitAs(target, 'dee', common);

    const gallery = await galleryFor(target, 'bea');
    expect(gallery).toMatchObject({ sort: 'rarest', page: 1, pages: 1, total: 2 });
    expect(gallery.entries).toEqual([
      {
        id: sculptureHash(canonicalSculpture(rare)),
        blocks: puzzle.par + 1,
        builders: 1,
        first: 'bea',
        sculpture: canonicalSculpture(rare).split(';'),
        yours: true,
      },
      {
        id: sculptureHash(canonicalSculpture(common)),
        blocks: puzzle.par,
        builders: 3,
        first: 'ann',
        sculpture: canonicalSculpture(common).split(';'),
        yours: false,
      },
    ]);
    // Two sculptures saved, however many players built them.
    expect(Object.keys(devvit.hashContents(KEYS.gallery(post.id)))).toHaveLength(2);

    // The mark follows the caller.
    expect((await galleryFor(target, 'dee')).entries.map((entry) => entry.yours)).toEqual([false, true]);
  });

  it('sorts rarest first or leanest first', async () => {
    const target = await manualPost();
    const { puzzle } = target;
    const { par } = puzzle;
    // par: 3 builders. par + 1: 1 builder. par + 2: 2 builders. par + 3: 1 builder.
    for (const name of ['a1', 'a2', 'a3']) await submitAs(target, name, solutionWith(puzzle, par));
    await submitAs(target, 'b1', solutionWith(puzzle, par + 1));
    for (const name of ['c1', 'c2']) await submitAs(target, name, solutionWith(puzzle, par + 2));
    await submitAs(target, 'd1', solutionWith(puzzle, par + 3));

    const shape = (gallery: Gallery) => gallery.entries.map((entry) => [entry.builders, entry.blocks]);
    // Fewest builders, then fewest blocks.
    expect(shape(await galleryFor(target, 'a1', '?sort=rarest'))).toEqual([
      [1, par + 1],
      [1, par + 3],
      [2, par + 2],
      [3, par],
    ]);
    // Fewest blocks, then fewest builders.
    expect(shape(await galleryFor(target, 'a1', '?sort=leanest'))).toEqual([
      [3, par],
      [1, par + 1],
      [2, par + 2],
      [1, par + 3],
    ]);
    // Rarest is the default, and an unknown order falls back to it.
    expect((await galleryFor(target, 'a1')).sort).toBe('rarest');
    expect((await galleryFor(target, 'a1', '?sort=prettiest')).sort).toBe('rarest');
  });

  it('among sculptures with the same block count, puts fewer builders first when sorting leanest', async () => {
    const target = await manualPost();
    const { post, puzzle } = target;
    const { par } = puzzle;
    await solveAs(target, 'ann'); // par blocks, 1 builder
    // Three more sculptures of par + 1 blocks, written straight into the
    // counts, built by 4, 1 and 2 players.
    const fakes: [string, number][] = [
      ['fakeaaaaaaaaaaaa', 4],
      ['fakebbbbbbbbbbbb', 1],
      ['fakecccccccccccc', 2],
    ];
    for (const [hash, builders] of fakes) {
      await devvit.redis.hSet(KEYS.sculptures(post.id), { [`${par + 1}:${hash}`]: String(builders) });
      await devvit.redis.hSet(KEYS.gallery(post.id), { [hash]: JSON.stringify({ sculpture: '0,0,0', first: hash }) });
    }
    const leanest = await galleryFor(target, 'ann', '?sort=leanest');
    expect(leanest.entries.map((entry) => [entry.blocks, entry.builders])).toEqual([
      [par, 1],
      [par + 1, 1],
      [par + 1, 2],
      [par + 1, 4],
    ]);
    const rarest = await galleryFor(target, 'ann', '?sort=rarest');
    expect(rarest.entries.map((entry) => [entry.builders, entry.blocks])).toEqual([
      [1, par],
      [1, par + 1],
      [2, par + 1],
      [4, par + 1],
    ]);
  });

  it('pages twenty at a time', async () => {
    const target = await manualPost();
    const { post, puzzle } = target;
    await solveAs(target, 'ann');
    // 44 more distinct sculptures, written straight into the counts: real
    // puzzles do not have that many different solutions to hand.
    const ownHash = sculptureHash(canonicalSculpture(parSolution(puzzle.number)));
    for (let index = 0; index < 44; index++) {
      const hash = `fake${String(index).padStart(12, '0')}`;
      const blocks = puzzle.par + 1 + (index % 5);
      await devvit.redis.hSet(KEYS.sculptures(post.id), { [`${blocks}:${hash}`]: String(1 + (index % 3)) });
      await devvit.redis.hSet(KEYS.gallery(post.id), {
        [hash]: JSON.stringify({ sculpture: '0,0,0', first: `player${index}` }),
      });
    }

    const one = await galleryFor(target, 'ann', '?sort=leanest&page=1');
    const two = await galleryFor(target, 'ann', '?sort=leanest&page=2');
    const three = await galleryFor(target, 'ann', '?sort=leanest&page=3');
    expect([one, two, three].map((page) => [page.page, page.pages, page.total, page.entries.length])).toEqual([
      [1, 3, 45, 20],
      [2, 3, 45, 20],
      [3, 3, 45, 5],
    ]);
    // Every sculpture appears exactly once across the pages, in order.
    const ids = [one, two, three].flatMap((page) => page.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(45);
    const blocks = [one, two, three].flatMap((page) => page.entries.map((entry) => entry.blocks));
    expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
    // The caller's own sculpture is marked wherever it lands: leanest, so first.
    expect(one.entries[0]).toMatchObject({ id: ownHash, yours: true });
    expect(ids.filter((id) => id !== ownHash)).toHaveLength(44);

    // A page outside the range is brought back inside it.
    expect((await galleryFor(target, 'ann', '?page=99')).page).toBe(3);
    expect((await galleryFor(target, 'ann', '?page=0')).page).toBe(1);
    expect((await galleryFor(target, 'ann', '?page=abc')).page).toBe(1);
  });
});

describe('streak flair', () => {
  /** Solves `days` daily posts in a row as one player, and returns the last. */
  const streakOf = async (name: string, days: number): Promise<Opened> => {
    let last: Opened | undefined;
    for (let day = 0; day < days; day++) {
      last = await dailyPost(day);
      await solveAs(last, name);
    }
    if (!last) throw new Error('No days');
    return last;
  };

  it('is given when the best streak first reaches three days, and not before', async () => {
    const day1 = await dailyPost(0);
    await solveAs(day1, 'ann');
    const day2 = await dailyPost(1);
    await solveAs(day2, 'ann');
    expect(devvit.userFlairs()).toEqual({});
    const day3 = await dailyPost(2);
    await solveAs(day3, 'ann');
    expect(devvit.userFlairs()).toEqual({ ann: '3-day streak' });
    expect((await resultFor(day3, 'ann')).streak).toEqual({ current: 3, best: 3 });
  });

  it('is kept when the streak is later broken', async () => {
    await streakOf('ann', 3);
    await dailyPost(3); // missed
    const day5 = await dailyPost(4);
    await solveAs(day5, 'ann');
    expect((await resultFor(day5, 'ann')).streak).toEqual({ current: 1, best: 3 });
    expect(devvit.userFlairs()).toEqual({ ann: '3-day streak' });
  });

  it('is not set when the subreddit has user flair turned off, and is set later once it is on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      devvit.setUserFlairsEnabled(false);
      await streakOf('ann', 3);
      expect(devvit.userFlairs()).toEqual({});
      expect(warn).toHaveBeenCalled();
      // The submission itself was fine.
      expect(JSON.parse(devvit.hashContents(KEYS.streaks).t2_ann ?? '{}')).toMatchObject({ best: 3, flair: 0 });

      devvit.setUserFlairsEnabled(true);
      const day4 = await dailyPost(3);
      expect(await solveAs(day4, 'ann')).toBe('accepted');
      expect(devvit.userFlairs()).toEqual({ ann: '3-day streak' });
      expect(JSON.parse(devvit.hashContents(KEYS.streaks).t2_ann ?? '{}')).toMatchObject({ best: 4, flair: 3 });
    } finally {
      warn.mockRestore();
    }
  });

  it('never fails a submission when setting flair goes wrong', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      devvit.setFlairFailing(true);
      const day3 = await streakOf('ann', 3);
      expect(error).toHaveBeenCalled();
      expect(devvit.userFlairs()).toEqual({});
      expect(await resultFor(day3, 'ann')).toMatchObject({ rank: 1, streak: { current: 3, best: 3 } });
    } finally {
      error.mockRestore();
    }
  });
});
