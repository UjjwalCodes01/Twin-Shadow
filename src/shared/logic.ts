// Game rules for Twin Shadows. Pure functions only: no three.js, no DOM,
// so the server can reuse them to validate submissions.
//
// Axes: x runs left to right, y runs up from the floor, z runs front to back.
// A sculpture is a set of "x,y,z" keys. Shadow grids are indexed [y][column]
// with y = 0 at the floor.

import type { Puzzle, Size } from './puzzle';

export type Blocks = ReadonlySet<string>;
export type Cell = { x: number; y: number; z: number };
export type Grid = boolean[][];
export type CellState = 'match' | 'missing' | 'extra' | 'empty';

export const toKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export const parseKey = (key: string): Cell => {
  const [x = NaN, y = NaN, z = NaN] = key.split(',').map(Number);
  return { x, y, z };
};

const FACE_NEIGHBOURS: readonly Cell[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

const inBounds = ({ x, y, z }: Cell, size: Size): boolean =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  Number.isInteger(z) &&
  x >= 0 &&
  x < size.w &&
  y >= 0 &&
  y < size.h &&
  z >= 0 &&
  z < size.d;

const emptyGrid = (columns: number, rows: number): Grid =>
  Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));

const project = (
  blocks: Blocks,
  size: Size,
  columns: number,
  columnOf: (cell: Cell) => number
): Grid => {
  const grid = emptyGrid(columns, size.h);
  for (const key of blocks) {
    const cell = parseKey(key);
    if (!inBounds(cell, size)) continue;
    const row = grid[cell.y];
    if (row) row[columnOf(cell)] = true;
  }
  return grid;
};

/** Shadow on the back wall, indexed [y][x]. Lit when any block has that x and y. */
export const projectFront = (blocks: Blocks, size: Size): Grid =>
  project(blocks, size, size.w, (cell) => cell.x);

/** Shadow on the left wall, indexed [y][z]. Lit when any block has that z and y. */
export const projectSide = (blocks: Blocks, size: Size): Grid =>
  project(blocks, size, size.d, (cell) => cell.z);

/** Converts top-first '#'/'.' rows into a grid with y = 0 at the floor. */
export const parseSilhouette = (rows: readonly string[]): Grid =>
  [...rows].reverse().map((row) => [...row].map((char) => char === '#'));

/** The reverse of parseSilhouette: a grid back to top-first '#'/'.' rows. */
export const formatSilhouette = (grid: Grid): string[] =>
  [...grid].reverse().map((row) => row.map((lit) => (lit ? '#' : '.')).join(''));

/** Compares a shadow with its target, cell by cell. Same shape as `target`. */
export const diffShadow = (actual: Grid, target: Grid): CellState[][] =>
  target.map((targetRow, y) =>
    targetRow.map((wanted, column): CellState => {
      const lit = actual[y]?.[column] ?? false;
      if (lit && wanted) return 'match';
      if (wanted) return 'missing';
      if (lit) return 'extra';
      return 'empty';
    })
  );

/**
 * Keys of blocks that are not connected to the floor. Flood fill from every
 * block at y = 0 through the six face neighbours.
 */
export const findFloating = (blocks: Blocks): string[] => {
  const grounded = new Set<string>();
  const queue: string[] = [];
  for (const key of blocks) {
    if (parseKey(key).y === 0) {
      grounded.add(key);
      queue.push(key);
    }
  }
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const { x, y, z } = parseKey(next);
    for (const step of FACE_NEIGHBOURS) {
      const neighbour = toKey(x + step.x, y + step.y, z + step.z);
      if (blocks.has(neighbour) && !grounded.has(neighbour)) {
        grounded.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return [...blocks].filter((key) => !grounded.has(key));
};

const sameGrid = (a: Grid, b: Grid): boolean =>
  a.length === b.length &&
  a.every((row, y) => {
    const other = b[y];
    return (
      other !== undefined &&
      row.length === other.length &&
      row.every((lit, column) => lit === other[column])
    );
  });

/** Solved when both shadows equal their targets and nothing floats. */
export const isSolved = (blocks: Blocks, puzzle: Puzzle): boolean => {
  const { size } = puzzle;
  for (const key of blocks) {
    if (!inBounds(parseKey(key), size)) return false;
  }
  return (
    sameGrid(projectFront(blocks, size), parseSilhouette(puzzle.front)) &&
    sameGrid(projectSide(blocks, size), parseSilhouette(puzzle.side)) &&
    findFloating(blocks).length === 0
  );
};

/** A block can go at `key` when the cell is inside the board and unoccupied. */
export const canPlace = (key: string, blocks: Blocks, size: Size): boolean =>
  inBounds(parseKey(key), size) && !blocks.has(key);
