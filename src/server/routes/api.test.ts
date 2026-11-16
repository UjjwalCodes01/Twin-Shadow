import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseDebugPuzzleResponse,
  parsePuzzleResponse,
  parseSubmitResponse,
  type SubmitResponse,
} from '../../shared/api';
import { findFloating, parseSilhouette, projectFront, projectSide } from '../../shared/logic';
import { TEST_PUZZLE, TEST_SOLUTION } from '../../shared/puzzle';
import { canonicalSculpture } from '../../shared/score';
import { isDevSubreddit } from '../core/dev';
import { KEYS } from '../core/keys';
import { QUEUE, puzzleByNumber, puzzlesOfTier } from '../core/queue';
import { floatingVariant, parSolution } from '../testing/solutions';

// The Devvit runtime only exists inside Reddit, so stand in for it.
const devvit = await vi.hoisted(async () => {
  const { createFakeDevvit } = await import('../testing/fakeDevvit');
  return createFakeDevvit();
});
vi.mock('@devvit/web/server', () => devvit);

const { api } = await import('./api');
const { createNextPost } = await import('../core/posts');

const ALICE = 't2_alice';
const BOB = 't2_bob';
// 2026-11-30 is a Monday, so these posts get tier 1 puzzles on a 4x4x4 board.
const MONDAY = new Date('2026-11-30T12:00:00Z');

const get = async (path: string): Promise<{ status: number; body: unknown }> => {
  const response = await api.request(path);
  const body: unknown = await response.json();
  return { status: response.status, body };
};

const submit = async (payload: unknown): Promise<{ status: number; body: SubmitResponse }> => {
  const response = await api.request('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  const raw: unknown = await response.json();
  const body = parseSubmitResponse(raw);
  if (!body) throw new Error(`Unreadable submit response: ${JSON.stringify(raw)}`);
  return { status: response.status, body };
};

/** Creates a post and puts the request context inside it. */
const openNewPost = async (userId: string | undefined, now: Date = MONDAY) => {
  const created = await createNextPost('manual', now);
  const post = devvit.posts.at(-1);
  if (!post) throw new Error('No post was created');
  devvit.enterPost(post, userId);
  return { ...created, solution: parSolution(created.puzzle.number) };
};

const submissionsStored = (postId: string): Record<string, string> =>
  devvit.hashContents(KEYS.submissions(postId));

beforeEach(() => devvit.reset());

describe('GET /api/puzzle', () => {
  it('returns the puzzle saved with the post, passing the client`s validation', async () => {
    await createNextPost('manual', MONDAY);
    const { puzzle } = await openNewPost(ALICE); // the second Monday post
    const { status, body } = await get('/puzzle');
    expect(status).toBe(200);
    const parsed = parsePuzzleResponse(body);
    expect(parsed?.puzzle).toEqual(puzzle);
    expect(parsed?.puzzle).toEqual(puzzlesOfTier(1)[1]);
    expect(parsed?.canSubmit).toBe(true);
    expect(parsed?.submission).toBeNull();
  });

  it('sends nothing but the player-facing fields', async () => {
    await openNewPost(ALICE);
    const { body } = await get('/puzzle');
    expect(JSON.stringify(body)).not.toContain('parIsOptimal');
    expect(Object.keys(Object(body)).sort()).toEqual(['canSubmit', 'debug', 'onboarding', 'puzzle', 'submission']);
    expect(Object.keys(Object(parsePuzzleResponse(body)?.puzzle)).sort()).toEqual(
      ['front', 'id', 'number', 'par', 'side', 'size', 'tier'].sort()
    );
  });

  it('answers 404 for a post with no saved puzzle, and outside any post', async () => {
    devvit.context.postId = 't3_stranger';
    expect((await get('/puzzle')).status).toBe(404);
    // A post made by an older version only had a puzzle number.
    await devvit.redis.set('post:t3_stranger:puzzle', '1');
    expect((await get('/puzzle')).status).toBe(404);
    devvit.context.postId = undefined;
    expect((await get('/puzzle')).status).toBe(404);
  });

  it('lets a logged-out player load the puzzle but marks submitting as off', async () => {
    const { puzzle } = await openNewPost(undefined);
    const parsed = parsePuzzleResponse((await get('/puzzle')).body);
    expect(parsed?.puzzle).toEqual(puzzle);
    expect(parsed?.canSubmit).toBe(false);
  });

  it('returns the stored submission to a returning player, and not to anyone else', async () => {
    const { solution } = await openNewPost(ALICE);
    await submit({ blocks: solution });

    const again = parsePuzzleResponse((await get('/puzzle')).body);
    expect(again?.submission?.blocks).toBe(solution.length);
    expect(again?.submission?.stars).toBe(3);
    expect(canonicalSculpture(again?.submission?.sculpture ?? [])).toBe(canonicalSculpture(solution));
    expect(again?.submission).not.toHaveProperty('seconds');

    devvit.context.userId = BOB;
    expect(parsePuzzleResponse((await get('/puzzle')).body)?.submission).toBeNull();
  });

  it('turns debug on only in a playtest subreddit', async () => {
    await openNewPost(ALICE);
    expect(parsePuzzleResponse((await get('/puzzle')).body)?.debug).toBe(false);
    devvit.context.subredditName = 'twin_shadowss_dev';
    expect(parsePuzzleResponse((await get('/puzzle')).body)?.debug).toBe(true);
  });
});

describe('a post`s saved puzzle copy', () => {
  it('is used for loading and for checking a submission, even for a puzzle the queue does not hold', async () => {
    // Stands for a post whose puzzle has since been dropped from the queue file.
    expect(QUEUE.some((puzzle) => puzzle.id === TEST_PUZZLE.id)).toBe(false);
    const { postId } = await openNewPost(ALICE);
    const saved = { number: 1, kind: 'manual', daily: null, date: '2026-11-30', puzzle: TEST_PUZZLE };
    await devvit.redis.set(KEYS.post(postId), JSON.stringify(saved));

    expect(parsePuzzleResponse((await get('/puzzle')).body)?.puzzle).toEqual(TEST_PUZZLE);
    const result = await submit({ blocks: TEST_SOLUTION });
    expect(result.body).toMatchObject({ status: 'accepted', submission: { blocks: 6, par: TEST_PUZZLE.par } });
  });

  it('stays the same after the queue file`s contents change', async () => {
    const { puzzle, solution } = await openNewPost(ALICE);

    // Load the server again with a different queue file: every puzzle moved
    // one place along, so each number now names a different puzzle.
    vi.resetModules();
    const shifted = QUEUE.map((entry, index) => {
      const source = QUEUE[(index + 7) % QUEUE.length];
      return { ...source, number: entry.number, id: entry.id };
    });
    vi.doMock('../data/puzzles.json', () => ({ default: shifted }));
    try {
      const reloaded = await import('./api');
      const queue = await import('../core/queue');
      expect(queue.puzzleByNumber(puzzle.number)).not.toEqual(puzzle);

      const response = await reloaded.api.request('/puzzle');
      const body: unknown = await response.json();
      expect(parsePuzzleResponse(body)?.puzzle).toEqual(puzzle);

      // The old solution still counts, because the check uses the saved copy.
      const sent = await reloaded.api.request('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: solution }),
      });
      const raw: unknown = await sent.json();
      expect(parseSubmitResponse(raw)?.status).toBe('accepted');
    } finally {
      vi.doUnmock('../data/puzzles.json');
      vi.resetModules();
    }
  });
});

describe('POST /api/submit', () => {
  it('stores a valid submission with everything the record needs', async () => {
    const { postId, puzzle, solution } = await openNewPost(ALICE);
    vi.useFakeTimers();
    let result;
    try {
      vi.setSystemTime(5_042_400);
      result = await submit({ blocks: [...solution].reverse() });
    } finally {
      vi.useRealTimers();
    }

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'accepted',
      submission: { blocks: solution.length, par: puzzle.par, stars: 3 },
    });
    expect(result.body).not.toHaveProperty('submission.seconds');
    const stored: unknown = JSON.parse(submissionsStored(postId)[ALICE] ?? 'null');
    expect(stored).toEqual({
      userId: ALICE,
      username: 'alice',
      postId,
      puzzleId: puzzle.id,
      blocks: solution.length,
      // Canonical: the same string whatever order the blocks arrived in.
      sculpture: canonicalSculpture(solution),
      submittedAt: 5_042_400,
    });
  });

  it('returns the first result for a second attempt and stores nothing new', async () => {
    const { postId, solution } = await openNewPost(ALICE);
    await submit({ blocks: solution });
    const before = submissionsStored(postId);

    const second = await submit({ blocks: solution });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'already-submitted', submission: { blocks: solution.length } });
    const third = await submit({ blocks: ['0,0,0'] });
    expect(third.body).toMatchObject({ status: 'already-submitted', submission: { blocks: solution.length } });

    expect(submissionsStored(postId)).toEqual(before);
    expect(Object.keys(submissionsStored(postId))).toEqual([ALICE]);
  });

  it('lets only one of two simultaneous submissions through', async () => {
    const { postId, solution } = await openNewPost(ALICE);
    const [a, b] = await Promise.all([submit({ blocks: solution }), submit({ blocks: solution })]);
    const statuses = [a.body.status, b.body.status].sort();
    expect(statuses).toEqual(['accepted', 'already-submitted']);
    expect(Object.keys(submissionsStored(postId))).toEqual([ALICE]);
  });

  it('keeps each player`s submission separate', async () => {
    const { postId, solution } = await openNewPost(ALICE);
    await submit({ blocks: solution });
    devvit.context.userId = BOB;
    devvit.context.username = 'bob';
    expect((await submit({ blocks: solution, userId: ALICE })).body.status).toBe('accepted');
    const stored = submissionsStored(postId);
    expect(Object.keys(stored).sort()).toEqual([ALICE, BOB]);
    expect(JSON.parse(stored[ALICE] ?? '{}')).toMatchObject({ userId: ALICE, username: 'alice' });
    expect(JSON.parse(stored[BOB] ?? '{}')).toMatchObject({ userId: BOB, username: 'bob' });
  });

  it('checks against the post`s own puzzle, not the latest one', async () => {
    const first = await openNewPost(ALICE);
    const firstPost = devvit.posts.at(-1);
    await openNewPost(ALICE); // now inside the second post
    // The first puzzle's solution does not solve the second.
    expect((await submit({ blocks: first.solution })).body).toMatchObject({ reason: 'not-solved' });
    if (!firstPost) throw new Error('No first post');
    devvit.enterPost(firstPost, ALICE);
    expect((await submit({ blocks: first.solution })).body.status).toBe('accepted');
    expect(Object.keys(submissionsStored(first.postId))).toEqual([ALICE]);
  });

  /** Sends one bad payload to a fresh post and checks it is refused and nothing is stored. */
  const rejected = async (
    payload: (solution: string[]) => unknown,
    reason: string,
    status: number
  ): Promise<void> => {
    devvit.reset();
    const { postId, solution } = await openNewPost(ALICE);
    const result = await submit(payload(solution));
    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ status: 'rejected', reason });
    if (result.body.status === 'rejected') expect(result.body.message).not.toBe('');
    expect(submissionsStored(postId)).toEqual({});
    expect(devvit.hashContents(KEYS.blockCounts(postId))).toEqual({});
    expect(devvit.sortedSetMembers(KEYS.leaderboard(postId))).toEqual([]);
  };

  it('rejects an unsolved sculpture', async () => {
    await rejected((solution) => ({ blocks: solution.slice(1) }), 'not-solved', 422);
    await rejected(() => ({ blocks: [] }), 'not-solved', 422);
  });

  it('rejects a sculpture whose shadows match but which has a floating block', async () => {
    // A real solution plus one block that changes neither shadow and touches
    // nothing: the only thing wrong with it is that it floats.
    const monday = puzzlesOfTier(1);
    const index = monday.findIndex((puzzle) => floatingVariant(puzzle) !== null);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let created = 0; created < index; created++) await createNextPost('manual', MONDAY);
    const { postId, puzzle } = await openNewPost(ALICE);
    const blocks = floatingVariant(puzzle) ?? [];
    const built = new Set(blocks);
    expect(projectFront(built, puzzle.size)).toEqual(parseSilhouette(puzzle.front));
    expect(projectSide(built, puzzle.size)).toEqual(parseSilhouette(puzzle.side));
    expect(findFloating(built)).toHaveLength(1);

    const result = await submit({ blocks });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ status: 'rejected', reason: 'not-solved' });
    expect(submissionsStored(postId)).toEqual({});
  });

  it('rejects a block outside the board', async () => {
    await rejected((solution) => ({ blocks: [...solution, '0,0,99'] }), 'not-solved', 422);
  });

  it('rejects duplicate blocks', async () => {
    await rejected((solution) => ({ blocks: [...solution, solution[0]] }), 'malformed', 400);
  });

  it('rejects malformed requests', async () => {
    const payloads: unknown[] = [
      {},
      { blocks: 'all of them' },
      { blocks: [1, 2, 3] },
      { blocks: ['0,0'] },
      { blocks: ['-1,0,0'] },
      { blocks: ['0,0,0 '] },
      { blocks: ['a,b,c'] },
      { blocks: Array.from({ length: 65 }, (_, index) => `${index},0,0`) }, // more than 4x4x4 cells
      { solved: true, blockCount: 1 },
      'not json at all',
      null,
    ];
    for (const payload of payloads) await rejected(() => payload, 'malformed', 400);
  });

  it('ignores any solved flag, block count or star rating the client sends', async () => {
    await rejected(() => ({ blocks: ['0,0,0'], solved: true, blockCount: 3, stars: 3 }), 'not-solved', 422);
  });

  it('refuses a logged-out submission', async () => {
    const { postId, solution } = await openNewPost(undefined);
    const result = await submit({ blocks: solution });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ status: 'rejected', reason: 'logged-out' });
    expect(submissionsStored(postId)).toEqual({});
  });

  it('refuses a submission from a post with no puzzle', async () => {
    devvit.context.postId = 't3_stranger';
    devvit.context.userId = ALICE;
    const result = await submit({ blocks: parSolution(1) });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ status: 'rejected', reason: 'no-puzzle' });
  });
});

describe('GET /api/debug/puzzle/:number', () => {
  it('returns the numbered puzzle in a playtest subreddit, without parIsOptimal', async () => {
    devvit.context.subredditName = 'twin_shadowss_dev';
    const { status, body } = await get('/debug/puzzle/3');
    expect(status).toBe(200);
    const parsed = parseDebugPuzzleResponse(body);
    expect(parsed?.puzzle).toEqual(puzzleByNumber(3));
    expect(parsed?.count).toBe(QUEUE.length);
    expect(JSON.stringify(body)).not.toContain('parIsOptimal');
  });

  it('answers 404 for a number outside the queue', async () => {
    devvit.context.subredditName = 'twin_shadowss_dev';
    for (const number of ['0', String(QUEUE.length + 1), '1.5', 'abc']) {
      expect((await get(`/debug/puzzle/${number}`)).status).toBe(404);
    }
  });

  it('answers 404 in an ordinary subreddit', async () => {
    expect((await get('/debug/puzzle/1')).status).toBe(404);
  });
});

describe('the server`s queue', () => {
  it('loads every generated puzzle in order', () => {
    expect(QUEUE.length).toBeGreaterThan(0);
    expect(QUEUE.map((puzzle) => puzzle.number)).toEqual(QUEUE.map((_, index) => index + 1));
    expect(puzzleByNumber(1)?.number).toBe(1);
    expect(puzzleByNumber(0)).toBeUndefined();
    expect(puzzleByNumber(1)).not.toHaveProperty('parIsOptimal');
  });

  it('splits into tiers that together hold every puzzle', () => {
    const tiers = [puzzlesOfTier(1), puzzlesOfTier(2), puzzlesOfTier(3)];
    expect(tiers.map((tier) => tier.length).reduce((a, b) => a + b, 0)).toBe(QUEUE.length);
    tiers.forEach((tier, index) => {
      expect(tier.length).toBeGreaterThan(0);
      expect(tier.every((puzzle) => puzzle.tier === index + 1)).toBe(true);
      expect(tier[0]).not.toHaveProperty('parIsOptimal');
    });
  });
});

describe('isDevSubreddit', () => {
  it('matches only names ending in _dev', () => {
    expect(isDevSubreddit('twin_shadowss_dev')).toBe(true);
    expect(isDevSubreddit('Some_App_DEV')).toBe(true);
    expect(isDevSubreddit('developers')).toBe(false);
    expect(isDevSubreddit('dev_games')).toBe(false);
    expect(isDevSubreddit(undefined)).toBe(false);
  });
});
