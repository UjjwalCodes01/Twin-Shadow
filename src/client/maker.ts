// Making a puzzle: the live checklist a player sees while they build, and
// the empty board they build on. No DOM. The rules are the shared ones the
// server checks again when the puzzle is sent.

import type { LastPuzzle } from '../shared/api';
import {
  CHECK_TEXT,
  SHAPE_CHECKS,
  shapeChecks,
  type CommunityBoard,
  type ParRefusal,
  type ShapeCheck,
} from '../shared/community';
import type { Puzzle, Size } from '../shared/puzzle';
import { dateText } from './splashText';

/** One line of the checklist: a rule about the sculpture's shape, met or not yet. */
export type ChecklistLine = { check: ShapeCheck; text: string; met: boolean };

export type Checklist = {
  lines: ChecklistLine[];
  /** Said under the lines: what is not checked until the puzzle is sent, or how the last try came back. */
  note: string;
  /** True when every line is met, so the puzzle can be sent. */
  ready: boolean;
};

/** How many blocks a puzzle takes to solve is only settled by the server's search, when it is sent. */
export const PAR_NOTE = 'The number of blocks to solve is checked when you send it.';

/** Said in place of the note while the board still holds a sculpture the server sent back over par. */
export const PAR_REFUSED_NOTE: Record<ParRefusal, string> = {
  'par-low': 'Sent back: it needs more blocks to solve. Make the shadows bigger.',
  'par-high': 'Sent back: it needs fewer blocks to solve. Make the shadows smaller.',
};

/**
 * The checklist for a sculpture. Only the shape rules decide whether it can
 * be sent. `sentBack` is how the server refused this very sculpture over par,
 * if it did: the note says so until the sculpture changes.
 */
export const checklist = (
  blocks: ReadonlySet<string>,
  board: CommunityBoard,
  sentBack: ParRefusal | null = null
): Checklist => {
  const shape = shapeChecks(blocks, board);
  const lines: ChecklistLine[] = SHAPE_CHECKS.map((check) => ({ check, text: CHECK_TEXT[check], met: shape[check] }));
  return {
    lines,
    note: sentBack === null ? PAR_NOTE : PAR_REFUSED_NOTE[sentBack],
    ready: lines.every((line) => line.met),
  };
};

/**
 * What became of the last puzzle a player sent, in a sentence. A puzzle that
 * was not approved is never given a reason. `canMake` is whether they may
 * make another now, which is only said when it is true.
 */
export const lastPuzzleText = (last: LastPuzzle, canMake: boolean): string => {
  if (last.status === 'waiting') return 'Your last puzzle is waiting for review.';
  if (last.status === 'approved') return 'Your last puzzle was approved. It is in line for a Sunday.';
  if (last.status === 'used') return `Your last puzzle was used on ${dateText(last.date)}.`;
  return `Your last puzzle was not picked this time.${canMake ? ' You can make another.' : ''}`;
};

/** "5 × 5 × 5". */
export const boardLabel = ({ w, d, h }: Size): string => `${w} × ${d} × ${h}`;

/** The empty board a puzzle is built on: nothing to match, so the walls just show what is cast. */
export const makerBoard = (board: CommunityBoard): Puzzle => {
  const blank = (columns: number): string[] => Array.from({ length: board.size.h }, () => '.'.repeat(columns));
  return {
    id: 'maker',
    number: 0,
    tier: board.tier,
    size: board.size,
    front: blank(board.size.w),
    side: blank(board.size.d),
    par: 0,
  };
};
