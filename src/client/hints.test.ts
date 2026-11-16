import { describe, expect, it } from 'vitest';
import { createHints, HINT_IDS, HINT_TEXT, type HintInput } from './hints';

const board = (changes: Partial<HintInput> = {}): HintInput => ({
  blocks: 0,
  extra: false,
  rotated: false,
  solved: false,
  ...changes,
});

describe('the wording', () => {
  it('has a line for every hint', () => {
    for (const id of HINT_IDS) expect(HINT_TEXT[id]).toMatch(/\S/);
    expect(HINT_TEXT.place).toBe('Tap a tile to place a block.');
    expect(HINT_TEXT.solved).toBe('Solved. Fewer blocks earn more stars.');
  });
});

describe('each hint', () => {
  it('"place" shows on an empty board and clears when a block is placed', () => {
    const hints = createHints();
    expect(hints.update(board())).toBe('place');
    expect(hints.update(board())).toBe('place');
    expect(hints.update(board({ blocks: 1 }))).not.toBe('place');
  });

  it('"shadows" shows after the first block and clears on the second', () => {
    const hints = createHints();
    hints.update(board());
    expect(hints.update(board({ blocks: 1 }))).toBe('shadows');
    expect(hints.update(board({ blocks: 1, rotated: true }))).toBe('shadows');
    expect(hints.update(board({ blocks: 2 }))).not.toBe('shadows');
  });

  it('"build" shows after the second block and clears on the third', () => {
    const hints = createHints();
    hints.update(board());
    hints.update(board({ blocks: 1 }));
    expect(hints.update(board({ blocks: 2 }))).toBe('build');
    expect(hints.update(board({ blocks: 3 }))).not.toBe('build');
  });

  it('"extra" shows when shadow falls outside the shape and clears when it is gone', () => {
    const hints = createHints();
    hints.update(board());
    hints.update(board({ blocks: 1 }));
    hints.update(board({ blocks: 2 }));
    // The third block clears "build" and casts a stray shadow.
    expect(hints.update(board({ blocks: 3, extra: true }))).toBe('extra');
    expect(hints.update(board({ blocks: 4, extra: true }))).toBe('extra');
    expect(hints.update(board({ blocks: 3, extra: false }))).not.toBe('extra');
  });

  it('"extra" comes before the next lesson when both are due', () => {
    const hints = createHints();
    hints.update(board());
    hints.update(board({ blocks: 1 }));
    // The second block clears "shadows"; a stray shadow is on the wall.
    expect(hints.update(board({ blocks: 2, extra: true }))).toBe('extra');
    // Once it is dealt with, the lesson it displaced is given.
    expect(hints.update(board({ blocks: 1, extra: false }))).toBe('build');
  });

  it('"turn" shows after several blocks if the board has not been turned, and clears when it is', () => {
    const hints = createHints();
    for (let blocks = 0; blocks <= 3; blocks++) hints.update(board({ blocks }));
    expect(hints.update(board({ blocks: 4 }))).toBe('turn');
    expect(hints.update(board({ blocks: 5 }))).toBe('turn');
    expect(hints.update(board({ blocks: 5, rotated: true }))).toBeNull();
  });

  it('"turn" is never shown to a player who has already turned the board', () => {
    const hints = createHints();
    for (let blocks = 0; blocks <= 6; blocks++) hints.update(board({ blocks, rotated: blocks >= 2 }));
    expect(hints.shown()).not.toContain('turn');
  });

  it('"solved" shows when the sculpture is solved, over any other hint, and stays', () => {
    const hints = createHints();
    hints.update(board());
    expect(hints.update(board({ blocks: 1 }))).toBe('shadows');
    expect(hints.update(board({ blocks: 6, solved: true }))).toBe('solved');
    // It holds the button that ends the warm-up, so nothing takes its place.
    expect(hints.update(board({ blocks: 7, solved: false, extra: true }))).toBe('solved');
    expect(hints.update(board({ blocks: 6, solved: true }))).toBe('solved');
  });
});

describe('the hints together', () => {
  it('show one at a time, in the order of play', () => {
    const hints = createHints();
    const steps: HintInput[] = [
      board(),
      board({ blocks: 1 }),
      board({ blocks: 2 }),
      board({ blocks: 3 }),
      board({ blocks: 4 }),
      board({ blocks: 4, rotated: true }),
      board({ blocks: 6, rotated: true, solved: true }),
    ];
    expect(steps.map((step) => hints.update(step))).toEqual(['place', 'shadows', 'build', null, 'turn', null, 'solved']);
  });

  it('never show the same hint twice, whatever the player does', () => {
    const hints = createHints();
    // Place, clear, place again, make and unmake stray shadow twice, turn, solve, unsolve, solve.
    const steps: HintInput[] = [
      board(),
      board({ blocks: 1 }),
      board({ blocks: 0 }),
      board({ blocks: 1 }),
      board({ blocks: 2, extra: true }),
      board({ blocks: 1 }),
      board({ blocks: 2, extra: true }),
      board({ blocks: 1 }),
      board({ blocks: 0 }),
      board({ blocks: 4 }),
      board({ blocks: 4, rotated: true }),
      board({ blocks: 5 }),
      board({ blocks: 6, rotated: true, solved: true }),
      board({ blocks: 5, rotated: true }),
      board({ blocks: 6, rotated: true, solved: true }),
    ];
    for (const step of steps) hints.update(step);
    const shown = hints.shown();
    expect(new Set(shown).size).toBe(shown.length);
    // An empty board the second time round does not bring "place" back.
    expect(shown.filter((hint) => hint === 'place')).toHaveLength(1);
  });

  it('show nothing once every lesson has been given and the board is not solved', () => {
    const hints = createHints();
    for (let blocks = 0; blocks <= 5; blocks++) hints.update(board({ blocks, rotated: blocks >= 4 }));
    expect(hints.update(board({ blocks: 5, rotated: true }))).toBeNull();
  });
});
