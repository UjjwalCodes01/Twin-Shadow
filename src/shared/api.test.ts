import { describe, expect, it } from 'vitest';
import {
  MAX_BOARD_EDGE,
  isGallerySort,
  parseGalleryResponse,
  parseJoinRequest,
  parseJoinResponse,
  parseOnboardingRequest,
  parseOnboardingResponse,
  parsePuzzle,
  parsePuzzleResponse,
  parseResultResponse,
  parseShareResponse,
  parseSplashResponse,
  parseSubmitRequest,
  parseSubmitResponse,
} from './api';
import { TEST_PUZZLE } from './puzzle';

/** TEST_PUZZLE as plain JSON, with some fields replaced. */
const puzzleWith = (changes: Record<string, unknown>): unknown => ({
  ...structuredClone(TEST_PUZZLE),
  ...changes,
});

describe('parsePuzzle', () => {
  it('accepts TEST_PUZZLE and returns an equal copy', () => {
    const parsed = parsePuzzle(puzzleWith({}));
    expect(parsed).toEqual(TEST_PUZZLE);
    expect(parsed).not.toBe(TEST_PUZZLE);
  });

  it('accepts a board that is not a cube', () => {
    const puzzle = {
      id: 'wide',
      number: 12,
      tier: 2,
      size: { w: 4, d: 2, h: 3 },
      front: ['....', '.##.', '####'],
      side: ['..', '#.', '##'],
      par: 5,
    };
    expect(parsePuzzle(puzzle)).toEqual(puzzle);
  });

  it('rejects a wrong row count', () => {
    expect(parsePuzzle(puzzleWith({ front: ['...', '###'] }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ side: ['...', '#..', '###', '###'] }))).toBeNull();
  });

  it('rejects a wrong row length', () => {
    expect(parsePuzzle(puzzleWith({ front: ['...', '####', '#.#'] }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ side: ['...', '#.', '###'] }))).toBeNull();
  });

  it('rejects an illegal character', () => {
    expect(parsePuzzle(puzzleWith({ front: ['...', '#X#', '#.#'] }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ side: ['...', '#..', '## '] }))).toBeNull();
  });

  it('rejects sizes that are not whole numbers from 1 up to the limit', () => {
    for (const w of [0, -1, 2.5, '3', null, MAX_BOARD_EDGE + 1]) {
      expect(parsePuzzle(puzzleWith({ size: { w, d: 3, h: 3 } }))).toBeNull();
    }
    expect(parsePuzzle(puzzleWith({ size: { w: 3, d: 3 } }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ size: undefined }))).toBeNull();
  });

  it('rejects rows that are not strings, and silhouettes that are not arrays', () => {
    expect(parsePuzzle(puzzleWith({ front: ['...', 7, '#.#'] }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ side: '...#..###' }))).toBeNull();
  });

  it('rejects a missing id or a bad par', () => {
    expect(parsePuzzle(puzzleWith({ id: '' }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ id: 12 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ par: -1 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ par: 'six' }))).toBeNull();
  });

  it('rejects a bad number or tier', () => {
    expect(parsePuzzle(puzzleWith({ number: -1 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ number: 1.5 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ tier: 0 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ tier: 4 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ tier: '1' }))).toBeNull();
  });

  it('drops fields players should not get', () => {
    const parsed = parsePuzzle(puzzleWith({ parIsOptimal: true, seed: ['0,0,0'] }));
    expect(parsed).toEqual(TEST_PUZZLE);
    expect(parsed).not.toHaveProperty('parIsOptimal');
    expect(parsed).not.toHaveProperty('seed');
  });

  it('rejects values that are not objects', () => {
    for (const value of [null, undefined, 'puzzle', 42, [], [TEST_PUZZLE]]) {
      expect(parsePuzzle(value)).toBeNull();
    }
  });
});

describe('parsePuzzleResponse', () => {
  const submission = { blocks: 7, par: 6, stars: 2, sculpture: ['0,0,0'] };
  const response = (changes: Record<string, unknown>): unknown => ({
    puzzle: puzzleWith({}),
    canSubmit: true,
    submission: null,
    debug: false,
    onboarding: { warmup: true, solveHint: false },
    post: 12,
    maker: null,
    yours: false,
    community: { canMake: true, why: null, review: null },
    muted: false,
    ...changes,
  });

  it('accepts a puzzle with no submission yet', () => {
    expect(parsePuzzleResponse(response({}))).toEqual({
      puzzle: TEST_PUZZLE,
      canSubmit: true,
      submission: null,
      debug: false,
      onboarding: { warmup: true, solveHint: false },
      post: 12,
      maker: null,
      yours: false,
      community: { canMake: true, why: null, review: null },
      muted: false,
    });
  });

  it('accepts a community puzzle`s credit, a moderator`s count and a reason for not making one', () => {
    const parsed = parsePuzzleResponse(
      response({ maker: 'ann', yours: true, muted: true, community: { canMake: false, why: 'Not yet.', review: 3 } })
    );
    expect(parsed?.maker).toBe('ann');
    expect(parsed?.yours).toBe(true);
    expect(parsed?.muted).toBe(true);
    expect(parsed?.community).toEqual({ canMake: false, why: 'Not yet.', review: 3 });
  });

  it('rejects a missing or wrong credit, count or sound setting', () => {
    for (const changes of [
      { post: undefined },
      { maker: 7 },
      { yours: 'no' },
      { muted: undefined },
      { community: undefined },
      { community: { canMake: true, why: null } },
      { community: { canMake: true, why: 3, review: null } },
      { community: { canMake: true, why: null, review: -1 } },
    ]) {
      expect(parsePuzzleResponse(response(changes)), JSON.stringify(changes)).toBeNull();
    }
  });

  it('rejects a missing or half-given onboarding state', () => {
    expect(parsePuzzleResponse(response({ onboarding: undefined }))).toBeNull();
    expect(parsePuzzleResponse(response({ onboarding: { warmup: true } }))).toBeNull();
    expect(parsePuzzleResponse(response({ onboarding: { warmup: 'yes', solveHint: false } }))).toBeNull();
  });

  it('accepts a stored submission, keeping only the fields it knows', () => {
    expect(parsePuzzleResponse(response({ submission }))?.submission).toEqual(submission);
    const withExtra = { ...submission, seconds: 31, userId: 't2_someone' };
    expect(parsePuzzleResponse(response({ submission: withExtra }))?.submission).toEqual(submission);
  });

  it('rejects a missing flag, a bad puzzle, a bad submission, or an error body', () => {
    expect(parsePuzzleResponse(response({ debug: undefined }))).toBeNull();
    expect(parsePuzzleResponse(response({ canSubmit: 'yes' }))).toBeNull();
    expect(parsePuzzleResponse(response({ puzzle: puzzleWith({ front: [] }) }))).toBeNull();
    expect(parsePuzzleResponse(response({ submission: { ...submission, stars: 4 } }))).toBeNull();
    expect(parsePuzzleResponse(response({ submission: { ...submission, sculpture: ['x'] } }))).toBeNull();
    expect(parsePuzzleResponse(response({ submission: undefined }))).toBeNull();
    expect(parsePuzzleResponse({ status: 'error', message: 'nope' })).toBeNull();
    expect(parsePuzzleResponse('<html>')).toBeNull();
  });
});

describe('parseSubmitRequest', () => {
  const size = TEST_PUZZLE.size; // 3x3x3: 27 cells

  it('accepts a list of block keys', () => {
    expect(parseSubmitRequest({ blocks: ['0,0,0', '10,2,1'] }, size)).toEqual({ blocks: ['0,0,0', '10,2,1'] });
    expect(parseSubmitRequest({ blocks: [] }, size)).toEqual({ blocks: [] });
  });

  it('keeps only the block list', () => {
    expect(parseSubmitRequest({ blocks: ['0,0,0'], solved: true, stars: 3 }, size)).toEqual({
      blocks: ['0,0,0'],
    });
  });

  it('rejects anything that is not a list of "x,y,z" strings', () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { blocks: '0,0,0' },
      { blocks: [0] },
      { blocks: ['0,0'] },
      { blocks: ['0,0,0,0'] },
      { blocks: ['-1,0,0'] },
      { blocks: ['1.5,0,0'] },
      { blocks: ['01,0,0'] },
      { blocks: [' 0,0,0'] },
      { blocks: ['x,y,z'] },
    ];
    for (const value of bad) expect(parseSubmitRequest(value, size)).toBeNull();
  });

  it('rejects duplicates', () => {
    expect(parseSubmitRequest({ blocks: ['0,0,0', '1,0,0', '0,0,0'] }, size)).toBeNull();
  });

  it('rejects more blocks than the board has cells', () => {
    const cells = Array.from({ length: 28 }, (_, index) => `${index},0,0`);
    expect(parseSubmitRequest({ blocks: cells }, size)).toBeNull();
    expect(parseSubmitRequest({ blocks: cells.slice(0, 27) }, size)).not.toBeNull();
  });
});

describe('parseSubmitResponse', () => {
  const submission = { blocks: 7, par: 6, stars: 2, sculpture: ['0,0,0'] };

  it('accepts both success statuses', () => {
    expect(parseSubmitResponse({ status: 'accepted', submission })).toEqual({ status: 'accepted', submission });
    expect(parseSubmitResponse({ status: 'already-submitted', submission })?.status).toBe('already-submitted');
  });

  it('accepts a rejection with a known reason', () => {
    const rejection = { status: 'rejected', reason: 'logged-out', message: 'Log in to submit.' };
    expect(parseSubmitResponse(rejection)).toEqual(rejection);
  });

  it('rejects unknown statuses, unknown reasons and missing parts', () => {
    expect(parseSubmitResponse({ status: 'ok', submission })).toBeNull();
    expect(parseSubmitResponse({ status: 'accepted' })).toBeNull();
    expect(parseSubmitResponse({ status: 'rejected', reason: 'because', message: '' })).toBeNull();
    expect(parseSubmitResponse({ status: 'rejected', reason: 'malformed' })).toBeNull();
    expect(parseSubmitResponse(null)).toBeNull();
  });
});

describe('parseResultResponse', () => {
  const row = { rank: 1, username: 'ann', blocks: 7, you: false };
  const result = {
    blocks: 9,
    par: 7,
    stars: 2,
    rank: 3,
    tied: 2,
    solvers: 40,
    leaderboard: [row, { ...row, username: 'bea' }],
    own: { rank: 3, username: 'me', blocks: 9, you: true },
    record: { blocks: 7, underPar: false },
    rarity: { same: 4, share: 0.1, smallSample: false },
    streak: { current: 2, best: 5 },
    shared: false,
    joinPrompt: true,
  };
  const ok = (changes: Record<string, unknown>): unknown => ({ status: 'ok', result: { ...result, ...changes } });

  it('accepts a full result, with or without a separate own row', () => {
    expect(parseResultResponse(ok({}))).toEqual({ status: 'ok', result });
    expect(parseResultResponse(ok({ own: null }))).toEqual({ status: 'ok', result: { ...result, own: null } });
    expect(parseResultResponse(ok({ leaderboard: [] }))).not.toBeNull();
  });

  it('accepts the not-yet-submitted answer', () => {
    const refusal = { status: 'not-submitted', message: 'Submit your solution to see the results.' };
    expect(parseResultResponse(refusal)).toEqual(refusal);
  });

  it('keeps only the fields it knows', () => {
    const parsed = parseResultResponse(ok({ leaderboard: [{ ...row, sculpture: '0,0,0', userId: 't2_ann' }] }));
    expect(parsed).toEqual({ status: 'ok', result: { ...result, leaderboard: [row] } });
  });

  it('rejects a result with a bad or missing part', () => {
    const bad: Record<string, unknown>[] = [
      { stars: 4 },
      { rank: 0 },
      { tied: 0 },
      { solvers: 0 },
      { leaderboard: 'ann' },
      { leaderboard: [{ ...row, rank: 0 }] },
      { leaderboard: [{ ...row, username: 7 }] },
      { leaderboard: [{ ...row, you: 'yes' }] },
      { own: undefined },
      { own: { rank: 3 } },
      { record: { blocks: 7 } },
      { rarity: { same: 4, share: 1.5, smallSample: false } },
      { rarity: { same: 4, share: 0.1 } },
      { streak: { current: -1, best: 5 } },
      { streak: undefined },
      { shared: 'yes' },
      { shared: undefined },
      { joinPrompt: 1 },
      { joinPrompt: undefined },
    ];
    for (const changes of bad) expect(parseResultResponse(ok(changes)), JSON.stringify(changes)).toBeNull();
  });

  it('rejects other bodies', () => {
    expect(parseResultResponse({ status: 'ok' })).toBeNull();
    expect(parseResultResponse({ status: 'not-submitted' })).toBeNull();
    expect(parseResultResponse({ status: 'error', message: 'This post has no puzzle.' })).toBeNull();
    expect(parseResultResponse(null)).toBeNull();
  });
});

describe('parseGalleryResponse', () => {
  const entry = { id: 'ab12', blocks: 9, builders: 3, first: 'ann', sculpture: ['0,0,0', '0,1,0'], yours: false };
  const gallery = { sort: 'rarest', page: 1, pages: 3, total: 45, entries: [entry, { ...entry, id: 'cd34', yours: true }] };
  const ok = (changes: Record<string, unknown>): unknown => ({ status: 'ok', gallery: { ...gallery, ...changes } });

  it('accepts a page of sculptures, and an empty one', () => {
    expect(parseGalleryResponse(ok({}))).toEqual({ status: 'ok', gallery });
    expect(parseGalleryResponse(ok({ sort: 'leanest', entries: [] }))).toEqual({
      status: 'ok',
      gallery: { ...gallery, sort: 'leanest', entries: [] },
    });
  });

  it('accepts the not-yet-submitted answer', () => {
    const refusal = { status: 'not-submitted', message: 'Submit your solution to see the results.' };
    expect(parseGalleryResponse(refusal)).toEqual(refusal);
  });

  it('keeps only the fields it knows', () => {
    const parsed = parseGalleryResponse(ok({ entries: [{ ...entry, userId: 't2_ann', submittedAt: 5 }] }));
    expect(parsed).toEqual({ status: 'ok', gallery: { ...gallery, entries: [entry] } });
  });

  it('rejects a gallery with a bad or missing part', () => {
    const bad: Record<string, unknown>[] = [
      { sort: 'prettiest' },
      { page: 0 },
      { pages: 0 },
      { total: -1 },
      { entries: 'none' },
      { entries: [{ ...entry, id: '' }] },
      { entries: [{ ...entry, builders: 0 }] },
      { entries: [{ ...entry, first: 7 }] },
      { entries: [{ ...entry, yours: 'no' }] },
      { entries: [{ ...entry, sculpture: ['0,0'] }] },
      { entries: [{ ...entry, sculpture: '0,0,0' }] },
    ];
    for (const changes of bad) expect(parseGalleryResponse(ok(changes)), JSON.stringify(changes)).toBeNull();
  });

  it('rejects other bodies', () => {
    expect(parseGalleryResponse({ status: 'ok' })).toBeNull();
    expect(parseGalleryResponse({ status: 'error', message: 'This post has no puzzle.' })).toBeNull();
    expect(parseGalleryResponse(null)).toBeNull();
  });

  it('knows the two sort orders', () => {
    expect(isGallerySort('rarest')).toBe(true);
    expect(isGallerySort('leanest')).toBe(true);
    expect(isGallerySort('newest')).toBe(false);
    expect(isGallerySort(undefined)).toBe(false);
  });
});

describe('parseShareResponse', () => {
  it('accepts each answer the server gives', () => {
    expect(parseShareResponse({ status: 'shared' })).toEqual({ status: 'shared' });
    expect(parseShareResponse({ status: 'already-shared', extra: 1 })).toEqual({ status: 'already-shared' });
    const failed = { status: 'failed', message: "Couldn't share your result. Try again." };
    expect(parseShareResponse(failed)).toEqual(failed);
    const refused = { status: 'not-submitted', message: 'Submit your solution to see the results.' };
    expect(parseShareResponse(refused)).toEqual(refused);
  });

  it('rejects other bodies', () => {
    expect(parseShareResponse({ status: 'failed' })).toBeNull();
    expect(parseShareResponse({ status: 'ok' })).toBeNull();
    expect(parseShareResponse(null)).toBeNull();
  });
});

describe('parseJoinRequest and parseJoinResponse', () => {
  it('accepts the two answers a player can give', () => {
    expect(parseJoinRequest({ choice: 'join' })).toEqual({ choice: 'join' });
    expect(parseJoinRequest({ choice: 'dismiss', userId: 't2_someone' })).toEqual({ choice: 'dismiss' });
  });

  it('rejects any other request', () => {
    for (const body of [{ choice: 'maybe' }, { choice: true }, {}, null, 'join']) {
      expect(parseJoinRequest(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('reads the server`s reply', () => {
    expect(parseJoinResponse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(parseJoinResponse({ status: 'failed', message: 'x' })).toEqual({ status: 'failed', message: 'x' });
    expect(parseJoinResponse({ status: 'failed' })).toBeNull();
    expect(parseJoinResponse(undefined)).toBeNull();
  });
});

describe('parseOnboardingRequest and parseOnboardingResponse', () => {
  it('accepts the three things a first-time player can have done', () => {
    for (const event of ['warmup-finished', 'warmup-skipped', 'solve-hint-seen']) {
      expect(parseOnboardingRequest({ event, extra: 1 })).toEqual({ event });
    }
  });

  it('rejects anything else', () => {
    for (const body of [{ event: 'warmup' }, { event: 1 }, {}, null, 'warmup-finished']) {
      expect(parseOnboardingRequest(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('reads the server`s reply', () => {
    expect(parseOnboardingResponse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(parseOnboardingResponse({ status: 'failed', message: 'x' })).toEqual({ status: 'failed', message: 'x' });
    expect(parseOnboardingResponse({ status: 'failed' })).toBeNull();
  });
});

describe('parseSplashResponse', () => {
  const splash = {
    number: 12,
    date: '2026-11-30',
    size: { w: 3, d: 3, h: 3 },
    front: ['...', '###', '#.#'],
    side: ['...', '#..', '###'],
    played: null,
    streak: 2,
    solvers: 40,
    maker: null,
  };

  it('accepts a post not yet played, solved, and seen logged out', () => {
    expect(parseSplashResponse(splash)).toEqual(splash);
    const played = { blocks: 7, par: 6, stars: 2 };
    expect(parseSplashResponse({ ...splash, played })).toEqual({ ...splash, played });
    expect(parseSplashResponse({ ...splash, streak: null })).toEqual({ ...splash, streak: null });
    expect(parseSplashResponse({ ...splash, maker: 'ann' })).toEqual({ ...splash, maker: 'ann' });
    expect(parseSplashResponse({ ...splash, maker: 7 })).toBeNull();
  });

  it('keeps only the fields it knows', () => {
    const extra = { ...splash, par: 6, played: { blocks: 7, par: 6, stars: 2, sculpture: ['0,0,0'] } };
    expect(parseSplashResponse(extra)).toEqual({ ...splash, played: { blocks: 7, par: 6, stars: 2 } });
  });

  it('rejects a bad or missing part', () => {
    const bad: Record<string, unknown>[] = [
      { number: -1 },
      { date: 'today' },
      { size: { w: 3, d: 3 } },
      { front: ['..', '##'] },
      { side: 'none' },
      { played: { blocks: 7, par: 6, stars: 5 } },
      { played: undefined },
      { streak: -1 },
      { streak: undefined },
      { solvers: 'many' },
    ];
    for (const changes of bad) expect(parseSplashResponse({ ...splash, ...changes }), JSON.stringify(changes)).toBeNull();
    expect(parseSplashResponse({ status: 'error', message: 'This post has no puzzle.' })).toBeNull();
    expect(parseSplashResponse(null)).toBeNull();
  });
});
