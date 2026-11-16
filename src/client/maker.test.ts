import { describe, expect, it } from 'vitest';
import { parsePuzzle } from '../shared/api';
import { COMMUNITY_BOARDS, SHAPE_CHECKS, type CommunityBoard } from '../shared/community';
import { boardLabel, checklist, lastPuzzleText, makerBoard, PAR_NOTE, PAR_REFUSED_NOTE } from './maker';

const board = (edge: number): CommunityBoard => {
  const found = COMMUNITY_BOARDS.find((entry) => entry.size.w === edge);
  if (!found) throw new Error(`No ${edge} board`);
  return found;
};
const FOUR = board(4);
const GOOD = new Set(['0,0,3', '1,0,3', '2,0,3', '3,0,3', '0,1,3', '0,2,3', '3,1,3', '0,0,0', '0,0,1', '0,0,2', '0,1,0']);

const met = (list: ReturnType<typeof checklist>): Record<string, boolean> =>
  Object.fromEntries(list.lines.map((line) => [line.check, line.met]));

describe('checklist', () => {
  it('has one line for every rule about the shape, in plain words, and none for par', () => {
    const { lines } = checklist(new Set(), FOUR);
    expect(lines.map((line) => line.check)).toEqual([...SHAPE_CHECKS]);
    expect(lines.map((line) => line.text)).toEqual([
      'No floating blocks',
      'Shadows reach across the walls',
      'Not plain rectangles',
      'Two different shadows',
      'Tall enough',
    ]);
  });

  it('says under the lines that the number of blocks to solve is checked when the puzzle is sent', () => {
    expect(checklist(new Set(), FOUR).note).toBe('The number of blocks to solve is checked when you send it.');
    expect(checklist(GOOD, FOUR).note).toBe(PAR_NOTE);
  });

  it('starts with nothing met on an empty board, and cannot be sent', () => {
    const list = checklist(new Set(), FOUR);
    expect(Object.values(met(list)).every((value) => value === false)).toBe(true);
    expect(list.ready).toBe(false);
  });

  it('ticks lines as they are met, one part at a time', () => {
    // A low row: nothing floats and the shadows differ, but it is flat and not tall enough.
    const partly = checklist(new Set(['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2']), FOUR);
    expect(met(partly)).toEqual({ floating: true, span: true, rectangle: false, different: true, height: false });
    expect(partly.ready).toBe(false);
  });

  it('is ready as soon as every shape line is met: par plays no part', () => {
    const list = checklist(GOOD, FOUR);
    expect(Object.values(met(list)).every((value) => value === true)).toBe(true);
    expect(list.ready).toBe(true);
  });

  it('is ready for a sculpture whose par would be out of range: only the server can say', () => {
    // Five blocks solve this one, fewer than the board allows, but its shape passes every line.
    const slight = new Set(['0,0,0', '0,0,1', '0,0,2', '1,0,2', '2,0,2', '0,1,2', '0,2,2']);
    expect(checklist(slight, FOUR).ready).toBe(true);
  });

  it('says which way the server sent a sculpture back, and can still be sent', () => {
    const low = checklist(GOOD, FOUR, 'par-low');
    expect(low.note).toBe('Sent back: it needs more blocks to solve. Make the shadows bigger.');
    expect(low.note).toBe(PAR_REFUSED_NOTE['par-low']);
    expect(low.ready).toBe(true);
    expect(checklist(GOOD, FOUR, 'par-high').note).toBe(
      'Sent back: it needs fewer blocks to solve. Make the shadows smaller.'
    );
  });

  it('is not ready while a block floats', () => {
    const list = checklist(new Set([...GOOD, '2,3,1']), FOUR);
    expect(met(list).floating).toBe(false);
    expect(list.ready).toBe(false);
  });
});

describe('what became of the last puzzle', () => {
  it('says it is waiting, approved, used on a date, or not picked', () => {
    expect(lastPuzzleText({ status: 'waiting' }, false)).toBe('Your last puzzle is waiting for review.');
    expect(lastPuzzleText({ status: 'approved' }, true)).toBe(
      'Your last puzzle was approved. It is in line for a Sunday.'
    );
    expect(lastPuzzleText({ status: 'used', date: '2026-12-06' }, true)).toBe(
      'Your last puzzle was used on 6 December 2026.'
    );
    expect(lastPuzzleText({ status: 'rejected' }, true)).toBe(
      'Your last puzzle was not picked this time. You can make another.'
    );
  });

  it('does not offer another to a player who may not make one just now', () => {
    expect(lastPuzzleText({ status: 'rejected' }, false)).toBe('Your last puzzle was not picked this time.');
  });

  it('never gives a reason for a puzzle that was not picked', () => {
    expect(lastPuzzleText({ status: 'rejected' }, true)).not.toMatch(/because|reason|rule|too/i);
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
