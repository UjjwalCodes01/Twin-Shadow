import { describe, expect, it, vi } from 'vitest';
import { parseDebugPuzzleResponse, parsePuzzleResponse } from '../../shared/api';
import { TEST_PUZZLE } from '../../shared/puzzle';
import { isDevSubreddit } from '../core/puzzle';
import { QUEUE, puzzleByNumber } from '../core/queue';

// The Devvit runtime only exists inside Reddit, so stand in for its context.
const devvit = vi.hoisted(() => ({ context: { subredditName: 'some_game' } }));
vi.mock('@devvit/web/server', () => devvit);

const { api } = await import('./api');

const get = async (path: string): Promise<{ status: number; body: unknown }> => {
  const response = await api.request(path);
  const body: unknown = await response.json();
  return { status: response.status, body };
};
const getToday = () => get('/puzzle/today');

describe('GET /api/puzzle/today', () => {
  it('returns a puzzle that passes the validation the client uses', async () => {
    const { status, body } = await getToday();
    expect(status).toBe(200);
    const parsed = parsePuzzleResponse(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.puzzle).toEqual(TEST_PUZZLE);
  });

  it('keeps debug off in an ordinary subreddit', async () => {
    devvit.context.subredditName = 'some_game';
    expect(parsePuzzleResponse((await getToday()).body)?.debug).toBe(false);
  });

  it('turns debug on in a playtest subreddit', async () => {
    devvit.context.subredditName = 'twin_shadowss_dev';
    expect(parsePuzzleResponse((await getToday()).body)?.debug).toBe(true);
  });
});

describe('GET /api/debug/puzzle/:number', () => {
  it('returns the numbered puzzle in a playtest subreddit', async () => {
    devvit.context.subredditName = 'twin_shadowss_dev';
    const { status, body } = await get('/debug/puzzle/3');
    expect(status).toBe(200);
    const parsed = parseDebugPuzzleResponse(body);
    expect(parsed?.puzzle.number).toBe(3);
    expect(parsed?.puzzle).toEqual(QUEUE[2]);
    expect(parsed?.count).toBe(QUEUE.length);
  });

  it('answers 404 for a number outside the queue', async () => {
    devvit.context.subredditName = 'twin_shadowss_dev';
    for (const number of ['0', String(QUEUE.length + 1), '1.5', 'abc']) {
      expect((await get(`/debug/puzzle/${number}`)).status).toBe(404);
    }
  });

  it('answers 404 in an ordinary subreddit', async () => {
    devvit.context.subredditName = 'some_game';
    expect((await get('/debug/puzzle/1')).status).toBe(404);
  });
});

describe('the server`s queue', () => {
  it('loads every generated puzzle in order', () => {
    expect(QUEUE.length).toBeGreaterThan(0);
    expect(QUEUE.map((puzzle) => puzzle.number)).toEqual(QUEUE.map((_, index) => index + 1));
    expect(puzzleByNumber(1)).toBe(QUEUE[0]);
    expect(puzzleByNumber(0)).toBeUndefined();
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
