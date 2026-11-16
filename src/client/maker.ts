// Making a puzzle: the live checklist a player sees while they build, and
// the empty board they build on. No DOM. The rules are the shared ones the
// server checks again when the puzzle is sent.

import {
  CHECK_TEXT,
  CHECKLIST_PAR_LIMIT_MS,
  parInRange,
  SHAPE_CHECKS,
  shapeChecks,
  workOutPar,
  type Check,
  type CommunityBoard,
} from '../shared/community';
import type { Puzzle, Size } from '../shared/puzzle';

/** One line of the checklist: met, not yet met, or (null) still being worked out. */
export type ChecklistLine = { check: Check; text: string; met: boolean | null };

export type Checklist = {
  lines: ChecklistLine[];
  /** True when every line is met, so the puzzle can be sent. */
  ready: boolean;
};

/**
 * The checklist for a sculpture. `par` is the estimate of how many blocks
 * solve it, or null while that is not known yet.
 */
export const checklist = (blocks: ReadonlySet<string>, board: CommunityBoard, par: number | null): Checklist => {
  const shape = shapeChecks(blocks, board);
  const lines: ChecklistLine[] = SHAPE_CHECKS.map((check) => ({ check, text: CHECK_TEXT[check], met: shape[check] }));
  // Par can only be worked out for a sculpture with nothing floating.
  const parMet = !shape.floating ? false : par === null ? null : parInRange(par, board);
  lines.push({ check: 'par', text: CHECK_TEXT.par, met: parMet });
  return { lines, ready: lines.every((line) => line.met === true) };
};

/**
 * A quick estimate of par, for the checklist. Null for a sculpture it cannot
 * be worked out for: an empty board, or one with a block floating. The server
 * searches harder when the puzzle is sent, so its par can be a little lower.
 */
export const estimatePar = (
  blocks: ReadonlySet<string>,
  board: CommunityBoard,
  now: () => number = () => performance.now()
): number | null => {
  if (!shapeChecks(blocks, board).floating) return null;
  return workOutPar([...blocks], board.size, { until: now() + CHECKLIST_PAR_LIMIT_MS, now }).par;
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
