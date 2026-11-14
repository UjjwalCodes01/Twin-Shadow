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
import type { Puzzle } from '../shared/puzzle';
import type { GameState, Store } from './store';

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

export const createHud = (puzzle: Puzzle, store: Store): void => {
  const { size } = puzzle;
  const frontTarget: Grid = parseSilhouette(puzzle.front);
  const sideTarget: Grid = parseSilhouette(puzzle.side);
  const frontPanel = buildPanel('panel-front', size.w, size.h);
  const sidePanel = buildPanel('panel-side', size.d, size.h);

  const blockCount = element('block-count');
  const floatingWarning = element('floating-warning');
  const winBanner = element('win-banner');
  const addButton = button('mode-add');
  const removeButton = button('mode-remove');
  const undoButton = button('undo');
  const resetButton = button('reset');

  addButton.addEventListener('click', () => store.setMode('add'));
  removeButton.addEventListener('click', () => store.setMode('remove'));
  button('rotate-left').addEventListener('click', () => store.rotate(1));
  button('rotate-right').addEventListener('click', () => store.rotate(-1));
  undoButton.addEventListener('click', () => store.undo());

  // Reset needs a second tap within a few seconds.
  let resetTimer = 0;
  const disarmReset = (): void => {
    window.clearTimeout(resetTimer);
    resetTimer = 0;
    resetButton.textContent = 'Reset';
    resetButton.classList.remove('armed');
  };
  resetButton.addEventListener('click', () => {
    if (resetTimer !== 0) {
      disarmReset();
      store.reset();
      return;
    }
    resetButton.textContent = 'Sure?';
    resetButton.classList.add('armed');
    resetTimer = window.setTimeout(disarmReset, RESET_CONFIRM_MS);
  });

  const render = (state: GameState): void => {
    const { blocks, mode, undoStack } = state;
    paintPanel(frontPanel, diffShadow(projectFront(blocks, size), frontTarget));
    paintPanel(sidePanel, diffShadow(projectSide(blocks, size), sideTarget));

    blockCount.textContent = `${blocks.size} ${blocks.size === 1 ? 'block' : 'blocks'}`;

    const floating = findFloating(blocks).length;
    floatingWarning.hidden = floating === 0;
    floatingWarning.textContent = `${floating} floating`;

    const solved = isSolved(blocks, puzzle);
    winBanner.hidden = !solved;
    winBanner.textContent = `Solved with ${blocks.size} blocks`;

    addButton.setAttribute('aria-pressed', String(mode === 'add'));
    removeButton.setAttribute('aria-pressed', String(mode === 'remove'));
    undoButton.disabled = undoStack.length === 0;
    resetButton.disabled = blocks.size === 0;
    if (blocks.size === 0) disarmReset();
  };

  store.subscribe(render);
  render(store.getState());
};
