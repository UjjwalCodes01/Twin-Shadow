import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJoinResponse, parseResultResponse, parseShareResponse, type Result } from '../../shared/api';
import { canonicalSculpture } from '../../shared/score';
import { KEYS } from '../core/keys';
import { APP_ACCOUNT, type FakePost } from '../testing/fakeDevvit';
import { parSolution, solutionWith } from '../testing/solutions';
import type { Puzzle } from '../../shared/puzzle';

const devvit = await vi.hoisted(async () => {
  const { createFakeDevvit } = await import('../testing/fakeDevvit');
  return createFakeDevvit();
});
vi.mock('@devvit/web/server', () => devvit);

const { api } = await import('./api');
const { createNextPost, loadPost } = await import('../core/posts');

type Opened = { post: FakePost; puzzle: Puzzle; number: number };

// 2026-11-30 is a Monday.
const MONDAY = new Date('2026-11-30T12:00:00Z');

const manualPost = async (): Promise<Opened> => {
  await createNextPost('manual', MONDAY);
  const post = devvit.posts.at(-1);
  const record = post ? await loadPost(post.id) : null;
  if (!post || !record) throw new Error('No post was created');
  return { post, puzzle: record.puzzle, number: record.number };
};

const submitAs = async ({ post }: Opened, name: string, blocks: readonly string[]): Promise<void> => {
  devvit.enterPost(post, `t2_${name}`);
  const response = await api.request('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  expect(response.status).toBe(200);
};

const solveAs = (target: Opened, name: string): Promise<void> =>
  submitAs(target, name, parSolution(target.puzzle.number));

const shareAs = async ({ post }: Opened, name: string | undefined) => {
  devvit.enterPost(post, name === undefined ? undefined : `t2_${name}`);
  const response = await api.request('/share', { method: 'POST' });
  const body: unknown = await response.json();
  return { status: response.status, body, parsed: parseShareResponse(body) };
};

const answerAs = async ({ post }: Opened, name: string | undefined, body: unknown) => {
  devvit.enterPost(post, name === undefined ? undefined : `t2_${name}`);
  const response = await api.request('/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw: unknown = await response.json();
  return { status: response.status, parsed: parseJoinResponse(raw) };
};

const resultFor = async ({ post }: Opened, name: string): Promise<Result> => {
  devvit.enterPost(post, `t2_${name}`);
  const body: unknown = await (await api.request('/result')).json();
  const parsed = parseResultResponse(body);
  if (parsed?.status !== 'ok') throw new Error(`No result for ${name}: ${JSON.stringify(body)}`);
  return parsed.result;
};

beforeEach(() => {
  devvit.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/share', () => {
  it('posts one comment on the post, as the player, with the result in it', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    const { status, parsed } = await shareAs(target, 'ann');
    expect(status).toBe(200);
    expect(parsed).toEqual({ status: 'shared' });
    const { par } = target.puzzle;
    expect(devvit.comments).toEqual([
      {
        id: 't1_comment1',
        postId: target.post.id,
        text: `Twin Shadows #${target.number}: ${par} blocks, par ${par}, 3 stars. Among the first solvers.`,
        authorName: 'ann',
        runAs: 'USER',
      },
    ]);
  });

  it('gives the rarity once there are enough solvers', async () => {
    const target = await manualPost();
    const { puzzle } = target;
    for (const name of ['a1', 'a2', 'a3', 'a4']) await solveAs(target, name);
    await submitAs(target, 'bea', solutionWith(puzzle, puzzle.par + 1));

    await shareAs(target, 'a1');
    await shareAs(target, 'bea');
    expect(devvit.comments.map((comment) => comment.text)).toEqual([
      `Twin Shadows #${target.number}: ${puzzle.par} blocks, par ${puzzle.par}, 3 stars. Same as 80% of solvers.`,
      `Twin Shadows #${target.number}: ${puzzle.par + 1} blocks, par ${puzzle.par}, 2 stars. Nobody else built this sculpture.`,
    ]);
  });

  it('never puts the sculpture, or any block of it, in the comment', async () => {
    const target = await manualPost();
    const blocks = parSolution(target.puzzle.number);
    await submitAs(target, 'ann', blocks);
    await shareAs(target, 'ann');

    const text = devvit.comments[0]?.text ?? '';
    expect(text).not.toContain(canonicalSculpture(blocks));
    for (const block of blocks) expect(text).not.toContain(block);
  });

  it('posts nothing until it is called: submitting and reading the result do not share', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    expect((await resultFor(target, 'ann')).shared).toBe(false);
    expect(devvit.comments).toEqual([]);
  });

  it('shares once per player per post, and says so afterwards', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    expect((await shareAs(target, 'ann')).parsed).toEqual({ status: 'shared' });
    expect((await resultFor(target, 'ann')).shared).toBe(true);
    const again = await shareAs(target, 'ann');
    expect(again.status).toBe(200);
    expect(again.parsed).toEqual({ status: 'already-shared' });
    expect(devvit.comments).toHaveLength(1);
    expect(devvit.hashContents(KEYS.shares(target.post.id))).toEqual({ t2_ann: 't1_comment1' });
  });

  it('posts one comment when several requests arrive at the same moment', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    devvit.enterPost(target.post, 't2_ann');

    const responses = await Promise.all([1, 2, 3, 4].map(() => api.request('/share', { method: 'POST' })));
    const statuses = await Promise.all(
      responses.map(async (response) => parseShareResponse(await response.json())?.status)
    );
    expect(statuses.sort()).toEqual(['already-shared', 'already-shared', 'already-shared', 'shared']);
    expect(devvit.comments).toHaveLength(1);
  });

  it('lets each player share, and the same player share on another post', async () => {
    const first = await manualPost();
    await solveAs(first, 'ann');
    await solveAs(first, 'bea');
    await shareAs(first, 'ann');
    await shareAs(first, 'bea');
    const second = await manualPost();
    await solveAs(second, 'ann');
    expect((await resultFor(second, 'ann')).shared).toBe(false);
    await shareAs(second, 'ann');

    expect(devvit.comments.map(({ postId, authorName }) => [postId, authorName])).toEqual([
      [first.post.id, 'ann'],
      [first.post.id, 'bea'],
      [second.post.id, 'ann'],
    ]);
  });

  it('releases the share when the comment fails, so the player can try again', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    devvit.setCommentsFailing(true);
    const failed = await shareAs(target, 'ann');
    expect(failed.status).toBe(502);
    expect(failed.parsed).toEqual({ status: 'failed', message: "Couldn't share your result. Try again." });
    expect(devvit.comments).toEqual([]);
    expect(devvit.hashContents(KEYS.shares(target.post.id))).toEqual({});
    expect((await resultFor(target, 'ann')).shared).toBe(false);

    devvit.setCommentsFailing(false);
    expect((await shareAs(target, 'ann')).parsed).toEqual({ status: 'shared' });
    expect(devvit.comments).toHaveLength(1);
  });

  it('names the player in the comment when Reddit posts it from the app`s account', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    devvit.setCommentsAsApp(true);

    expect((await shareAs(target, 'ann')).parsed).toEqual({ status: 'shared' });
    const { par } = target.puzzle;
    expect(devvit.comments).toHaveLength(1);
    expect(devvit.comments[0]?.authorName).toBe(APP_ACCOUNT);
    expect(devvit.comments[0]?.text).toBe(
      `u/ann: Twin Shadows #${target.number}: ${par} blocks, par ${par}, 3 stars. Among the first solvers.`
    );
  });

  it('still counts as shared when the comment is posted but naming the player fails', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    devvit.setCommentsAsApp(true);
    devvit.setCommentEditsFailing(true);

    expect((await shareAs(target, 'ann')).parsed).toEqual({ status: 'shared' });
    expect((await shareAs(target, 'ann')).parsed).toEqual({ status: 'already-shared' });
    expect(devvit.comments).toHaveLength(1);
  });

  it('refuses a player who has not submitted, and a logged-out visitor', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    for (const name of ['bea', undefined]) {
      const { status, body } = await shareAs(target, name);
      expect(status).toBe(403);
      expect(body).toEqual({ status: 'not-submitted', message: 'Submit your solution to see the results.' });
    }
    expect(devvit.comments).toEqual([]);
  });

  it('answers 404 outside a post that has a puzzle', async () => {
    devvit.enterPost({ id: 't3_other', title: 'Other', postData: undefined }, 't2_ann');
    const response = await api.request('/share', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(devvit.comments).toEqual([]);
  });
});

describe('POST /api/join', () => {
  it('offers the prompt to a player who has not answered it', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    expect((await resultFor(target, 'ann')).joinPrompt).toBe(true);
    expect(devvit.subscribers()).toEqual([]);
  });

  it('subscribes the player on "join" and never offers the prompt again', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    const { status, parsed } = await answerAs(target, 'ann', { choice: 'join' });
    expect(status).toBe(200);
    expect(parsed).toEqual({ status: 'ok' });
    expect(devvit.subscribers()).toEqual(['ann']);
    expect(devvit.hashContents(KEYS.joinPrompt)).toEqual({ t2_ann: 'joined' });
    expect((await resultFor(target, 'ann')).joinPrompt).toBe(false);

    // Not on a later post either.
    const later = await manualPost();
    await solveAs(later, 'ann');
    expect((await resultFor(later, 'ann')).joinPrompt).toBe(false);
  });

  it('subscribes nobody on "dismiss" and never offers the prompt again', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    expect((await answerAs(target, 'ann', { choice: 'dismiss' })).parsed).toEqual({ status: 'ok' });
    expect(devvit.subscribers()).toEqual([]);
    expect(devvit.hashContents(KEYS.joinPrompt)).toEqual({ t2_ann: 'dismissed' });
    expect((await resultFor(target, 'ann')).joinPrompt).toBe(false);
  });

  it('keeps one player`s answer apart from another`s', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');
    await solveAs(target, 'bea');
    await answerAs(target, 'ann', { choice: 'dismiss' });
    expect((await resultFor(target, 'bea')).joinPrompt).toBe(true);
  });

  it('keeps the prompt when subscribing fails, so the player can try again', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    devvit.setSubscribingFailing(true);
    const failed = await answerAs(target, 'ann', { choice: 'join' });
    expect(failed.status).toBe(502);
    expect(failed.parsed).toEqual({ status: 'failed', message: "Couldn't join. Try again." });
    expect(devvit.hashContents(KEYS.joinPrompt)).toEqual({});
    expect((await resultFor(target, 'ann')).joinPrompt).toBe(true);

    devvit.setSubscribingFailing(false);
    expect((await answerAs(target, 'ann', { choice: 'join' })).parsed).toEqual({ status: 'ok' });
    expect(devvit.subscribers()).toEqual(['ann']);
  });

  it('refuses an answer it cannot read, and a logged-out visitor', async () => {
    const target = await manualPost();
    await solveAs(target, 'ann');

    for (const body of [{ choice: 'maybe' }, {}, null]) {
      expect((await answerAs(target, 'ann', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await answerAs(target, undefined, { choice: 'join' })).status).toBe(401);
    expect(devvit.subscribers()).toEqual([]);
    expect(devvit.hashContents(KEYS.joinPrompt)).toEqual({});
  });
});
