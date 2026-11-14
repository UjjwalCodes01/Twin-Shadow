import { parsePuzzleResponse } from '../shared/api';
import type { Puzzle } from '../shared/puzzle';
import { DEBUG_STATES, debugSetup } from './debug';
import { createHud } from './hud';
import { attachInput } from './input';
import { createScene, type SceneHandle } from './scene';
import { createStore, type Store } from './store';

const PUZZLE_URL = '/api/puzzle/today';

type LoadState = 'loading' | 'ready' | 'error';
type Game = { store: Store; scene: SceneHandle; stop: () => void };

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

const stage = element('stage');
const notice = element('notice');
const noticeText = element('notice-text');
const retryButton = element('retry');

// CSS shows the HUD only when the page is ready.
const setLoadState = (state: LoadState): void => {
  document.body.dataset.state = state;
  notice.hidden = state === 'ready';
  retryButton.hidden = state !== 'error';
  noticeText.textContent =
    state === 'error' ? "Couldn't load today's puzzle." : 'Loading puzzle…';
};

let game: Game | null = null;

/** Starts a game on a fresh canvas, replacing any game already running. */
const startGame = (puzzle: Puzzle, blocks: readonly string[] = [], rotation = 0): void => {
  game?.stop();
  const canvas = document.createElement('canvas');
  canvas.id = 'board';
  stage.append(canvas);

  const store = createStore(puzzle.size, blocks);
  if (rotation !== 0) store.rotate(rotation);
  const scene = createScene(canvas, puzzle, store);
  const removeHud = createHud(puzzle, store);
  attachInput(canvas, puzzle, store, scene);

  game = {
    store,
    scene,
    stop: () => {
      removeHud();
      scene.dispose();
      canvas.remove();
    },
  };
  setLoadState('ready');
};

// --- TEMPORARY debug states -------------------------------------------------
// Offered when the server says this is the app's dev subreddit, or when a
// local build is opened with ?debug=1&state=empty|solution|broken|big&rot=0..3.
// To remove: delete this block, debug.ts, #debug-bar in game.html and
// game.css, and the `debug` field of PuzzleResponse with its server check.
const loadDebugState = (state: string | null, rotation = 0): void => {
  const setup = debugSetup(state);
  startGame(setup.puzzle, setup.blocks, rotation);
};

const showDebugBar = (): void => {
  const bar = element('debug-bar');
  if (!bar.hidden) return;
  bar.hidden = false;
  for (const state of DEBUG_STATES) {
    const stateButton = document.createElement('button');
    stateButton.type = 'button';
    stateButton.textContent = state;
    stateButton.addEventListener('click', () => loadDebugState(state));
    bar.append(stateButton);
  }
  Object.assign(window, {
    twinShadowsDebug: {
      load: loadDebugState,
      render: () => game?.scene.renderNow(),
      getState: () => game?.store.getState(),
    },
  });
};
// --- end of temporary debug states -----------------------------------------

/**
 * Loads today's puzzle from the server. A failed request or a malformed
 * response shows an error with Retry; there is no bundled fallback, so a
 * broken round trip is always visible.
 */
const loadTodaysPuzzle = async (): Promise<void> => {
  setLoadState('loading');
  try {
    const response = await fetch(PUZZLE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    const parsed = parsePuzzleResponse(body);
    if (!parsed) throw new Error('Response is not a valid puzzle');
    startGame(parsed.puzzle);
    if (parsed.debug) showDebugBar();
  } catch (error) {
    console.error(`Could not load ${PUZZLE_URL}:`, error);
    setLoadState('error');
  }
};

retryButton.addEventListener('click', () => void loadTodaysPuzzle());

const params = new URLSearchParams(window.location.search);
if (params.get('debug') === '1') {
  // Local builds have no server, so debug mode starts from a bundled state.
  showDebugBar();
  const rotation = Number(params.get('rot') ?? 0);
  loadDebugState(params.get('state'), Number.isInteger(rotation) ? rotation : 0);
} else {
  void loadTodaysPuzzle();
}
