import { describe, expect, it } from 'vitest';
import {
  boardFor,
  castShadows,
  CHECK_REFUSAL,
  CHECK_TEXT,
  COMMUNITY_BOARDS,
  firstShapeFailure,
  parInRange,
  parRefusal,
  parRefusalText,
  puzzleKey,
  SHAPE_CHECKS,
  shapeChecks,
  workOutPar,
  type CommunityBoard,
} from './community';
import { findFloating, isSolved } from './logic';
import { COMMUNITY_WEEKDAY, isCommunityDay } from './puzzle';

const board = (edge: 4 | 5): CommunityBoard => {
  const found = COMMUNITY_BOARDS.find((entry) => entry.size.w === edge);
  if (!found) throw new Error(`No ${edge} board`);
  return found;
};
const FOUR = board(4);
const FIVE = board(5);

/**
 * A 4x4x4 sculpture that passes every shape check: a wall across the back
 * row, a tower at one end and a step at the other.
 */
const GOOD = ['0,0,3', '1,0,3', '2,0,3', '3,0,3', '0,1,3', '0,2,3', '3,1,3', '0,0,0', '0,0,1', '0,0,2', '0,1,0'];
const set = (blocks: readonly string[]): Set<string> => new Set(blocks);

describe('the boards', () => {
  it('are 4x4x4 and 5x5x5', () => {
    expect(COMMUNITY_BOARDS.map(({ size }) => `${size.w}x${size.d}x${size.h}`)).toEqual(['4x4x4', '5x5x5']);
    expect(boardFor({ w: 5, d: 5, h: 5 })).toBe(FIVE);
    expect(boardFor({ w: 5, d: 5, h: 4 })).toBeNull();
    expect(boardFor({ w: 3, d: 3, h: 3 })).toBeNull();
  });
});

describe('the wording', () => {
  it('has a checklist line and a refusal for every check', () => {
    for (const check of SHAPE_CHECKS) {
      expect(CHECK_TEXT[check]).toMatch(/\S/);
      expect(CHECK_REFUSAL[check]).toMatch(/\S/);
    }
  });
});

describe('shapeChecks', () => {
  it('passes a sculpture that meets them all', () => {
    expect(shapeChecks(set(GOOD), FOUR)).toEqual({
      floating: true,
      span: true,
      rectangle: true,
      different: true,
      height: true,
    });
    expect(firstShapeFailure(set(GOOD), FOUR)).toBeNull();
  });

  it('passes nothing that matters on an empty board', () => {
    const empty = shapeChecks(set([]), FOUR);
    expect(empty.floating).toBe(false);
    expect(empty.span).toBe(false);
    expect(empty.height).toBe(false);
  });

  it('floating: fails a block with nothing under it, passes when it is supported', () => {
    const floating = [...GOOD, '2,3,1'];
    expect(findFloating(set(floating))).toEqual(['2,3,1']);
    expect(shapeChecks(set(floating), FOUR).floating).toBe(false);
    expect(firstShapeFailure(set(floating), FOUR)).toBe('floating');
    expect(shapeChecks(set(GOOD), FOUR).floating).toBe(true);
  });

  it('span: fails a shadow that leaves two columns of its wall empty, passes one that leaves one', () => {
    // Front shadow two columns wide on a wall of four.
    const narrow = ['0,0,0', '1,0,0', '0,1,0', '0,0,1', '0,0,2', '0,0,3', '0,2,0'];
    expect(shapeChecks(set(narrow), FOUR).span).toBe(false);
    // Three columns of four is enough.
    const wider = [...narrow, '2,0,0'];
    expect(shapeChecks(set(wider), FOUR).span).toBe(true);
  });

  it('rectangle: fails when either shadow is a plain rectangle, passes when both have shape', () => {
    // A flat slab: both shadows are one full row.
    const slab = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2', '0,0,3'];
    expect(shapeChecks(set(slab), FOUR).rectangle).toBe(false);
    // An L on the front, but a second full row along the side: the side is a plain 4 by 2.
    const oneRectangle = [...slab, '0,1,0', '0,1,1', '0,1,2', '0,1,3'];
    expect(castShadows(set(oneRectangle), FOUR.size).sideRows).toEqual(['....', '....', '####', '####']);
    expect(shapeChecks(set(oneRectangle), FOUR).rectangle).toBe(false);
    expect(shapeChecks(set(GOOD), FOUR).rectangle).toBe(true);
  });

  it('different: fails two identical shadows, passes two that differ', () => {
    // The same L along x and along z.
    const twins = ['0,0,0', '1,0,0', '2,0,0', '3,0,0', '0,0,1', '0,0,2', '0,0,3', '0,1,0', '0,2,0'];
    const shadows = castShadows(set(twins), FOUR.size);
    expect(shadows.frontRows).toEqual(shadows.sideRows);
    expect(shapeChecks(set(twins), FOUR).different).toBe(false);
    expect(shapeChecks(set(GOOD), FOUR).different).toBe(true);
  });

  it('height: fails a sculpture below the board`s minimum row, passes one that reaches it', () => {
    const low = ['0,0,0', '1,0,0', '2,0,0', '0,0,1', '0,0,2', '0,1,0'];
    expect(shapeChecks(set(low), FOUR).height).toBe(false);
    expect(shapeChecks(set([...low, '0,2,0']), FOUR).height).toBe(true);
    // The 5x5x5 board asks for one row more.
    expect(shapeChecks(set([...low, '0,2,0']), FIVE).height).toBe(false);
    expect(shapeChecks(set([...low, '0,2,0', '0,3,0']), FIVE).height).toBe(true);
  });
});

describe('workOutPar and parInRange', () => {
  it('finds a solution no larger than the sculpture, that casts the same shadows', () => {
    const { par, solution, lowerBound } = workOutPar(GOOD, FOUR.size);
    expect(par).toBe(solution.length);
    expect(par).toBeLessThanOrEqual(GOOD.length);
    expect(par).toBeGreaterThanOrEqual(lowerBound);
    const { frontRows, sideRows } = castShadows(set(GOOD), FOUR.size);
    const puzzle = { id: 'x', number: 0, tier: 1 as const, size: FOUR.size, front: frontRows, side: sideRows, par };
    expect(isSolved(set(solution), puzzle)).toBe(true);
  });

  it('gives the same answer every time for the same sculpture', () => {
    expect(workOutPar(GOOD, FOUR.size)).toEqual(workOutPar([...GOOD].reverse(), FOUR.size));
  });

  it('still answers when its time is already up', () => {
    const { par, solution } = workOutPar(GOOD, FOUR.size, { until: 0, now: () => 1 });
    expect(par).toBe(solution.length);
    expect(par).toBeLessThanOrEqual(GOOD.length);
    expect(findFloating(set(solution))).toEqual([]);
  });

  it('par: fails too few or too many blocks to solve, passes the range between', () => {
    expect(parInRange(FOUR.minPar - 1, FOUR)).toBe(false);
    expect(parInRange(FOUR.minPar, FOUR)).toBe(true);
    expect(parInRange(FOUR.maxPar, FOUR)).toBe(true);
    expect(parInRange(FOUR.maxPar + 1, FOUR)).toBe(false);
    // The good sculpture's par is in range for its board.
    expect(parInRange(workOutPar(GOOD, FOUR.size).par, FOUR)).toBe(true);
  });

  it('par: says which way it is out, in words a maker can act on', () => {
    expect(parRefusal(FOUR.minPar - 1, FOUR)).toBe('par-low');
    expect(parRefusal(FOUR.minPar, FOUR)).toBeNull();
    expect(parRefusal(FOUR.maxPar, FOUR)).toBeNull();
    expect(parRefusal(FOUR.maxPar + 1, FOUR)).toBe('par-high');
    expect(parRefusalText('par-low', 5, FOUR)).toBe(
      'It needs more blocks to solve. It can be solved with 5, and a puzzle on this board must take at least 6. Make the shadows bigger and send it again.'
    );
    expect(parRefusalText('par-high', 13, FOUR)).toBe(
      'It needs fewer blocks to solve. It takes 13, and a puzzle on this board may take at most 10. Make the shadows smaller and send it again.'
    );
  });
});

describe('puzzleKey', () => {
  const { frontRows, sideRows } = castShadows(set(GOOD), FOUR.size);
  const mirror = (rows: string[]): string[] => rows.map((row) => [...row].reverse().join(''));

  it('is the same for a puzzle mirrored or with its shadows swapped', () => {
    const key = puzzleKey(frontRows, sideRows);
    expect(puzzleKey(sideRows, frontRows)).toBe(key);
    expect(puzzleKey(mirror(frontRows), sideRows)).toBe(key);
    expect(puzzleKey(frontRows, mirror(sideRows))).toBe(key);
    expect(puzzleKey(mirror(sideRows), mirror(frontRows))).toBe(key);
  });

  it('differs for a different puzzle', () => {
    const other = castShadows(set([...GOOD, '2,1,3']), FOUR.size);
    expect(puzzleKey(other.frontRows, other.sideRows)).not.toBe(puzzleKey(frontRows, sideRows));
  });
});

describe('the community day', () => {
  it('is Sunday, counted in UTC', () => {
    expect(COMMUNITY_WEEKDAY).toBe(6);
    expect(isCommunityDay(new Date('2026-12-06T05:00:00Z'))).toBe(true);
    expect(isCommunityDay(new Date('2026-12-05T23:59:59Z'))).toBe(false);
    expect(isCommunityDay(new Date('2026-12-07T00:00:00Z'))).toBe(false);
  });
});
