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
import { blockText, starText } from './result';
import type { GameState, Store } from './store';

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
};

/** Longest side of a silhouette panel, in CSS px. */
const PANEL_PX = 84;
const PANEL_GAP_PX = 2;
const RESET_CONFIRM_MS = 3000;

type Panel = { root: HTMLElement; cells: HTMLElement[][] };

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
 * Builds a flat grid for one silhouette. Rows are drawn top first and columns
 * left to right, and never change with the board's rotation.
 */
const buildPanel = (id: string, columns: number, rows: number): Panel => {
  const root = element(id);
  const grid = element(`${id}-grid`);
  grid.replaceChildren();
  const cellPx = Math.floor(
    (PANEL_PX - PANEL_GAP_PX * (Math.max(columns, rows) - 1)) / Math.max(columns, rows)
  );
  grid.style.gridTemplateColumns = `repeat(${columns}, ${cellPx}px)`;
  grid.style.gridAutoRows = `${cellPx}px`;
  grid.style.gap = `${PANEL_GAP_PX}px`;

  const cells: HTMLElement[][] = Array.from({ length: rows }, () => []);
  for (let y = rows - 1; y >= 0; y--) {
    for (let column = 0; column < columns; column++) {
      const cell = document.createElement('div');
      cell.className = 'cell empty';
      grid.append(cell);
      cells[y]?.push(cell);
    }
  }
  return { root, cells };
};

const paintPanel = (panel: Panel, states: CellState[][]): void => {
  panel.cells.forEach((row, y) => {
    row.forEach((cell, column) => {
      cell.className = `cell ${states[y]?.[column] ?? 'empty'}`;
    });
  });
  const solved = states.every((row) => row.every((state) => state === 'match' || state === 'empty'));
  panel.root.classList.toggle('solved', solved);
};

/** Wires the HUD to one game. Returns a function that unwires it again. */
export const createHud = (puzzle: Puzzle, store: Store, options: HudOptions): (() => void) => {
  const { size } = puzzle;
  const frontTarget: Grid = parseSilhouette(puzzle.front);
  const sideTarget: Grid = parseSilhouette(puzzle.side);
  const frontPanel = buildPanel('panel-front', size.w, size.h);
  const sidePanel = buildPanel('panel-side', size.d, size.h);

  const blockCount = element('block-count');
  const floatingWarning = element('floating-warning');
  const starsLine = element('stars');
  const submitButton = button('submit');
  const submitNote = element('submit-note');
  const resultButton = button('result-open');
  const addButton = button('mode-add');
  const removeButton = button('mode-remove');
  const undoButton = button('undo');
  const resetButton = button('reset');

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

  const renderSubmit = (blocks: ReadonlySet<string>, solved: boolean): void => {
    // Live rating for the sculpture on the board, until a result is recorded.
    starsLine.hidden = !solved || submission !== null;
    if (solved) {
      const stars = starsFor(blocks.size, puzzle.par);
      starsLine.textContent = starText(stars);
      starsLine.setAttribute('aria-label', `${stars} of 3 stars`);
    }

    submitButton.hidden = submission !== null;
    submitButton.disabled = !solved || submitting || options.submitBlocked !== null;
    submitButton.textContent = submitting
      ? 'Submitting\u2026'
      : solved
        ? `Submit ${blockText(blocks.size)}`
        : 'Submit';

    const note = submission ? null : (options.submitBlocked ?? failure);
    submitNote.hidden = note === null;
    submitNote.textContent = note ?? '';
    submitNote.classList.toggle('failed', options.submitBlocked === null && failure !== null);

    // Once submitted, a small button brings the result card back.
    resultButton.hidden = submission === null || options.openResult === null;
    if (submission) {
      resultButton.textContent = `Results ${starText(submission.stars)}`;
      resultButton.setAttribute(
        'aria-label',
        `Results: ${blockText(submission.blocks)}, par ${submission.par}, ${submission.stars} of 3 stars`
      );
    }
  };

  const render = (state: GameState): void => {
    const { blocks, mode, undoStack } = state;
    paintPanel(frontPanel, diffShadow(projectFront(blocks, size), frontTarget));
    paintPanel(sidePanel, diffShadow(projectSide(blocks, size), sideTarget));

    blockCount.textContent = `${blockText(blocks.size)}, par ${puzzle.par}`;

    const floating = findFloating(blocks).length;
    floatingWarning.hidden = floating === 0;
    floatingWarning.textContent = `${floating} floating`;

    renderSubmit(blocks, isSolved(blocks, puzzle));

    addButton.setAttribute('aria-pressed', String(mode === 'add'));
    removeButton.setAttribute('aria-pressed', String(mode === 'remove'));
    undoButton.disabled = undoStack.length === 0;
    resetButton.disabled = blocks.size === 0;
    if (blocks.size === 0) disarmReset();
  };

  const unsubscribe = store.subscribe(render);
  render(store.getState());

  return () => {
    unsubscribe();
    listeners.abort();
    disarmReset();
  };
};
