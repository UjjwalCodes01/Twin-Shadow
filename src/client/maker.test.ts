import { describe, expect, it } from 'vitest';
import { parsePuzzle } from '../shared/api';
import { CHECKS, COMMUNITY_BOARDS, type CommunityBoard } from '../shared/community';
import { boardLabel, checklist, estimatePar, makerBoard } from './maker';

const board = (edge: number): CommunityBoard => {
  const found = COMMUNITY_BOARDS.find((entry) => entry.size.w === edge);
  if (!found) throw new Error(`No ${edge} board`);
  return found;
};
const FOUR = board(4);
const GOOD = new Set(['0,0,3', '1,0,3', '2,0,3', '3,0,3', '0,1,3', '0,2,3', '3,1,3', '0,0,0', '0,0,1', '0,0,2', '0,1,0']);

const met = (list: ReturnType<typeof checklist>): Record<string, boolean | null> =>
  Object.fromEntries(list.lines.map((line) => [line.check, line.met]));

describe('checklist', () => {
  it('has one line for every rule, in plain words', () => {
    const { lines } = checklist(new Set(), FOUR, null);
    expect(lines.map((line) => line.check)).toEqual([...CHECKS]);
    expect(lines.map((line) => line.text)).toEqual([
      'No floating blocks',
      'Shadows reach across the walls',
      'Not plain rectangles',
      'Two different shadows',
      'Tall enough',
      'Right number of blocks to solve',
    ]);
  });

  it('starts with nothing met on an empty board, and cannot be sent', () => {
    const list = checklist(new Set(), FOUR, null);
    expect(Object.values(met(list)).every((value) => value === false)).toBe(true);
    expect(list.ready).toBe(false);
  });

  it('ticks lines as they are met, one part at a time', () => {
    // A low row: nothing floats and the shadows differ, but it is flat and not tall enough.
    const partly = checklist(new Set(['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2']), FOUR, 4);
    expect(met(partly)).toEqual({ floating: true, span: true, rectangle: false, different: true, height: false, par: false });
    expect(partly.ready).toBe(false);
  });

  it('is ready when every line is met', () => {
    const list = checklist(GOOD, FOUR, 7);
    expect(Object.values(met(list)).every((value) => value === true)).toBe(true);
    expect(list.ready).toBe(true);
  });

  it('shows the last line as still being worked out until par is known, and is not ready', () => {
    const list = checklist(GOOD, FOUR, null);
    expect(met(list).par).toBeNull();
    expect(list.ready).toBe(false);
  });

  it('does not tick the last line for too few or too many blocks', () => {
    expect(met(checklist(GOOD, FOUR, FOUR.minPar - 1)).par).toBe(false);
    expect(met(checklist(GOOD, FOUR, FOUR.maxPar + 1)).par).toBe(false);
    expect(met(checklist(GOOD, FOUR, FOUR.maxPar)).par).toBe(true);
  });

  it('cannot tick the last line while a block floats, whatever par is said to be', () => {
    const floating = new Set([...GOOD, '2,3,1']);
    const list = checklist(floating, FOUR, 7);
    expect(met(list).floating).toBe(false);
    expect(met(list).par).toBe(false);
    expect(list.ready).toBe(false);
  });
});

describe('estimatePar', () => {
  it('gives a number of blocks for a sculpture with nothing floating', () => {
    const par = estimatePar(GOOD, FOUR);
    expect(par).not.toBeNull();
    expect(par).toBeLessThanOrEqual(GOOD.size);
    expect(par).toBeGreaterThanOrEqual(FOUR.minPar);
  });

  it('gives nothing for an empty board or one with a block floating', () => {
    expect(estimatePar(new Set(), FOUR)).toBeNull();
    expect(estimatePar(new Set([...GOOD, '2,3,1']), FOUR)).toBeNull();
  });

  it('still answers when it is given no time at all', () => {
    let clock = 0;
    const par = estimatePar(GOOD, FOUR, () => (clock += 1000));
    expect(par).toBeLessThanOrEqual(GOOD.size);
  });
});

describe('the board a puzzle is made on', () => {
  it('is a valid, empty puzzle of the size chosen', () => {
    for (const entry of COMMUNITY_BOARDS) {
      const puzzle = makerBoard(entry);
      expect(parsePuzzle(puzzle)).toEqual(puzzle);
      expect(puzzle.size).toEqual(entry.size);
      expect(puzzle.front.join('') + puzzle.side.join('')).toMatch(/^\.+$/);
    }
  });

  it('is named by its three sides', () => {
    expect(boardLabel({ w: 5, d: 5, h: 5 })).toBe('5 × 5 × 5');
    expect(boardLabel({ w: 4, d: 4, h: 4 })).toBe('4 × 4 × 4');
  });
});
