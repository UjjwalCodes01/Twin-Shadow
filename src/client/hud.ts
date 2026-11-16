// Plain HTML controls and readouts around the board. Reads the store and calls
// its actions; holds no game state of its own.

import {
  diffShadow,
  findFloating,
  isSolved,
  parseSilhouette,
  projectFront,
  projectSide,
  type CellState,
  type Grid,
} from '../shared/logic';
import type { Submission } from '../shared/api';
import type { Puzzle } from '../shared/puzzle';
import { sortBlocks, starsFor } from '../shared/score';
import { motionNow, prefersReducedMotion } from './motion';
import { createCrossFade, paintWall, type CrossFade, type WallKind } from './paint';
import { blockText } from './result';
import { showStars, starRow, starsLabel } from './stars';
import type { GameState, Store } from './store';
import { THEME } from './theme';

export type SubmitOutcome = { ok: true; submission: Submission } | { ok: false; message: string };

export type HudOptions = {
  /** The player's stored result for this puzzle, if they already submitted. */
  submission: Submission | null;
  /** Why Submit is switched off for this game (logged out, debug puzzle), or null. */
  submitBlocked: string | null;
  /** Sends the sculpture to the server. Never throws. */
  submit: (blocks: string[]) => Promise<SubmitOutcome>;
  /** Opens the result card, or null for a game that has no results (a debug puzzle). */
  openResult: (() => void) | null;
  /** True for the warm-up: there is nothing to submit, so the button is not shown at all. */
  practice?: boolean;
};

/** Longest side of a silhouette panel, in CSS px. */
const PANEL_PX = 84;
/** Panels are drawn no finer than this many canvas pixels per CSS pixel. */
const MAX_PANEL_RATIO = 3;
const RESET_CONFIRM_MS = 3000;

/** A silhouette panel: a small sheet painted exactly as its wall is. */
type Panel = {
  root: HTMLElement;
  kind: WallKind;
  /** The canvas, wrapped so that a new picture fades in over the old one. */
  fade: CrossFade | null;
  columns: number;
  rows: number;
  /** Canvas pixels per cell, and per CSS pixel. */
  cell: number;
  ratio: number;
  /** What was last painted, so an unchanged panel is left alone. */
  last: string;
};

/**
 * What the Submit button says. Short enough to stay on one line beside the
 * panels on a narrow screen: the block count, without the word.
 */
export const submitText = (solved: boolean, submitting: boolean, blocks: number): string => {
  if (submitting) return 'Submitting\u2026';
  return solved ? `Submit ${blocks}` : 'Submit';
};

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

const button = (id: string): HTMLButtonElement => {
  const found = element(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return found;
};

/**
 * Builds the canvas for one silhouette panel. It is drawn top row first and
 * left to right, and never changes with the board's rotation.
 */
const buildPanel = (id: string, kind: WallKind, columns: number, rows: number): Panel => {
  const root = element(id);
  const holder = element(`${id}-grid`);
  const cellPx = Math.floor(PANEL_PX / Math.max(columns, rows));
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PANEL_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(columns * cellPx * ratio);
  canvas.height = Math.round(rows * cellPx * ratio);
  canvas.style.width = `${columns * cellPx}px`;
  canvas.style.height = `${rows * cellPx}px`;
  // The panel's section already says which shadow this is.
  canvas.setAttribute('aria-hidden', 'true');
  holder.replaceChildren(canvas);
  const context = canvas.getContext('2d');
  return {
    root,
    kind,
    fade: context ? createCrossFade(context) : null,
    columns,
    rows,
    cell: cellPx * ratio,
    ratio,
    last: '',
  };
};

/**
 * `states` is indexed [y][column] with y = 0 at the floor, as the rules give
 * it. New shadow fades in over `fadeMs`, as it does on the wall. Returns
 * whether anything was painted.
 */
const paintPanel = (panel: Panel, states: CellState[][], depth: number, fadeMs: number): boolean => {
  const solved = states.every((row) => row.every((state) => state === 'match' || state === 'empty'));
  panel.root.classList.toggle('solved', solved);
  const signature = `${depth}|${JSON.stringify(states)}`;
  if (!panel.fade || signature === panel.last) return false;
  panel.last = signature;
  panel.fade.show(
    (context) =>
      paintWall(context, {
        kind: panel.kind,
        columns: panel.columns,
        rows: panel.rows,
        cell: panel.cell,
        // The painter wants the top row first.
        states: [...states].reverse(),
        unit: panel.ratio,
        depth,
      }),
    motionNow(),
    fadeMs
  );
  return true;
};

/** Wires the HUD to one game. Returns a function that unwires it again. */
export const createHud = (puzzle: Puzzle, store: Store, options: HudOptions): (() => void) => {
  const { size } = puzzle;
  const frontTarget: Grid = parseSilhouette(puzzle.front);
  const sideTarget: Grid = parseSilhouette(puzzle.side);
  const frontPanel = buildPanel('panel-front', 'front', size.w, size.h);
  const sidePanel = buildPanel('panel-side', 'side', size.d, size.h);

  const countBlocks = element('count-blocks');
  const countPar = element('count-par');
  const floatingWarning = element('floating-warning');
  const starsLine = element('stars');
  const submitButton = button('submit');
  const submitNote = element('submit-note');
  const resultButton = button('result-open');
  const addButton = button('mode-add');
  const removeButton = button('mode-remove');
  const undoButton = button('undo');
  const resetButton = button('reset');

  // The panels move with the walls: shadow fades in and out over the same
  // time, and deepens for the same moment when the sculpture is first solved.
  const reduced = prefersReducedMotion();
  const shadowMs = reduced ? THEME.motion.reduced.shadowMs : THEME.motion.shadowMs;
  let panelFrame = 0;
  const stepPanels = (): void => {
    panelFrame = 0;
    const now = motionNow();
    frontPanel.fade?.step(now);
    sidePanel.fade?.step(now);
    // Frames keep coming only while a fade is under way.
    if (frontPanel.fade?.fading() || sidePanel.fade?.fading()) panelFrame = requestAnimationFrame(stepPanels);
  };
  let deepTimer = 0;
  let deep = false;
  let wasSolved: boolean | null = null;
  /** The stars last drawn on the live rating, so they appear one after another only when they change. */
  let starsShown = 0;

  // One signal removes every listener when the game is replaced.
  const listeners = new AbortController();
  const onClick = (target: HTMLButtonElement, action: () => void): void =>
    target.addEventListener('click', action, { signal: listeners.signal });

  onClick(addButton, () => store.setMode('add'));
  onClick(removeButton, () => store.setMode('remove'));
  onClick(button('rotate-left'), () => store.rotate(1));
  onClick(button('rotate-right'), () => store.rotate(-1));
  onClick(undoButton, () => store.undo());
  onClick(resultButton, () => options.openResult?.());

  // Reset needs a second tap within a few seconds.
  let resetTimer = 0;
  const disarmReset = (): void => {
    window.clearTimeout(resetTimer);
    resetTimer = 0;
    resetButton.textContent = 'Reset';
    resetButton.classList.remove('armed');
  };
  onClick(resetButton, () => {
    if (resetTimer !== 0) {
      disarmReset();
      store.reset();
      return;
    }
    resetButton.textContent = 'Sure?';
    resetButton.classList.add('armed');
    resetTimer = window.setTimeout(disarmReset, RESET_CONFIRM_MS);
  });

  // Submitting. The player chooses when to stop trimming: nothing is sent
  // until they press Submit, and only the first result counts.
  let submission = options.submission;
  let submitting = false;
  let failure: string | null = null;

  onClick(submitButton, () => {
    const { blocks } = store.getState();
    if (submitting || submission || options.submitBlocked || !isSolved(blocks, puzzle)) return;
    submitting = true;
    failure = null;
    render(store.getState());
    void options.submit(sortBlocks(blocks)).then((outcome) => {
      submitting = false;
      if (outcome.ok) submission = outcome.submission;
      else failure = outcome.message;
      // The game may have been replaced while the request was in flight.
      if (listeners.signal.aborted) return;
      render(store.getState());
      if (outcome.ok) options.openResult?.();
    });
  });

  const renderSubmit = (blocks: ReadonlySet<string>, solved: boolean, viewing: boolean): void => {
    // While someone else's sculpture is on the board there is nothing to submit or rate.
    if (viewing) {
      for (const part of [starsLine, submitButton, submitNote, resultButton]) part.hidden = true;
      return;
    }
    // Live rating for the sculpture on the board, until a result is recorded.
    starsLine.hidden = !solved || submission !== null;
    if (!solved) starsShown = 0;
    else {
      const stars = starsFor(blocks.size, puzzle.par);
      // Redrawn only when the rating changes: drawing them is what makes them appear in turn.
      if (stars !== starsShown) showStars(starsLine, stars);
      starsShown = stars;
    }

    submitButton.hidden = submission !== null || options.practice === true;
    submitButton.disabled = !solved || submitting || options.submitBlocked !== null;
    submitButton.textContent = submitText(solved, submitting, blocks.size);
    // The button shows the count alone; read aloud, it says what the number is.
    if (solved && !submitting) submitButton.setAttribute('aria-label', `Submit ${blockText(blocks.size)}`);
    else submitButton.removeAttribute('aria-label');

    const note = submission ? null : (options.submitBlocked ?? failure);
    submitNote.hidden = note === null;
    submitNote.textContent = note ?? '';
    submitNote.classList.toggle('failed', options.submitBlocked === null && failure !== null);

    // Once submitted, a small button brings the result card back.
    resultButton.hidden = submission === null || options.openResult === null;
    if (submission) {
      resultButton.replaceChildren('Results ', starRow(submission.stars));
      resultButton.setAttribute(
        'aria-label',
        `Results: ${blockText(submission.blocks)}, par ${submission.par}, ${starsLabel(submission.stars)}`
      );
    }
  };

  const render = (state: GameState): void => {
    const { blocks, mode, undoStack, viewing } = state;
    const solvedNow = isSolved(blocks, puzzle);
    // The moment the sculpture first becomes a valid solve: both shadows
    // deepen, then ease back. Not when it was found solved, nor for someone else's.
    if (solvedNow && wasSolved === false && !viewing && !reduced) {
      deep = true;
      window.clearTimeout(deepTimer);
      deepTimer = window.setTimeout(() => {
        deep = false;
        render(store.getState());
      }, THEME.motion.solve.holdMs);
    }
    wasSolved = solvedNow;
    const depth = deep ? THEME.motion.solve.deepen : 1;
    const front = paintPanel(frontPanel, diffShadow(projectFront(blocks, size), frontTarget), depth, shadowMs);
    const side = paintPanel(sidePanel, diffShadow(projectSide(blocks, size), sideTarget), depth, shadowMs);
    if ((front || side) && panelFrame === 0) panelFrame = requestAnimationFrame(stepPanels);

    countBlocks.textContent = blockText(blocks.size);
    countPar.textContent = `par ${puzzle.par}`;

    const floating = findFloating(blocks).length;
    floatingWarning.hidden = floating === 0;
    floatingWarning.textContent = `${floating} floating`;

    renderSubmit(blocks, solvedNow, viewing);

    addButton.setAttribute('aria-pressed', String(mode === 'add'));
    removeButton.setAttribute('aria-pressed', String(mode === 'remove'));
    // A viewed sculpture is read-only: every editing control is off, rotate stays on.
    addButton.disabled = viewing;
    removeButton.disabled = viewing;
    undoButton.disabled = viewing || undoStack.length === 0;
    resetButton.disabled = viewing || blocks.size === 0;
    if (viewing || blocks.size === 0) disarmReset();
  };

  const unsubscribe = store.subscribe(render);
  render(store.getState());

  return () => {
    unsubscribe();
    listeners.abort();
    disarmReset();
    window.clearTimeout(deepTimer);
    if (panelFrame !== 0) cancelAnimationFrame(panelFrame);
  };
};
