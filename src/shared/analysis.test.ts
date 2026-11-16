import { describe, expect, it } from 'vitest';
import { parseSilhouette } from './logic';
import { TEST_PUZZLE } from './puzzle';
import {
  canonicalKey,
  columnCounts,
  columnSpan,
  countLit,
  countOverhangs,
  hasFlatColumns,
  isSolidRectangle,
  lowerBound,
  peakRow,
} from './analysis';

const grid = (...rows: string[]) => parseSilhouette(rows);

describe('lowerBound', () => {
  it('is 6 for the test puzzle, row by row', () => {
    // Floor row: front 2, side 3 -> 3. Middle row: front 3, side 1 -> 3.
    const front = parseSilhouette(TEST_PUZZLE.front);
    const side = parseSilhouette(TEST_PUZZLE.side);
    expect(lowerBound(front, side)).toBe(6);
  });

  it('takes the busier wall in each row', () => {
    expect(lowerBound(grid('#...', '####'), grid('##..', '#...'))).toBe(2 + 4);
  });

  it('is the same with front and side swapped', () => {
    const a = grid('.#.', '###');
    const b = grid('#..', '##.');
    expect(lowerBound(a, b)).toBe(lowerBound(b, a));
  });

  it('is 0 for two empty walls', () => {
    expect(lowerBound(grid('..', '..'), grid('..', '..'))).toBe(0);
  });
});

describe('countOverhangs', () => {
  it('finds none in a skyline', () => {
    expect(countOverhangs(grid('#...', '##.#', '####'))).toBe(0);
  });

  it('counts a lit cell above an empty one', () => {
    // The lintel of an arch: the middle cell hangs over a gap.
    expect(countOverhangs(grid('###', '#.#'))).toBe(1);
  });

  it('counts every lit cell above a gap, however far below the gap is', () => {
    // Left column: two lit cells above an empty floor cell.
    expect(countOverhangs(grid('#.', '#.', '.#'))).toBe(2);
  });

  it('counts a cell floating above an otherwise empty column', () => {
    expect(countOverhangs(grid('.#.', '...', '#.#'))).toBe(1);
  });
});

describe('shape checks', () => {
  it('counts lit cells per column and in total', () => {
    const shape = grid('#..', '##.', '###');
    expect(columnCounts(shape)).toEqual([3, 2, 1]);
    expect(countLit(shape)).toBe(6);
  });

  it('measures the span from the first lit column to the last', () => {
    expect(columnSpan(grid('....', '.##.'))).toBe(2);
    expect(columnSpan(grid('#..#', '#..#'))).toBe(4);
    expect(columnSpan(grid('....', '....'))).toBe(0);
  });

  it('finds the highest lit row, counting the floor as row 1', () => {
    expect(peakRow(grid('....', '....', '#...', '####'))).toBe(2);
    expect(peakRow(grid('.#..', '....', '....', '####'))).toBe(4);
    expect(peakRow(grid('....', '....'))).toBe(0);
  });

  it('spots a solid rectangle at any size and position', () => {
    expect(isSolidRectangle(grid('####', '####'))).toBe(true);
    expect(isSolidRectangle(grid('....', '.##.', '.##.'))).toBe(true);
    expect(isSolidRectangle(grid('.##.', '.##.', '....'))).toBe(true);
    expect(isSolidRectangle(grid('.#..', '.##.'))).toBe(false);
    expect(isSolidRectangle(grid('#.#', '###'))).toBe(false);
    expect(isSolidRectangle(grid('...', '...'))).toBe(false);
  });

  it('spots columns that all hold the same number of lit cells', () => {
    expect(hasFlatColumns(grid('....', '.##.', '.##.'))).toBe(true);
    expect(hasFlatColumns(grid('#..', '##.', '###'))).toBe(false);
    // An arch has a flat top but uneven columns, so it is kept.
    expect(hasFlatColumns(grid('###', '#.#'))).toBe(false);
  });
});

describe('canonicalKey', () => {
  const front = ['#..', '##.'];
  const side = ['.#.', '###'];

  it('is the same with front and side swapped', () => {
    expect(canonicalKey(side, front)).toBe(canonicalKey(front, side));
  });

  it('is the same with either silhouette mirrored', () => {
    expect(canonicalKey(['..#', '.##'], side)).toBe(canonicalKey(front, side));
    expect(canonicalKey(['..#', '.##'], ['.#.', '###'])).toBe(canonicalKey(front, side));
  });

  it('differs for a different pair', () => {
    expect(canonicalKey(['#..', '###'], side)).not.toBe(canonicalKey(front, side));
  });
});
