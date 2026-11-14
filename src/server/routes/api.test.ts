import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseDebugPuzzleResponse,
  parsePuzzleResponse,
  parseSubmitResponse,
  type SubmitResponse,
} from '../../shared/api';
import { findFloating, parseSilhouette, projectFront, projectSide, toKey } from '../../shared/logic';
import { canonicalSculpture } from '../../shared/score';
import { isDevSubreddit } from '../core/dev';
import { KEYS } from '../core/keys';
import { QUEUE, puzzleByNumber } from '../core/queue';

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

/** A known solution for a queue puzzle, from the generator's own records. */
const parSolution = (number: number): string[] => {
  const all: unknown = JSON.parse(readFileSync('src/generator/data/solutions.json', 'utf8'));
  if (!Array.isArray(all)) throw new Error('solutions.json is not an array');
  const entry: unknown = all[number - 1];
  if (typeof entry !== 'object' || entry === null || !('parSolution' in entry)) {
    throw new Error(`No solution for puzzle ${number}`);
  }
  const { parSolution: blocks } = entry;
  if (!Array.isArray(blocks) || !blocks.every((key) => typeof key === 'string')) {
    throw new Error(`Bad solution for puzzle ${number}`);
  }
  return blocks;
};

/**
 * A queue puzzle and a sculpture for it that casts both target shadows but has
 * exactly one floating block.
 */
const floatingVariant = (): { number: number; blocks: string[] } => {
  for (const puzzle of QUEUE) {
    const solution = parSolution(puzzle.number);
    const used = new Set(solution);
    const front = parseSilhouette(puzzle.front);
    const side = parseSilhouette(puzzle.side);
    for (let y = 1; y < puzzle.size.h; y++) {
      for (let x = 0; x < puzzle.size.w; x++) {
        for (let z = 0; z < puzzle.size.d; z++) {
          const key = toKey(x, y, z);
          if (used.has(key) || !front[y]?.[x] || !side[y]?.[z]) continue;
          const candidate = [...solution, key];
          const floating = findFloating(new Set(candidate));
          if (floating.length === 1 && floating[0] === key) return { number: puzzle.number, blocks: candidate };
        }
      }
    }
  }
  throw new Error('No puzzle in the queue has room for a shadow-neutral floating block');
};

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

/** Creates the next post and puts the request context inside it. */
const openNewPost = async (userId: string | undefined) => {
  const created = await createNextPost();
  const post = devvit.posts.at(-1);
  if (!post) throw new Error('No post was created');
  devvit.enterPost(post, userId);
  return created;
};

const submissionsStored = (postId: string): Record<string, string> =>
  devvit.hashContents(KEYS.submissions(postId));

beforeEach(() => devvit.reset());

describe('GET /api/puzzle', () => {
  it('returns the puzzle tied to the post, passing the client`s validation', async () => {
    await createNextPost();
    await openNewPost(ALICE); // the second post, so puzzle 2
    const { status, body } = await get('/puzzle');
    expect(status).toBe(200);
    const parsed = parsePuzzleResponse(body);
    expect(parsed?.puzzle).toEqual(puzzleByNumber(2));
    expect(parsed?.canSubmit).toBe(true);
    expect(parsed?.submission).toBeNull();
  });

  it('never sends parIsOptimal', async () => {
    await openNewPost(ALICE);
    const { body } = await get('/puzzle');
    expect(JSON.stringify(body)).not.toContain('parIsOptimal');
  });

  it('finds the puzzle from Redis when the post data is missing', async () => {
    await openNewPost(ALICE);
    devvit.context.postData = undefined;
    expect(parsePuzzleResponse((await get('/puzzle')).body)?.puzzle.number).toBe(1);
  });

  it('answers 404 for a post with no puzzle, and outside any post', async () => {
    devvit.context.postId = 't3_stranger';
    expect((await get('/puzzle')).status).toBe(404);
    devvit.context.postId = undefined;
    expect((await get('/puzzle')).status).toBe(404);
  });

  it('lets a logged-out player load the puzzle but marks submitting as off', async () => {
    const { postId } = await openNewPost(undefined);
    const parsed = parsePuzzleResponse((await get('/puzzle')).body);
    expect(parsed?.puzzle.number).toBe(1);
    expect(parsed?.canSubmit).toBe(false);
    expect(devvit.hashContents(KEYS.firstLoads(postId))).toEqual({});
  });

  it('records the first load time once per player', async () => {
    const { postId } = await openNewPost(ALICE);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      await get('/puzzle');
      vi.setSystemTime(2_000_000);
      await get('/puzzle');
    } finally {
      vi.useRealTimers();
    }
    expect(devvit.hashContents(KEYS.firstLoads(postId))).toEqual({ [ALICE]: '1000000' });
  });

  it('returns the stored submission to a returning player, and not to anyone else', async () => {
    await openNewPost(ALICE);
    await get('/puzzle');
    const blocks = parSolution(1);
    await submit({ blocks });

    const again = parsePuzzleResponse((await get('/puzzle')).body);
    expect(again?.submission?.blocks).toBe(blocks.length);
    expect(again?.submission?.stars).toBe(3);
    expect(canonicalSculpture(again?.submission?.sculpture ?? [])).toBe(canonicalSculpture(blocks));

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

describe('POST /api/submit', () => {
  it('stores a valid submission with everything the record needs', async () => {
    const { postId } = await openNewPost(ALICE);
    const blocks = parSolution(1);
    vi.useFakeTimers();
    let result;
    try {
      vi.setSystemTime(5_000_000);
      await get('/puzzle'); // first load
      vi.setSystemTime(5_042_400); // 42.4 seconds later
      result = await submit({ blocks: [...blocks].reverse() });
    } finally {
      vi.useRealTimers();
    }

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'accepted',
      submission: { blocks: blocks.length, par: QUEUE[0]?.par, stars: 3, seconds: 42 },
    });
    const stored: unknown = JSON.parse(submissionsStored(postId)[ALICE] ?? 'null');
    expect(stored).toEqual({
      userId: ALICE,
      postId,
      puzzleNumber: 1,
      blocks: blocks.length,
      // Canonical: the same string whatever order the blocks arrived in.
      sculpture: canonicalSculpture(blocks),
      submittedAt: 5_042_400,
      seconds: 42,
    });
  });

  it('returns the first result for a second attempt and stores nothing new', async () => {
    const { postId } = await openNewPost(ALICE);
    const par = parSolution(1);
    await submit({ blocks: par });
    const before = submissionsStored(postId);

    // A different, bigger valid solve: the par solution plus one covered block
    // is not guaranteed valid, so resubmit the same blocks and an invalid set.
    const second = await submit({ blocks: par });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'already-submitted', submission: { blocks: par.length } });
    const third = await submit({ blocks: ['0,0,0'] });
    expect(third.body).toMatchObject({ status: 'already-submitted', submission: { blocks: par.length } });

    expect(submissionsStored(postId)).toEqual(before);
    expect(Object.keys(submissionsStored(postId))).toEqual([ALICE]);
  });

  it('lets only one of two simultaneous submissions through', async () => {
    const { postId } = await openNewPost(ALICE);
    const blocks = parSolution(1);
    const [a, b] = await Promise.all([submit({ blocks }), submit({ blocks })]);
    const statuses = [a.body.status, b.body.status].sort();
    expect(statuses).toEqual(['accepted', 'already-submitted']);
    expect(Object.keys(submissionsStored(postId))).toEqual([ALICE]);
  });

  it('keeps each player`s submission separate', async () => {
    const { postId } = await openNewPost(ALICE);
    await submit({ blocks: parSolution(1) });
    devvit.context.userId = BOB;
    expect((await submit({ blocks: parSolution(1) })).body.status).toBe('accepted');
    expect(Object.keys(submissionsStored(postId)).sort()).toEqual([ALICE, BOB]);
  });

  it('checks against the post`s own puzzle, not the latest one', async () => {
    const first = await openNewPost(ALICE);
    const firstPost = devvit.posts.at(-1);
    await openNewPost(ALICE); // now inside post 2
    // Puzzle 1's solution does not solve puzzle 2.
    expect((await submit({ blocks: parSolution(1) })).body).toMatchObject({ reason: 'not-solved' });
    if (!firstPost) throw new Error('No first post');
    devvit.enterPost(firstPost, ALICE);
    expect((await submit({ blocks: parSolution(1) })).body.status).toBe('accepted');
    expect(Object.keys(submissionsStored(first.postId))).toEqual([ALICE]);
  });

  const rejected = async (payload: unknown, reason: string, status: number): Promise<void> => {
    const { postId } = await openNewPost(ALICE);
    const result = await submit(payload);
    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ status: 'rejected', reason });
    expect(submissionsStored(postId)).toEqual({});
  };

  it('rejects an unsolved sculpture', async () => {
    await rejected({ blocks: parSolution(1).slice(1) }, 'not-solved', 422);
    devvit.reset();
    await rejected({ blocks: [] }, 'not-solved', 422);
  });

  it('rejects a sculpture whose shadows match but which has a floating block', async () => {
    // Take a real solution and add a block that changes neither shadow and
    // touches nothing: the only thing wrong with it is that it floats.
    const { number, blocks } = floatingVariant();
    for (let created = 0; created < number - 1; created++) await createNextPost();
    const { postId } = await openNewPost(ALICE);
    const puzzle = puzzleByNumber(number);
    if (!puzzle) throw new Error(`No puzzle ${number}`);
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
    await rejected({ blocks: [...parSolution(1), '0,0,99'] }, 'not-solved', 422);
  });

  it('rejects duplicate blocks', async () => {
    const blocks = parSolution(1);
    await rejected({ blocks: [...blocks, blocks[0]] }, 'malformed', 400);
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
    for (const payload of payloads) {
      devvit.reset();
      await rejected(payload, 'malformed', 400);
    }
  });

  it('ignores any solved flag or block count the client sends', async () => {
    await rejected({ blocks: ['0,0,0'], solved: true, blockCount: 3, stars: 3 }, 'not-solved', 422);
  });

  it('refuses a logged-out submission', async () => {
    const { postId } = await openNewPost(undefined);
    const result = await submit({ blocks: parSolution(1) });
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
