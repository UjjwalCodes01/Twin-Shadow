import { describe, expect, it } from 'vitest';
import {
  canPlace,
  diffShadow,
  findFloating,
  formatSilhouette,
  isSolved,
  parseSilhouette,
  projectFront,
  projectSide,
} from './logic';
import { TEST_PUZZLE, TEST_SOLUTION, type Puzzle } from './puzzle';

const { size } = TEST_PUZZLE;
const solution = (): Set<string> => new Set(TEST_SOLUTION);

describe('isSolved', () => {
  it('accepts TEST_SOLUTION for TEST_PUZZLE', () => {
    expect(isSolved(solution(), TEST_PUZZLE)).toBe(true);
  });

  it('rejects an empty board', () => {
    expect(isSolved(new Set(), TEST_PUZZLE)).toBe(false);
  });

  it('rejects matching shadows when a block floats', () => {
    // Two blocks touching only at an edge: both shadows match, 1,1,0 floats.
    const puzzle: Puzzle = {
      id: 'floating',
      number: 0,
      tier: 1,
      size: { w: 2, d: 1, h: 2 },
      front: ['.#', '#.'],
      side: ['#', '#'],
      par: 2,
    };
    const blocks = new Set(['0,0,0', '1,1,0']);
    expect(findFloating(blocks)).toEqual(['1,1,0']);
    expect(isSolved(blocks, puzzle)).toBe(false);
  });

  it('rejects a block outside the board', () => {
    const blocks = solution().add('0,0,3');
    expect(isSolved(blocks, TEST_PUZZLE)).toBe(false);
  });
});

describe('findFloating', () => {
  it('reports nothing for the solution', () => {
    expect(findFloating(solution())).toEqual([]);
  });

  it('reports a lone block at 1,1,0', () => {
    expect(findFloating(new Set(['1,1,0']))).toEqual(['1,1,0']);
  });

  it('reports the whole lintel when 0,0,0 is removed from the solution', () => {
    const blocks = solution();
    blocks.delete('0,0,0');
    expect(findFloating(blocks).sort()).toEqual(['0,1,0', '1,1,0', '2,1,0']);
  });
});

describe('shadows', () => {
  it('parses silhouettes with y = 0 at the floor', () => {
    expect(parseSilhouette(TEST_PUZZLE.front)).toEqual([
      [true, false, true],
      [true, true, true],
      [false, false, false],
    ]);
  });

  it('formats a grid back into the rows it was parsed from', () => {
    expect(formatSilhouette(parseSilhouette(TEST_PUZZLE.front))).toEqual(TEST_PUZZLE.front);
    expect(formatSilhouette(projectSide(solution(), size))).toEqual(TEST_PUZZLE.side);
  });

  it('projects the solution onto both targets', () => {
    expect(projectFront(solution(), size)).toEqual(parseSilhouette(TEST_PUZZLE.front));
    expect(projectSide(solution(), size)).toEqual(parseSilhouette(TEST_PUZZLE.side));
  });

  it('marks an extra cell on the front wall when 1,0,0 is added', () => {
    const blocks = solution().add('1,0,0');
    const front = diffShadow(projectFront(blocks, size), parseSilhouette(TEST_PUZZLE.front));
    expect(front[0]).toEqual(['match', 'extra', 'match']);
    expect(front[1]).toEqual(['match', 'match', 'match']);
    expect(front[2]).toEqual(['empty', 'empty', 'empty']);
    // 1,0,0 sits at z = 0, which the side target already wants lit.
    const side = diffShadow(projectSide(blocks, size), parseSilhouette(TEST_PUZZLE.side));
    expect(side.flat()).not.toContain('extra');
    expect(isSolved(blocks, TEST_PUZZLE)).toBe(false);
  });

  it('marks missing cells on an empty board', () => {
    const front = diffShadow(projectFront(new Set(), size), parseSilhouette(TEST_PUZZLE.front));
    expect(front[0]).toEqual(['missing', 'empty', 'missing']);
  });
});

describe('canPlace', () => {
  it('accepts a free cell inside the board', () => {
    expect(canPlace('1,0,0', solution(), size)).toBe(true);
  });

  it('rejects an occupied cell', () => {
    expect(canPlace('0,0,0', solution(), size)).toBe(false);
  });

  it('rejects cells outside the board', () => {
    const empty = new Set<string>();
    for (const key of ['-1,0,0', '3,0,0', '0,-1,0', '0,3,0', '0,0,-1', '0,0,3']) {
      expect(canPlace(key, empty, size)).toBe(false);
    }
  });
});
