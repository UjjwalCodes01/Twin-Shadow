import { describe, expect, it } from 'vitest';
import {
  MAX_BOARD_EDGE,
  parsePuzzle,
  parsePuzzleResponse,
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
  const submission = { blocks: 7, par: 6, stars: 2, seconds: 31, sculpture: ['0,0,0'] };
  const response = (changes: Record<string, unknown>): unknown => ({
    puzzle: puzzleWith({}),
    canSubmit: true,
    submission: null,
    debug: false,
    ...changes,
  });

  it('accepts a puzzle with no submission yet', () => {
    expect(parsePuzzleResponse(response({}))).toEqual({
      puzzle: TEST_PUZZLE,
      canSubmit: true,
      submission: null,
      debug: false,
    });
  });

  it('accepts a stored submission, with or without a time', () => {
    expect(parsePuzzleResponse(response({ submission }))?.submission).toEqual(submission);
    const untimed = { ...submission, seconds: null };
    expect(parsePuzzleResponse(response({ submission: untimed }))?.submission).toEqual(untimed);
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
  const submission = { blocks: 7, par: 6, stars: 2, seconds: null, sculpture: ['0,0,0'] };

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
