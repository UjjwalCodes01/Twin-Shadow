import { describe, expect, it, vi } from 'vitest';
import { parsePuzzleResponse } from '../../shared/api';
import { TEST_PUZZLE } from '../../shared/puzzle';
import { isDevSubreddit } from '../core/puzzle';

// The Devvit runtime only exists inside Reddit, so stand in for its context.
const devvit = vi.hoisted(() => ({ context: { subredditName: 'some_game' } }));
vi.mock('@devvit/web/server', () => devvit);

const { api } = await import('./api');

const getToday = async (): Promise<{ status: number; body: unknown }> => {
  const response = await api.request('/puzzle/today');
  const body: unknown = await response.json();
  return { status: response.status, body };
};

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

describe('isDevSubreddit', () => {
  it('matches only names ending in _dev', () => {
    expect(isDevSubreddit('twin_shadowss_dev')).toBe(true);
    expect(isDevSubreddit('Some_App_DEV')).toBe(true);
    expect(isDevSubreddit('developers')).toBe(false);
    expect(isDevSubreddit('dev_games')).toBe(false);
    expect(isDevSubreddit(undefined)).toBe(false);
  });
});
