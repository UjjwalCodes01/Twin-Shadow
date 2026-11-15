import {
  parseDebugPuzzleResponse,
  parseGalleryResponse,
  parsePuzzleResponse,
  parseResultResponse,
  parseSubmitResponse,
  type Gallery,
  type GallerySort,
  type Result,
  type Submission,
} from '../shared/api';
import type { Puzzle } from '../shared/puzzle';
import { DEBUG_STATES, debugSetup } from './debug';
import { createGallery, type GalleryHandle } from './gallery';
import { createHud, type SubmitOutcome } from './hud';
import { attachInput } from './input';
import { createResultCard, type ResultCard } from './result';
import { createScene, type SceneHandle } from './scene';
import { createStore, type Store } from './store';

const PUZZLE_URL = '/api/puzzle';
const SUBMIT_URL = '/api/submit';
const RESULT_URL = '/api/result';
const GALLERY_URL = '/api/gallery';

/** 'missing' is a post with no puzzle saved for it: asking again cannot help, so there is no Retry. */
type LoadState = 'loading' | 'ready' | 'error' | 'missing';
type Game = { store: Store; scene: SceneHandle; stop: () => void };

type GameOptions = {
  blocks?: readonly string[];
  rotation?: number;
  /** The player's stored result for this puzzle, if any. */
  submission?: Submission | null;
  /** Why Submit is off for this game, or null when it is allowed. */
  submitBlocked?: string | null;
  /** True for the post's own puzzle, which has results. A debug puzzle has none. */
  results?: boolean;
};

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

const stage = element('stage');
const notice = element('notice');
const noticeText = element('notice-text');
const retryButton = element('retry');

const NOTICES: Record<LoadState, string> = {
  loading: 'Loading puzzle\u2026',
  ready: '',
  error: "Couldn't load this puzzle.",
  missing: 'This post has no puzzle. Open a newer Twin Shadows post.',
};

// CSS shows the HUD only when the page is ready.
const setLoadState = (state: LoadState): void => {
  document.body.dataset.state = state;
  notice.hidden = state === 'ready';
  retryButton.hidden = state !== 'error';
  noticeText.textContent = NOTICES[state];
};

/**
 * Sends a sculpture to the server, which decides whether it counts. A network
 * failure or an unreadable reply becomes a short message the player can retry.
 */
const submitSculpture = async (blocks: string[]): Promise<SubmitOutcome> => {
  try {
    const response = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    const body: unknown = await response.json();
    const parsed = parseSubmitResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status === 'rejected') return { ok: false, message: parsed.message };
    // 'already-submitted' carries the first result, which is the one that counts.
    return { ok: true, submission: parsed.submission };
  } catch (error) {
    console.error(`Could not submit to ${SUBMIT_URL}:`, error);
    return { ok: false, message: "Couldn't submit. Try again." };
  }
};

/**
 * Fetches the caller's result for this post. The server only answers a player
 * who has submitted. Any failure becomes null, and the card offers a retry.
 */
const loadResult = async (): Promise<Result | null> => {
  try {
    const response = await fetch(RESULT_URL);
    const body: unknown = await response.json();
    const parsed = parseResultResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status !== 'ok') throw new Error(parsed.message);
    return parsed.result;
  } catch (error) {
    console.error(`Could not load ${RESULT_URL}:`, error);
    return null;
  }
};

/** Fetches one page of this post's gallery. Like the result, only a player who has submitted gets it. */
const loadGallery = async (sort: GallerySort, page: number): Promise<Gallery | null> => {
  const url = `${GALLERY_URL}?sort=${sort}&page=${page}`;
  try {
    const response = await fetch(url);
    const body: unknown = await response.json();
    const parsed = parseGalleryResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status !== 'ok') throw new Error(parsed.message);
    return parsed.gallery;
  } catch (error) {
    console.error(`Could not load ${url}:`, error);
    return null;
  }
};

let game: Game | null = null;

/** Starts a game on a fresh canvas, replacing any game already running. */
const startGame = (puzzle: Puzzle, options: GameOptions = {}): void => {
  game?.stop();
  const canvas = document.createElement('canvas');
  canvas.id = 'board';
  stage.append(canvas);

  const store = createStore(puzzle.size, options.blocks ?? []);
  if (options.rotation) store.rotate(options.rotation);
  const scene = createScene(canvas, puzzle, store);
  // The result card and the gallery lead to each other, so each gets a way
  // to open the other. A debug puzzle has neither.
  let card: ResultCard | null = null;
  let gallery: GalleryHandle | null = null;
  if (options.results) {
    gallery = createGallery(store, { load: loadGallery, backToResult: () => card?.open() });
    card = createResultCard(loadResult, () => gallery?.open());
  }
  const removeHud = createHud(puzzle, store, {
    submission: options.submission ?? null,
    submitBlocked: options.submitBlocked ?? null,
    submit: submitSculpture,
    openResult: card ? () => card?.open() : null,
  });
  attachInput(canvas, puzzle, store, scene);

  game = {
    store,
    scene,
    stop: () => {
      removeHud();
      gallery?.dispose();
      card?.dispose();
      scene.dispose();
      canvas.remove();
    },
  };
  setLoadState('ready');
  // A player who already submitted comes back to their result.
  if (card && options.submission) card.open();
};

// --- TEMPORARY debug states -------------------------------------------------
// Offered when the server says this is the app's dev subreddit, or when a
// local build is opened with ?debug=1&state=empty|solution|broken|big&rot=0..3.
// To remove: delete this block, debug.ts, #debug-bar in game.html and
// game.css, and the `debug` field of PuzzleResponse with its server check.
// A debug puzzle is not the post's puzzle, so it can never be submitted.
const DEBUG_SUBMIT_BLOCKED = 'Debug puzzle: submit is off';

const loadDebugState = (state: string | null, rotation = 0): void => {
  const setup = debugSetup(state);
  startGame(setup.puzzle, { blocks: setup.blocks, rotation, submitBlocked: DEBUG_SUBMIT_BLOCKED });
};

// Steps through the generated queue with the dev-only endpoint.
let queueNumber = 0;
const loadQueuePuzzle = async (number: number, label: HTMLElement): Promise<void> => {
  try {
    const response = await fetch(`/api/debug/puzzle/${number}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    const parsed = parseDebugPuzzleResponse(body);
    if (!parsed) throw new Error('Response is not a valid puzzle');
    const { puzzle, count } = parsed;
    queueNumber = puzzle.number;
    startGame(puzzle, { submitBlocked: DEBUG_SUBMIT_BLOCKED });
    label.textContent = `#${puzzle.number}/${count} tier ${puzzle.tier} par ${puzzle.par}`;
  } catch (error) {
    console.error(`Could not load puzzle ${number}:`, error);
    label.textContent = `#${number} unavailable`;
  }
};

const showDebugBar = (): void => {
  const bar = element('debug-bar');
  if (!bar.hidden) return;
  bar.hidden = false;
  const addButton = (parent: HTMLElement, text: string, action: () => void): void => {
    const debugButton = document.createElement('button');
    debugButton.type = 'button';
    debugButton.textContent = text;
    debugButton.addEventListener('click', action);
    parent.append(debugButton);
  };
  // "post" goes back to the puzzle this post really holds.
  addButton(bar, 'post', () => void loadPostPuzzle());
  for (const state of DEBUG_STATES) addButton(bar, state, () => loadDebugState(state));

  // Second row: step through the generated queue.
  const queueRow = document.createElement('div');
  queueRow.className = 'debug-queue';
  const label = document.createElement('span');
  label.className = 'debug-label';
  label.textContent = 'queue';
  addButton(queueRow, 'prev', () => void loadQueuePuzzle(Math.max(queueNumber - 1, 1), label));
  queueRow.append(label);
  addButton(queueRow, 'next', () => void loadQueuePuzzle(queueNumber + 1, label));
  bar.append(queueRow);
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
 * Loads the puzzle for the post this page runs in. A failed request or a
 * malformed response shows an error with Retry; there is no bundled fallback,
 * so a broken round trip is always visible.
 */
async function loadPostPuzzle(): Promise<void> {
  setLoadState('loading');
  try {
    const response = await fetch(PUZZLE_URL);
    if (response.status === 404) {
      // The server knows this post and has no puzzle for it.
      setLoadState('missing');
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    const parsed = parsePuzzleResponse(body);
    if (!parsed) throw new Error('Response is not a valid puzzle');
    const { puzzle, submission, canSubmit, debug } = parsed;
    startGame(puzzle, {
      // A returning player gets their submitted sculpture back on the board.
      blocks: submission?.sculpture ?? [],
      submission,
      submitBlocked: canSubmit ? null : 'Log in to submit',
      results: true,
    });
    if (debug) showDebugBar();
  } catch (error) {
    game?.stop();
    game = null;
    console.error(`Could not load ${PUZZLE_URL}:`, error);
    setLoadState('error');
  }
}

retryButton.addEventListener('click', () => void loadPostPuzzle());

const params = new URLSearchParams(window.location.search);
if (params.get('debug') === '1') {
  // Local builds have no server, so debug mode starts from a bundled state.
  showDebugBar();
  const rotation = Number(params.get('rot') ?? 0);
  loadDebugState(params.get('state'), Number.isInteger(rotation) ? rotation : 0);
} else {
  void loadPostPuzzle();
}
