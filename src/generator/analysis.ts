// Measurements of a silhouette, used by the generator's quality filters.
// A silhouette here is a Grid from src/shared/logic.ts: indexed [y][column],
// with y = 0 at the floor.

import type { Grid } from '../shared/logic';

export const countLit = (grid: Grid): number =>
  grid.reduce((total, row) => total + row.filter(Boolean).length, 0);

const isLit = (grid: Grid, column: number, y: number): boolean => grid[y]?.[column] ?? false;

const columnCount = (grid: Grid): number => grid[0]?.length ?? 0;

/** Number of lit cells in each column, left to right. */
export const columnCounts = (grid: Grid): number[] =>
  Array.from({ length: columnCount(grid) }, (_, column) =>
    grid.reduce((total, row) => total + (row[column] ? 1 : 0), 0)
  );

/**
 * Lit cells with at least one empty cell somewhere below them in the same
 * column. A silhouette with none is a skyline: every lit cell rests on lit
 * cells all the way down to the floor.
 */
export const countOverhangs = (grid: Grid): number => {
  let overhangs = 0;
  for (let column = 0; column < columnCount(grid); column++) {
    let gapBelow = false;
    for (let y = 0; y < grid.length; y++) {
      if (!isLit(grid, column, y)) gapBelow = true;
      else if (gapBelow) overhangs += 1;
    }
  }
  return overhangs;
};

/** Columns from the leftmost lit cell to the rightmost, both included. */
export const columnSpan = (grid: Grid): number => {
  const lit = columnCounts(grid)
    .map((count, column) => (count > 0 ? column : -1))
    .filter((column) => column >= 0);
  const first = lit[0];
  const last = lit.at(-1);
  return first === undefined || last === undefined ? 0 : last - first + 1;
};

/** The highest row holding a lit cell, counting the floor row as 1. 0 when empty. */
export const peakRow = (grid: Grid): number => grid.map((row) => row.some(Boolean)).lastIndexOf(true) + 1;

/** True when the lit cells exactly fill their bounding box, at any size. */
export const isSolidRectangle = (grid: Grid): boolean => {
  const litRows = grid.map((row) => row.some(Boolean));
  const height = litRows.lastIndexOf(true) - litRows.indexOf(true) + 1;
  const lit = countLit(grid);
  return lit > 0 && lit === columnSpan(grid) * height;
};

/**
 * True when every column inside the span holds the same number of lit cells,
 * which makes a flat, featureless shape.
 */
export const hasFlatColumns = (grid: Grid): boolean => {
  const counts = columnCounts(grid);
  const first = counts.findIndex((count) => count > 0);
  const inSpan = counts.slice(first, first + columnSpan(grid));
  return inSpan.every((count) => count === inSpan[0]);
};

/**
 * Fewest blocks any solution can use: at each height, a block lights at most
 * one front cell and one side cell, so that row needs at least as many blocks
 * as its busier silhouette has lit cells.
 */
export const lowerBound = (front: Grid, side: Grid): number => {
  let total = 0;
  for (let y = 0; y < Math.max(front.length, side.length); y++) {
    const frontLit = front[y]?.filter(Boolean).length ?? 0;
    const sideLit = side[y]?.filter(Boolean).length ?? 0;
    total += Math.max(frontLit, sideLit);
  }
  return total;
};

const mirrorRows = (rows: readonly string[]): string[] =>
  rows.map((row) => [...row].reverse().join(''));

/**
 * One key for a silhouette pair and all its lookalikes: front and side
 * swapped, and either one mirrored left to right. Two puzzles with the same
 * key count as duplicates.
 */
export const canonicalKey = (front: readonly string[], side: readonly string[]): string => {
  const fronts = [front.join('/'), mirrorRows(front).join('/')];
  const sides = [side.join('/'), mirrorRows(side).join('/')];
  const variants: string[] = [];
  for (const f of fronts) {
    for (const s of sides) variants.push(`${f}|${s}`, `${s}|${f}`);
  }
  return variants.sort()[0] ?? '';
};
