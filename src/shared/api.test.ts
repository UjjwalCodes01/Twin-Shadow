import { describe, expect, it } from 'vitest';
import { MAX_BOARD_EDGE, parsePuzzle, parsePuzzleResponse } from './api';
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
      parIsOptimal: false,
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

  it('rejects a bad number, tier or parIsOptimal', () => {
    expect(parsePuzzle(puzzleWith({ number: -1 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ number: 1.5 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ tier: 0 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ tier: 4 }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ tier: '1' }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ parIsOptimal: 'yes' }))).toBeNull();
    expect(parsePuzzle(puzzleWith({ parIsOptimal: undefined }))).toBeNull();
  });

  it('rejects values that are not objects', () => {
    for (const value of [null, undefined, 'puzzle', 42, [], [TEST_PUZZLE]]) {
      expect(parsePuzzle(value)).toBeNull();
    }
  });
});

describe('parsePuzzleResponse', () => {
  it('accepts a puzzle with a debug flag', () => {
    expect(parsePuzzleResponse({ puzzle: puzzleWith({}), debug: false })).toEqual({
      puzzle: TEST_PUZZLE,
      debug: false,
    });
  });

  it('rejects a missing debug flag, a bad puzzle, or an error body', () => {
    expect(parsePuzzleResponse({ puzzle: puzzleWith({}) })).toBeNull();
    expect(parsePuzzleResponse({ puzzle: puzzleWith({ front: [] }), debug: true })).toBeNull();
    expect(parsePuzzleResponse({ status: 'error', message: 'nope' })).toBeNull();
    expect(parsePuzzleResponse('<html>')).toBeNull();
  });
});
