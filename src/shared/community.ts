// The rules a puzzle made by a player has to meet, shared by the maker's
// checklist in the client and by the server, which checks everything again
// before accepting it. The checks themselves are the generator's own, from
// analysis.ts and par.ts.

import { canonicalKey, columnSpan, isSolidRectangle, lowerBound, peakRow } from './analysis';
import { findFloating, formatSilhouette, projectFront, projectSide, type Grid } from './logic';
import { findPar, type ParDeadline, type ParOptions } from './par';
import type { Size, Tier } from './puzzle';
import { createRandom } from './random';

/** A board a player may make a puzzle on, with the limits a puzzle on it must meet. */
export type CommunityBoard = {
  size: Size;
  /** The tier it is filed under: the generated tier with the same board and limits. */
  tier: Tier;
  /** At least one shadow must reach this row, counting the floor row as 1. */
  minPeakRow: number;
  /** Par limits, both ends included: too slight below, too much tapping above. */
  minPar: number;
  maxPar: number;
};

/** The two boards on offer. The limits are those of the generated puzzles of the same size. */
export const COMMUNITY_BOARDS: readonly CommunityBoard[] = [
  { size: { w: 4, d: 4, h: 4 }, tier: 1, minPeakRow: 3, minPar: 6, maxPar: 10 },
  { size: { w: 5, d: 5, h: 5 }, tier: 3, minPeakRow: 4, minPar: 12, maxPar: 18 },
];

/** A shadow must span at least the board's width minus this many columns. */
export const SPAN_SLACK = 1;

export const boardFor = (size: Size): CommunityBoard | null =>
  COMMUNITY_BOARDS.find(
    (board) => board.size.w === size.w && board.size.d === size.d && board.size.h === size.h
  ) ?? null;

/**
 * The checks on the sculpture's shape. They need no search, so the maker's
 * checklist shows them live, and they alone decide whether a puzzle may be
 * sent. Par is not among them: only the server's search settles it.
 */
export const SHAPE_CHECKS = ['floating', 'span', 'rectangle', 'different', 'height'] as const;
export type ShapeCheck = (typeof SHAPE_CHECKS)[number];

/** What each check asks for, in plain words: the lines of the maker's checklist. */
export const CHECK_TEXT: Record<ShapeCheck, string> = {
  floating: 'No floating blocks',
  span: 'Shadows reach across the walls',
  rectangle: 'Not plain rectangles',
  different: 'Two different shadows',
  height: 'Tall enough',
};

/** Why a puzzle that fails each check is refused, as the server says it. */
export const CHECK_REFUSAL: Record<ShapeCheck, string> = {
  floating: 'Every block must rest on the floor or on another block.',
  span: 'Each shadow must reach across most of its wall.',
  rectangle: 'A shadow that is a plain rectangle is too easy. Give both some shape.',
  different: 'The two shadows must not be the same.',
  height: 'The sculpture is too low. Build it taller.',
};

/** Which way par is out when a puzzle is refused for it: it needs more blocks to solve, or fewer. */
export const PAR_REFUSALS = ['par-low', 'par-high'] as const;
export type ParRefusal = (typeof PAR_REFUSALS)[number];

/** The two shadows a sculpture casts, as grids and as the rows a puzzle stores. */
export type Shadows = { front: Grid; side: Grid; frontRows: string[]; sideRows: string[] };

export const castShadows = (blocks: ReadonlySet<string>, size: Size): Shadows => {
  const front = projectFront(blocks, size);
  const side = projectSide(blocks, size);
  return { front, side, frontRows: formatSilhouette(front), sideRows: formatSilhouette(side) };
};

/** Which of the shape checks a sculpture passes. An empty board passes none that matter. */
export const shapeChecks = (blocks: ReadonlySet<string>, board: CommunityBoard): Record<ShapeCheck, boolean> => {
  const { size } = board;
  const { front, side, frontRows, sideRows } = castShadows(blocks, size);
  return {
    floating: blocks.size > 0 && findFloating(blocks).length === 0,
    span: columnSpan(front) >= size.w - SPAN_SLACK && columnSpan(side) >= size.d - SPAN_SLACK,
    rectangle: blocks.size > 0 && !isSolidRectangle(front) && !isSolidRectangle(side),
    different: blocks.size > 0 && frontRows.join('/') !== sideRows.join('/'),
    height: Math.max(peakRow(front), peakRow(side)) >= board.minPeakRow,
  };
};

/** The first shape check a sculpture fails, or null when it passes them all. */
export const firstShapeFailure = (blocks: ReadonlySet<string>, board: CommunityBoard): ShapeCheck | null => {
  const passed = shapeChecks(blocks, board);
  return SHAPE_CHECKS.find((check) => !passed[check]) ?? null;
};

export const parInRange = (par: number, board: CommunityBoard): boolean =>
  par >= board.minPar && par <= board.maxPar;

/** Which way a par is out of range for a board, or null when it is within it. */
export const parRefusal = (par: number, board: CommunityBoard): ParRefusal | null => {
  if (par < board.minPar) return 'par-low';
  return par > board.maxPar ? 'par-high' : null;
};

/** What a maker is told when par is out of range: which way, by how much, and what to do about it. */
export const parRefusalText = (refusal: ParRefusal, par: number, board: CommunityBoard): string =>
  refusal === 'par-low'
    ? `It needs more blocks to solve. It can be solved with ${par}, and a puzzle on this board must take at least ${board.minPar}. Make the shadows bigger and send it again.`
    : `It needs fewer blocks to solve. It takes ${par}, and a puzzle on this board may take at most ${board.maxPar}. Make the shadows smaller and send it again.`;

/** How hard par is searched for on a player's puzzle: as hard as for a generated one. */
export const COMMUNITY_PAR_SEARCH: ParOptions = { parOrders: 200, parRefinements: 1500, parRefinementBlocks: 3 };

/** The longest the server lets one par search run, in milliseconds. */
export const SERVER_PAR_LIMIT_MS = 1500;

export type ParResult = {
  par: number;
  /** A sculpture with `par` blocks that casts the same shadows. Private: never sent to a client. */
  solution: string[];
  /** The fewest blocks any solution could use. Par can never be below it. */
  lowerBound: number;
};

/** A number made from a sculpture, so the same sculpture always gets the same search. */
const seedFor = (blocks: readonly string[]): number => {
  let hash = 2166136261;
  for (const key of [...blocks].sort()) {
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    hash = Math.imul(hash ^ 59, 16777619);
  }
  return hash >>> 0;
};

/**
 * Works out par for the puzzle a sculpture makes. The sculpture must have
 * nothing floating. With a deadline the search stops when time is up and
 * gives the best it has, which is never more than the sculpture's own size.
 */
export const workOutPar = (blocks: readonly string[], size: Size, deadline?: ParDeadline): ParResult => {
  const { front, side } = castShadows(new Set(blocks), size);
  const bound = lowerBound(front, side);
  const solution = findPar(blocks, front, side, size, bound, COMMUNITY_PAR_SEARCH, createRandom(seedFor(blocks)), deadline);
  return { par: solution.length, solution, lowerBound: bound };
};

/** One key for a puzzle and its lookalikes: the shadows swapped, or either one mirrored. */
export const puzzleKey = (frontRows: readonly string[], sideRows: readonly string[]): string =>
  canonicalKey(frontRows, sideRows);
