import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseGalleryResponse,
  parseMakePuzzleResponse,
  parsePuzzleResponse,
  parseResultResponse,
  parseReviewResponse,
  parseSplashResponse,
  parseSubmitResponse,
  type MakePuzzleResponse,
  type ReviewResponse,
} from '../../shared/api';
import { castShadows } from '../../shared/community';
import type { Size } from '../../shared/puzzle';
import { KEYS } from '../core/keys';
import type { FakePost } from '../testing/fakeDevvit';
import { parSolution } from '../testing/solutions';

const devvit = await vi.hoisted(async () => {
  const { createFakeDevvit } = await import('../testing/fakeDevvit');
  return createFakeDevvit();
});
vi.mock('@devvit/web/server', () => devvit);

const { api } = await import('./api');
const { community } = await import('./community');
const { createDailyPost, createNextPost, creditText, loadPost } = await import('../core/posts');
const { WEEKLY_LIMIT } = await import('../core/community');

const FOUR: Size = { w: 4, d: 4, h: 4 };
const FIVE: Size = { w: 5, d: 5, h: 5 };
const DAY = 24 * 60 * 60 * 1000;

// Sculptures on a 4x4x4 board that pass every rule, each a different puzzle. Par is 7, 8, 10 and 8.
const A = ['0,0,3', '1,0,3', '2,0,3', '3,0,3', '0,1,3', '0,2,3', '3,1,3', '0,0,0', '0,0,1', '0,0,2', '0,1,0'];
const C = [...A, '1,1,3'];
const E = [...A, '2,1,3', '2,2,3'];
const LOW = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2', '0,0,3', '0,1,0', '0,2,0', '3,1,0'];
// Two sculptures built differently whose puzzles are lookalikes of each other.
const B = [...A, '3,2,3'];
const B_LOOKALIKE = [...A, '0,2,0'];
// A valid 5x5x5 sculpture, par 13.
const FIVE_GOOD = [
  '0,0,4', '1,0,4', '2,0,4', '3,0,4', '4,0,4', '0,1,4', '0,2,4', '0,3,4', '4,1,4', '2,1,4',
  '0,0,0', '0,0,1', '0,0,2', '0,0,3', '0,1,0', '0,2,0', '0,1,2',
];

const move = (blocks: readonly string[], change: (x: number, y: number, z: number) => [number, number, number]): string[] =>
  blocks.map((key) => {
    const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
    return change(x, y, z).join(',');
  });
const mirrored = (blocks: readonly string[]): string[] => move(blocks, (x, y, z) => [3 - x, y, z]);
const swapped = (blocks: readonly string[]): string[] => move(blocks, (x, y, z) => [z, y, x]);

// Monday 30 November 2026 to Monday 7 December: the Sunday is the 6th.
const date = (day: string, hour = 5): Date => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
const SATURDAY = '2026-12-05';
const SUNDAY = '2026-12-06';
const MONDAY = '2026-12-07';

const latestPost = (): FakePost => {
  const post = devvit.posts.at(-1);
  if (!post) throw new Error('No post was created');
  return post;
};

const dailyPost = async (day: string): Promise<FakePost> => {
  vi.setSystemTime(date(day));
  expect(await createDailyPost(date(day))).toBe('created');
  return latestPost();
};

const as = (post: FakePost, name: string | undefined): void =>
  devvit.enterPost(post, name === undefined ? undefined : `t2_${name}`);

const submit = async (post: FakePost, name: string, blocks: readonly string[]) => {
  as(post, name);
  const response = await api.request('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  const body: unknown = await response.json();
  return { status: response.status, body, parsed: parseSubmitResponse(body) };
};

/** Solves a post with the generator's own par solution for its puzzle. */
const solve = async (post: FakePost, name: string): Promise<void> => {
  const record = await loadPost(post.id);
  if (!record) throw new Error('The post has no record');
  expect((await submit(post, name, parSolution(record.puzzle.number))).status).toBe(200);
};

let home: FakePost;

/** Makes players eligible: each solves the first daily post. */
const eligible = async (...names: string[]): Promise<void> => {
  for (const name of names) await solve(home, name);
};

const send = async (name: string | undefined, blocks: readonly string[], size: Size = FOUR) => {
  as(home, name);
  const response = await community.request('/puzzles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size, blocks }),
  });
  const body: unknown = await response.json();
  const parsed: MakePuzzleResponse | null = parseMakePuzzleResponse(body);
  return { status: response.status, text: JSON.stringify(body), parsed };
};

const reasonOf = (sent: { parsed: MakePuzzleResponse | null }): string | null =>
  sent.parsed?.status === 'refused' ? sent.parsed.reason : null;

const review = async (name: string | undefined, body?: unknown) => {
  as(home, name);
  const response = await community.request('/review', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw: unknown = await response.json();
  const parsed: ReviewResponse | null = parseReviewResponse(raw);
  return { status: response.status, text: JSON.stringify(raw), parsed };
};

/** The id of the puzzle that has waited longest, as a moderator sees it. */
const oldestId = async (): Promise<string> => {
  const { parsed } = await review('mod');
  if (parsed?.status !== 'ok' || !parsed.puzzle) throw new Error('Nothing is waiting');
  return parsed.puzzle.id;
};

const decide = async (decision: 'approve' | 'reject'): Promise<void> => {
  const id = await oldestId();
  expect((await review('mod', { id, decision })).status).toBe(200);
};

const puzzleFor = async (post: FakePost, name: string | undefined) => {
  as(post, name);
  const body: unknown = await (await api.request('/puzzle')).json();
  const parsed = parsePuzzleResponse(body);
  if (!parsed) throw new Error(`Unreadable puzzle response: ${JSON.stringify(body)}`);
  return { parsed, text: JSON.stringify(body) };
};

const get = async (post: FakePost, name: string | undefined, path: string) => {
  as(post, name);
  const response = await api.request(path);
  const body: unknown = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
};

beforeEach(async () => {
  devvit.reset();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  devvit.addModerator('mod');
  // Every test starts on a Monday with one daily post to become eligible on.
  home = await dailyPost('2026-11-30');
});

describe('who may make a puzzle', () => {
  it('refuses a player who has never submitted a daily puzzle', async () => {
    const sent = await send('ann', A);
    expect(sent.status).toBe(422);
    expect(reasonOf(sent)).toBe('not-eligible');
    expect(devvit.hashContents(KEYS.communityPending)).toEqual({});
  });

  it('does not count a puzzle from an extra post made from the menu', async () => {
    await createNextPost('manual', date('2026-11-30', 6));
    await solve(latestPost(), 'ann');
    expect(reasonOf(await send('ann', A))).toBe('not-eligible');
  });

  it('refuses a logged-out visitor', async () => {
    const sent = await send(undefined, A);
    expect(sent.status).toBe(401);
    expect(reasonOf(sent)).toBe('logged-out');
  });

  it('accepts a player who has submitted a daily puzzle, and works out par itself', async () => {
    await eligible('ann');
    const sent = await send('ann', A);
    expect(sent.status).toBe(200);
    expect(sent.parsed).toEqual({ status: 'sent', par: 7 });
  });

  it('refuses a second puzzle while the first still waits for review', async () => {
    await eligible('ann');
    expect((await send('ann', A)).parsed?.status).toBe('sent');
    const second = await send('ann', C);
    expect(reasonOf(second)).toBe('pending');
    expect(Object.keys(devvit.hashContents(KEYS.communityPending))).toHaveLength(1);
  });

  it(`refuses more than ${WEEKLY_LIMIT} puzzles in seven days, and allows more once a week has passed`, async () => {
    await eligible('ann');
    const start = date('2026-12-01').getTime();
    // Three sent on three days, each reviewed so the waiting slot is free again.
    for (const [index, blocks] of [A, C, E].entries()) {
      vi.setSystemTime(start + index * DAY);
      expect((await send('ann', blocks)).parsed?.status, `puzzle ${index + 1}`).toBe('sent');
      await decide(index === 1 ? 'reject' : 'approve');
    }
    vi.setSystemTime(start + 3 * DAY);
    expect(reasonOf(await send('ann', LOW))).toBe('weekly-limit');
    // Just under seven days after the first: still three in the last seven days.
    vi.setSystemTime(start + 7 * DAY - 1000);
    expect(reasonOf(await send('ann', LOW))).toBe('weekly-limit');
    // Seven days after the first, it no longer counts.
    vi.setSystemTime(start + 7 * DAY);
    expect((await send('ann', LOW)).parsed?.status).toBe('sent');
  });

  it('tells the game whether the caller may make one, and why not', async () => {
    expect((await puzzleFor(home, 'ann')).parsed.community).toEqual({
      canMake: false,
      why: 'Solve a daily puzzle first. Then you can make one.',
      review: null,
    });
    await eligible('ann');
    expect((await puzzleFor(home, 'ann')).parsed.community).toEqual({ canMake: true, why: null, review: null });
    await send('ann', A);
    expect((await puzzleFor(home, 'ann')).parsed.community.why).toBe('Your last puzzle is still waiting for review.');
    expect((await puzzleFor(home, undefined)).parsed.community.canMake).toBe(false);
  });
});

describe('the rules, checked again on the server', () => {
  const refusal = async (blocks: readonly string[], size: Size = FOUR): Promise<string | null> => {
    await eligible('ann');
    const sent = await send('ann', blocks, size);
    expect(sent.status).toBe(422);
    return reasonOf(sent);
  };

  it('refuses a floating block', async () => {
    expect(await refusal([...A, '2,3,1'])).toBe('floating');
  });

  it('refuses a shadow that does not reach across its wall', async () => {
    expect(await refusal(['0,0,0', '1,0,0', '0,1,0', '0,0,1', '0,0,2', '0,0,3', '0,2,0'])).toBe('span');
  });

  it('refuses a shadow that is a plain rectangle', async () => {
    expect(await refusal(['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2', '0,0,3', '0,1,0', '0,1,1', '0,1,2', '0,1,3'])).toBe(
      'rectangle'
    );
  });

  it('refuses two identical shadows', async () => {
    expect(await refusal(['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2', '0,0,3', '0,1,0', '0,2,0'])).toBe('different');
  });

  it('refuses a sculpture that is too low', async () => {
    expect(await refusal(['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2', '0,1,0', '1,1,0'])).toBe('height');
  });

  it('refuses a puzzle that takes too few blocks to solve', async () => {
    // Five blocks solve it: three on the floor and a tower of two.
    expect(await refusal(['0,0,0', '0,0,1', '0,0,2', '1,0,2', '2,0,2', '0,1,2', '0,2,2'])).toBe('par');
  });

  it('refuses a puzzle that takes too many blocks to solve', async () => {
    // A wall four, four, three and two high: at least thirteen blocks.
    const wall = [4, 4, 3, 2].flatMap((height, x) => Array.from({ length: height }, (_, y) => `${x},${y},0`));
    expect(await refusal([...wall, '0,0,1', '0,0,2', '0,0,3'])).toBe('par');
  });

  it('refuses a board that is not on offer, and blocks outside the board', async () => {
    expect(await refusal(A, { w: 5, d: 5, h: 4 })).toBe('board');
    expect(await refusal([...A, '4,0,0'])).toBe('out-of-bounds');
  });

  it('refuses a body it cannot read', async () => {
    await eligible('ann');
    as(home, 'ann');
    for (const body of [{ size: FOUR }, { blocks: A }, { size: FOUR, blocks: ['0,0'] }, { size: FOUR, blocks: [...A, A[0]] }, null]) {
      const response = await community.request('/puzzles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('accepts a 5x5x5 puzzle that passes them all', async () => {
    await eligible('ann');
    expect((await send('ann', FIVE_GOOD, FIVE)).parsed).toEqual({ status: 'sent', par: 13 });
  });

  it('stores the silhouettes it worked out, not anything the client said', async () => {
    await eligible('ann');
    await send('ann', A);
    const { parsed } = await review('mod');
    const shadows = castShadows(new Set(A), FOUR);
    expect(parsed).toEqual({
      status: 'ok',
      waiting: 1,
      puzzle: { id: 'cp-0001', size: FOUR, front: shadows.frontRows, side: shadows.sideRows, par: 7, maker: 'ann' },
    });
  });
});

describe('duplicates', () => {
  beforeEach(async () => {
    await eligible('ann', 'bea');
    expect((await send('ann', B)).parsed?.status).toBe('sent');
  });

  it('refuses the same puzzle while it is pending', async () => {
    expect(reasonOf(await send('bea', B))).toBe('duplicate');
  });

  it('refuses it mirrored, and with its two shadows swapped', async () => {
    expect(reasonOf(await send('bea', mirrored(B)))).toBe('duplicate');
    expect(reasonOf(await send('bea', swapped(B)))).toBe('duplicate');
    expect(reasonOf(await send('bea', mirrored(swapped(B))))).toBe('duplicate');
  });

  it('refuses a different sculpture that casts a lookalike pair of shadows', async () => {
    expect(reasonOf(await send('bea', B_LOOKALIKE))).toBe('duplicate');
  });

  it('refuses it once approved, and once it has been used for a post', async () => {
    await decide('approve');
    expect(reasonOf(await send('bea', B))).toBe('duplicate');
    await dailyPost(SUNDAY);
    expect(reasonOf(await send('bea', mirrored(B)))).toBe('duplicate');
  });

  it('lets the same shadows be sent again after a rejection', async () => {
    await decide('reject');
    expect((await send('bea', B)).parsed?.status).toBe('sent');
  });

  it('refuses a puzzle that is already in the generated queue', async () => {
    // The generator's own solution for puzzle 1 casts exactly puzzle 1's shadows.
    const queued = parSolution(1);
    expect(reasonOf(await send('bea', queued))).toBe('duplicate');
    expect(reasonOf(await send('bea', mirrored(queued)))).toBe('duplicate');
  });

  it('leaves the second maker free to send something else after a refusal', async () => {
    expect(reasonOf(await send('bea', B))).toBe('duplicate');
    expect((await send('bea', C)).parsed?.status).toBe('sent');
  });
});

describe('review', () => {
  beforeEach(async () => {
    await eligible('ann', 'bea');
    vi.setSystemTime(date('2026-12-01'));
    await send('ann', A);
    vi.setSystemTime(date('2026-12-02'));
    await send('bea', C);
  });

  it('refuses anyone who is not a moderator, on both routes', async () => {
    for (const name of ['ann', 'zed', undefined]) {
      const looked = await review(name);
      expect(looked.status, String(name)).toBe(403);
      expect(looked.parsed).toEqual({ status: 'refused', message: 'Only moderators can review puzzles.' });
      expect((await review(name, { id: 'cp-0001', decision: 'approve' })).status).toBe(403);
    }
    // Nothing was approved by the attempts.
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual([]);
    expect(devvit.sortedSetMembers(KEYS.communityPendingOrder)).toEqual(['cp-0001', 'cp-0002']);
  });

  it('shows a moderator the number waiting and the oldest first', async () => {
    const { parsed } = await review('mod');
    expect(parsed?.status === 'ok' && parsed.waiting).toBe(2);
    expect(parsed?.status === 'ok' && parsed.puzzle?.maker).toBe('ann');
    expect((await puzzleFor(home, 'mod')).parsed.community.review).toBe(2);
    expect((await puzzleFor(home, 'ann')).parsed.community.review).toBeNull();
  });

  it('approving moves the puzzle to the community queue and frees the maker`s slot', async () => {
    const after = await review('mod', { id: 'cp-0001', decision: 'approve' });
    expect(after.parsed?.status === 'ok' && after.parsed.waiting).toBe(1);
    expect(after.parsed?.status === 'ok' && after.parsed.puzzle?.id).toBe('cp-0002');
    expect(devvit.sortedSetMembers(KEYS.communityPendingOrder)).toEqual(['cp-0002']);
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual(['cp-0001']);
    expect(Object.keys(devvit.hashContents(KEYS.communityPending))).toEqual(['cp-0002']);
    expect(devvit.hashContents(KEYS.communityPendingByMaker)).toEqual({ t2_bea: 'cp-0002' });
    expect((await send('ann', E)).parsed?.status).toBe('sent');
  });

  it('rejecting removes the puzzle and frees the maker`s slot', async () => {
    await review('mod', { id: 'cp-0001', decision: 'reject' });
    expect(devvit.sortedSetMembers(KEYS.communityPendingOrder)).toEqual(['cp-0002']);
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual([]);
    expect(devvit.hashContents(KEYS.communityApproved)).toEqual({});
    expect(devvit.hashContents(KEYS.communityPendingByMaker)).toEqual({ t2_bea: 'cp-0002' });
    expect((await send('ann', E)).parsed?.status).toBe('sent');
  });

  it('queues approved puzzles in the order they were approved, not the order they were sent', async () => {
    vi.setSystemTime(date('2026-12-03'));
    await review('mod', { id: 'cp-0002', decision: 'approve' });
    vi.setSystemTime(date('2026-12-04'));
    await review('mod', { id: 'cp-0001', decision: 'approve' });
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual(['cp-0002', 'cp-0001']);
  });

  it('counts a puzzle once when two moderators decide at the same moment', async () => {
    devvit.addModerator('mod2');
    as(home, 'mod');
    const both = await Promise.all(
      ['approve', 'approve'].map((decision) =>
        community.request('/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'cp-0001', decision }),
        })
      )
    );
    expect(both.map((response) => response.status)).toEqual([200, 200]);
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual(['cp-0001']);
  });

  it('does nothing for a puzzle that is not waiting, or a body it cannot read', async () => {
    expect((await review('mod', { id: 'cp-0099', decision: 'approve' })).status).toBe(200);
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual([]);
    for (const body of [{ id: 'cp-0001' }, { id: 'cp-0001', decision: 'maybe' }, { decision: 'approve' }, null]) {
      expect((await review('mod', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(devvit.sortedSetMembers(KEYS.communityPendingOrder)).toEqual(['cp-0001', 'cp-0002']);
  });
});

describe('the Sunday post', () => {
  const approved = async (name: string, blocks: readonly string[]): Promise<void> => {
    await eligible(name);
    expect((await send(name, blocks)).parsed?.status).toBe('sent');
    await decide('approve');
  };

  it('uses the oldest approved community puzzle, and credits its maker', async () => {
    await approved('ann', A);
    await approved('bea', C);
    const post = await dailyPost(SUNDAY);
    const record = await loadPost(post.id);
    expect(record?.puzzle.id).toBe('cp-0001');
    expect(record?.maker).toEqual({ userId: 't2_ann', username: 'ann' });
    expect(record?.kind).toBe('daily');
    // The title is the normal one.
    expect(post.title).toMatch(/^Twin Shadows #\d+$/);
    // The other approved puzzle is still waiting for the Sunday after.
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual(['cp-0002']);
    expect(Object.keys(devvit.hashContents(KEYS.communityApproved))).toEqual(['cp-0002']);
  });

  it('adds one pinned comment from the app crediting the maker', async () => {
    await approved('ann', A);
    const post = await dailyPost(SUNDAY);
    expect(devvit.comments).toEqual([
      { id: 't1_comment1', postId: post.id, text: creditText('ann'), authorName: 'the-app', runAs: 'APP', pinned: true },
    ]);
    expect(creditText('ann')).toBe("Today's puzzle was made by u/ann.");
  });

  it('still makes the post when the comment or the pin fails', async () => {
    await approved('ann', A);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    devvit.setPinningFailing(true);
    const post = await dailyPost(SUNDAY);
    expect((await loadPost(post.id))?.maker?.username).toBe('ann');
    expect(devvit.comments[0]?.pinned).toBe(false);

    await approved('bea', C);
    devvit.setCommentsFailing(true);
    const next = await dailyPost('2026-12-13');
    expect((await loadPost(next.id))?.maker?.username).toBe('bea');
    expect(devvit.comments).toHaveLength(1);
  });

  it('falls back to the generated tier 3 puzzle when none is approved', async () => {
    await eligible('ann');
    // Sent but still pending: not approved, so not used.
    await send('ann', A);
    const post = await dailyPost(SUNDAY);
    const record = await loadPost(post.id);
    expect(record?.puzzle.id).toMatch(/^ts-/);
    expect(record?.puzzle.tier).toBe(3);
    expect(record?.maker).toBeNull();
    expect(devvit.comments).toEqual([]);
  });

  it('leaves an approved puzzle alone on every other day, and for an extra post made on Sunday', async () => {
    await approved('ann', A);
    for (const day of ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', SATURDAY]) {
      const record = await loadPost((await dailyPost(day)).id);
      expect(record?.maker, day).toBeNull();
    }
    await createNextPost('manual', date(SUNDAY, 3));
    expect((await loadPost(latestPost().id))?.maker).toBeNull();
    expect(devvit.sortedSetMembers(KEYS.communityApprovedOrder)).toEqual(['cp-0001']);
    // And is used when Sunday's daily post comes.
    expect((await loadPost((await dailyPost(SUNDAY)).id))?.maker?.username).toBe('ann');
  });

  it('shows the credit in the game and on the splash', async () => {
    await approved('ann', A);
    const post = await dailyPost(SUNDAY);
    const { parsed } = await puzzleFor(post, 'bea');
    expect(parsed.maker).toBe('ann');
    expect(parsed.yours).toBe(false);
    expect(parsed.post).toBe((await loadPost(post.id))?.number);
    const splash = parseSplashResponse((await get(post, 'bea', '/splash')).body);
    expect(splash?.maker).toBe('ann');
    // A generated puzzle has no credit.
    expect((await puzzleFor(home, 'bea')).parsed.maker).toBeNull();
  });
});

describe('the maker on their own puzzle', () => {
  let sunday: FakePost;

  beforeEach(async () => {
    await eligible('ann', 'bea', 'cal');
    await send('ann', A);
    await decide('approve');
    sunday = await dailyPost(SUNDAY);
  });

  it('is told the puzzle is theirs', async () => {
    expect((await puzzleFor(sunday, 'ann')).parsed.yours).toBe(true);
    expect((await puzzleFor(sunday, 'bea')).parsed.yours).toBe(false);
    expect((await puzzleFor(sunday, undefined)).parsed.yours).toBe(false);
  });

  it('cannot submit, so is never ranked on it', async () => {
    await submit(sunday, 'bea', A);
    const refused = await submit(sunday, 'ann', A);
    expect(refused.status).toBe(403);
    expect(refused.parsed).toEqual({
      status: 'rejected',
      reason: 'own-puzzle',
      message: 'You made this puzzle, so you are not ranked on it.',
    });
    expect(devvit.sortedSetMembers(KEYS.leaderboard(sunday.id))).toEqual(['t2_bea']);
    expect(Object.keys(devvit.hashContents(KEYS.submissions(sunday.id)))).toEqual(['t2_bea']);
  });

  it('sees the results without submitting, with no place of their own', async () => {
    await submit(sunday, 'bea', A);
    await submit(sunday, 'cal', [...A, '1,0,0']);
    const result = parseResultResponse((await get(sunday, 'ann', '/result')).body);
    expect(result).toEqual({
      status: 'maker',
      result: {
        par: 7,
        solvers: 2,
        leaderboard: [
          { rank: 1, username: 'bea', blocks: 11, you: false },
          { rank: 2, username: 'cal', blocks: 12, you: false },
        ],
        record: { blocks: 11, underPar: false },
      },
    });
    // Before anyone has solved it there is simply nothing to list.
    const other = await dailyPost('2026-12-13');
    expect((await get(other, 'ann', '/result')).status).toBe(403);
  });

  it('sees the gallery without submitting; nobody else does', async () => {
    await submit(sunday, 'bea', A);
    const gallery = parseGalleryResponse((await get(sunday, 'ann', '/gallery')).body);
    expect(gallery?.status === 'ok' && gallery.gallery.total).toBe(1);
    expect(gallery?.status === 'ok' && gallery.gallery.entries[0]?.yours).toBe(false);
    expect((await get(sunday, 'cal', '/gallery')).status).toBe(403);
  });

  it('keeps their streak across the day they could not play', async () => {
    // Ann solved Saturday's puzzle; Sunday's is her own; she solves Monday's.
    const streakOf = async (post: FakePost): Promise<number | null> =>
      parseSplashResponse((await get(post, 'ann', '/splash')).body)?.streak ?? null;
    devvit.reset();
    devvit.addModerator('mod');
    home = await dailyPost('2026-12-04');
    await eligible('ann');
    await send('ann', A);
    await decide('approve');
    const saturday = await dailyPost(SATURDAY);
    await solve(saturday, 'ann');
    expect(await streakOf(saturday)).toBe(2);

    const own = await dailyPost(SUNDAY);
    expect((await loadPost(own.id))?.maker?.username).toBe('ann');
    // Her own puzzle's day: the streak still shows.
    expect(await streakOf(own)).toBe(2);

    const monday = await dailyPost(MONDAY);
    // Not yet played, and Sunday does not count as missed.
    expect(await streakOf(monday)).toBe(2);
    await solve(monday, 'ann');
    expect(await streakOf(monday)).toBe(3);
  });

  it('does not carry the streak of a player who simply missed the day', async () => {
    devvit.reset();
    devvit.addModerator('mod');
    home = await dailyPost('2026-12-04');
    await eligible('ann', 'bea');
    await send('ann', A);
    await decide('approve');
    await solve(await dailyPost(SATURDAY), 'bea');
    await dailyPost(SUNDAY);
    const monday = await dailyPost(MONDAY);
    await solve(monday, 'bea');
    expect(parseSplashResponse((await get(monday, 'bea', '/splash')).body)?.streak).toBe(1);
  });
});

describe('everyone else on a community puzzle', () => {
  it('submits, ranks and keeps a streak exactly as on any daily puzzle', async () => {
    await eligible('ann', 'bea');
    await send('ann', A);
    await decide('approve');
    await solve(await dailyPost(SATURDAY), 'bea');
    const sunday = await dailyPost(SUNDAY);
    const accepted = await submit(sunday, 'bea', A);
    expect(accepted.parsed?.status).toBe('accepted');
    const result = parseResultResponse((await get(sunday, 'bea', '/result')).body);
    expect(result?.status === 'ok' && result.result.rank).toBe(1);
    // The first daily post, Saturday's and now Sunday's: three in a row.
    expect(result?.status === 'ok' && result.result.streak.current).toBe(3);
    // A wrong sculpture is still refused.
    expect((await submit(sunday, 'cal', C)).status).toBe(422);
  });
});

describe('the maker`s private solution', () => {
  it('is stored, and never appears in any response', async () => {
    await eligible('ann', 'bea');
    const responses: string[] = [];
    responses.push((await send('ann', A)).text);
    // Stored with the puzzle, for the record.
    const stored = Object.values(devvit.hashContents(KEYS.communityPending)).join('');
    expect(stored).toContain('"solution"');
    const solution = /"solution":(\[[^\]]*\])/.exec(stored)?.[1] ?? '';
    expect(solution.length).toBeGreaterThan(10);

    responses.push((await review('mod')).text);
    const id = await oldestId();
    responses.push((await review('mod', { id, decision: 'approve' })).text);
    const sunday = await dailyPost(SUNDAY);
    await submit(sunday, 'bea', [...A, '1,0,0']);
    for (const viewer of ['ann', 'bea', 'mod', undefined]) {
      responses.push((await puzzleFor(sunday, viewer)).text);
      for (const path of ['/splash', '/result', '/gallery']) responses.push((await get(sunday, viewer, path)).text);
    }
    for (const text of responses) {
      expect(text).not.toContain('"solution"');
      expect(text).not.toContain(solution);
    }
    // The maker's own sculpture as they built it is not handed out either:
    // the only sculpture in any of these is the one bea submitted.
    const built = [...A].sort().join(';');
    for (const text of responses) {
      const flattened = text.replace(/["[\]]/g, '').replace(/,(?=\d+,\d+,\d+)/g, ';');
      expect(flattened).not.toContain(built);
    }
  });
});

describe('sound setting', () => {
  it('is off for nobody until they say so, then remembered per player', async () => {
    expect((await puzzleFor(home, 'ann')).parsed.muted).toBe(false);
    as(home, 'ann');
    const saved = await api.request('/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: true }),
    });
    expect(saved.status).toBe(200);
    expect((await puzzleFor(home, 'ann')).parsed.muted).toBe(true);
    expect((await puzzleFor(home, 'bea')).parsed.muted).toBe(false);
    expect((await puzzleFor(home, undefined)).parsed.muted).toBe(false);
  });

  it('refuses a logged-out visitor and a body it cannot read', async () => {
    const post = (name: string | undefined, body: unknown) => {
      as(home, name);
      return api.request('/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    };
    expect((await post(undefined, { muted: true })).status).toBe(401);
    expect((await post('ann', { muted: 'yes' })).status).toBe(400);
    expect(devvit.hashContents(KEYS.prefs)).toEqual({});
  });
});
