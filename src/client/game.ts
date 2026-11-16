import { canRunAsUser } from '@devvit/web/client';
import {
  parseDebugPuzzleResponse,
  parseGalleryResponse,
  parseJoinResponse,
  parsePuzzleResponse,
  parseResultResponse,
  parseShareResponse,
  parseSubmitResponse,
  type Gallery,
  type GallerySort,
  type JoinChoice,
  type Onboarding,
  type OnboardingEvent,
  type Result,
  type Submission,
} from '../shared/api';
import { diffShadow, isSolved, parseSilhouette, projectFront, projectSide } from '../shared/logic';
import { TEST_PUZZLE, TEST_SOLUTION, type Puzzle } from '../shared/puzzle';
import { DEBUG_STATES, debugSetup } from './debug';
import { createGallery, type GalleryHandle } from './gallery';
import { createHintBar } from './hintBar';
import { createHints, HINT_TEXT, SOLVE_HINT_TEXT, WARMUP_DONE_LABEL } from './hints';
import { createHud, type SubmitOutcome } from './hud';
import { attachInput } from './input';
import { journeys, NO_JOURNEY } from './journey';
import { setMotionClock } from './motion';
import { createResultCard, type ActionOutcome, type ResultCard } from './result';
import { createScene, type SceneHandle } from './scene';
import { createStore, type Store } from './store';
import { applyTheme } from './theme';
import { afterEvent, needsSolveHint, needsWarmup, readRemembered, remember } from './warmup';

const PUZZLE_URL = '/api/puzzle';
const SUBMIT_URL = '/api/submit';
const RESULT_URL = '/api/result';
const GALLERY_URL = '/api/gallery';
const SHARE_URL = '/api/share';
const JOIN_URL = '/api/join';

/** 'missing' is a post with no puzzle saved for it: asking again cannot help, so there is no Retry. */
type LoadState = 'loading' | 'ready' | 'error' | 'missing';
type Game = { store: Store; scene: SceneHandle; stop: () => void };

// The page takes its colours and fonts from theme.ts, and the fonts start loading here.
applyTheme();

type GameOptions = {
  blocks?: readonly string[];
  rotation?: number;
  /** The player's stored result for this puzzle, if any. */
  submission?: Submission | null;
  /** Why Submit is off for this game, or null when it is allowed. */
  submitBlocked?: string | null;
  /** True for the post's own puzzle, which has results. A debug puzzle has none. */
  results?: boolean;
  /** True for the warm-up: the test puzzle with hints, never submitted or scored. */
  warmup?: boolean;
};

/** Said under the count during the warm-up, where Submit would be. */
const WARMUP_NOTE = 'Warm-up: nothing here is scored';

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

/**
 * Asks Reddit whether the app may act as the player, which shows Reddit's own
 * permission prompt the first time. It needs the player's real tap. Anything
 * but a clear yes counts as no, so nothing is ever done as the player without it.
 */
const playerAllows = async (tap: Event): Promise<boolean> => {
  try {
    return await canRunAsUser(tap);
  } catch (error) {
    console.error('Could not ask for permission to act as the player:', error);
    return false;
  }
};

/** Posts the player's result as a comment on the post, after their tap on Share and Reddit's permission. */
const shareResult = async (tap: Event): Promise<ActionOutcome> => {
  if (!(await playerAllows(tap))) return 'declined';
  try {
    const response = await fetch(SHARE_URL, { method: 'POST' });
    const body: unknown = await response.json();
    const parsed = parseShareResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status === 'not-submitted' || parsed.status === 'failed') throw new Error(parsed.message);
    return 'done';
  } catch (error) {
    console.error(`Could not share through ${SHARE_URL}:`, error);
    return 'failed';
  }
};

/** Sends the player's answer to the join prompt. Joining acts as the player, so it asks permission first. */
const answerJoin = async (choice: JoinChoice, tap: Event): Promise<ActionOutcome> => {
  if (choice === 'join' && !(await playerAllows(tap))) return 'declined';
  try {
    const response = await fetch(JOIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    });
    const body: unknown = await response.json();
    const parsed = parseJoinResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status !== 'ok') throw new Error(parsed.message);
    return 'done';
  } catch (error) {
    console.error(`Could not send the answer to ${JOIN_URL}:`, error);
    return 'failed';
  }
};

let game: Game | null = null;

// --- Warm-up and hints ---------------------------------------------------------
// A first-time player gets the small test puzzle first, with hints that come
// one at a time and go when the player has done what they say. It is never
// submitted or scored, and it can be skipped. Whether a player has had it is
// remembered on the server and on this device.

const hintBar = createHintBar();
const howButton = element('how-to-play');

/** What the server says this player has still to be shown, once the puzzle has loaded. */
let onboarding: Onboarding | null = null;
/** What this device remembers them having had. */
let remembered = readRemembered();
/** The day's puzzle and how to start it: kept while the warm-up is on the board, to come back to. */
let day: { puzzle: Puzzle; options: GameOptions } | null = null;

const rememberEvent = (event: OnboardingEvent): void => {
  remembered = afterEvent(remembered, event);
  remember(event);
};

/** Puts the warm-up on the board. The day's board is kept exactly as it stands. */
const startWarmup = (): void => {
  if (game && day) {
    const { blocks, rotation } = game.store.getState();
    day.options = { ...day.options, blocks: [...blocks], rotation };
  }
  startGame(TEST_PUZZLE, { warmup: true, submitBlocked: WARMUP_NOTE });
};

/** Ends the warm-up, remembers how, and goes on (or back) to the day's puzzle. */
const endWarmup = (event: 'warmup-finished' | 'warmup-skipped'): void => {
  rememberEvent(event);
  if (day) startGame(day.puzzle, day.options);
};

howButton.addEventListener('click', startWarmup);

/**
 * Runs the warm-up's hints for one game. Returns a function that stops them.
 * A hint never takes a tap: it is a line under the board, and a light on one tile.
 */
const runWarmupHints = (puzzle: Puzzle, store: Store, scene: SceneHandle): (() => void) => {
  const hints = createHints();
  const frontTarget = parseSilhouette(puzzle.front);
  const sideTarget = parseSilhouette(puzzle.side);
  const startRotation = store.getState().rotation;
  let turned = false;
  // The first tile pointed at is one the known solution uses, so the hint starts the player well.
  const firstTile = TEST_SOLUTION.find((key) => key.split(',')[1] === '0') ?? '0,0,0';

  const refresh = (): void => {
    const { blocks, rotation } = store.getState();
    if (rotation !== startRotation) turned = true;
    const shadows = [
      ...diffShadow(projectFront(blocks, puzzle.size), frontTarget),
      ...diffShadow(projectSide(blocks, puzzle.size), sideTarget),
    ];
    const hint = hints.update({
      blocks: blocks.size,
      extra: shadows.some((row) => row.includes('extra')),
      rotated: turned,
      solved: isSolved(blocks, puzzle),
    });
    scene.setPulse(hint === 'place' ? firstTile : null);
    if (hint === null) hintBar.clear();
    else if (hint === 'solved') {
      hintBar.show(HINT_TEXT.solved, { label: WARMUP_DONE_LABEL, run: () => endWarmup('warmup-finished') });
    } else hintBar.show(HINT_TEXT[hint]);
  };

  hintBar.open(() => endWarmup('warmup-skipped'));
  const unsubscribe = store.subscribe(refresh);
  refresh();
  return () => {
    unsubscribe();
    hintBar.close();
  };
};

/**
 * On a real puzzle, a new player gets one hint, the first time their
 * sculpture is a valid solve. It goes when they change the sculpture or
 * submit. Returns a function that stops watching.
 */
const runSolveHint = (puzzle: Puzzle, store: Store): (() => void) => {
  /** The sculpture the hint was shown for, while it is showing. */
  let shownFor: ReadonlySet<string> | null = null;
  let given = false;
  const unsubscribe = store.subscribe((state) => {
    if (shownFor) {
      // The player has trimmed, added or turned to someone else's sculpture: the hint has done its work.
      if (state.blocks !== shownFor || state.viewing) {
        shownFor = null;
        hintBar.close();
      }
      return;
    }
    if (given || state.viewing || !isSolved(state.blocks, puzzle)) return;
    given = true;
    shownFor = state.blocks;
    rememberEvent('solve-hint-seen');
    hintBar.open(null);
    hintBar.show(SOLVE_HINT_TEXT);
  });
  return () => {
    unsubscribe();
    if (shownFor) hintBar.close();
  };
};

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
  // Journey telemetry watches the post's own puzzle only, never a debug one.
  const journey = options.results
    ? journeys.track(store, puzzle, { submitted: Boolean(options.submission) })
    : NO_JOURNEY;
  if (options.results) {
    gallery = createGallery(store, { load: loadGallery, backToResult: () => card?.open() });
    card = createResultCard({
      load: async () => {
        const result = await loadResult();
        if (result) journey.resultViewed();
        return result;
      },
      openGallery: () => {
        journey.galleryOpened();
        gallery?.open();
      },
      share: async (tap) => {
        const outcome = await shareResult(tap);
        if (outcome === 'done') journey.resultShared();
        return outcome;
      },
      answerJoin,
    });
  }
  // The app is ready once a board a player can use has been drawn: the day's
  // puzzle or the warm-up, never a debug state. Registered after the scene
  // asked for its first frame, so this runs once that frame has been drawn.
  if (options.results || options.warmup) requestAnimationFrame(() => journeys.boardDrawn());

  // Hints: the warm-up has its own run of them; a real puzzle has one, for a
  // player who has not yet seen it and has not already submitted.
  let stopHints = (): void => {};
  if (options.warmup) stopHints = runWarmupHints(puzzle, store, scene);
  else if (options.results && onboarding && needsSolveHint(onboarding, remembered, Boolean(options.submission))) {
    stopHints = runSolveHint(puzzle, store);
  }

  const removeHud = createHud(puzzle, store, {
    submission: options.submission ?? null,
    submitBlocked: options.submitBlocked ?? null,
    submit: async (blocks) => {
      const outcome = await submitSculpture(blocks);
      if (outcome.ok) {
        journey.submitted(outcome.submission.stars);
        // Submitted: any hint about submitting has done its work.
        stopHints();
        stopHints = (): void => {};
      }
      return outcome;
    },
    openResult: card ? () => card?.open() : null,
    practice: options.warmup === true,
  });
  attachInput(canvas, puzzle, store, scene);

  // "How to play" replays the warm-up. It is offered on the day's puzzle
  // only, and not while someone else's sculpture is on the board.
  const showHow = (): void => {
    howButton.hidden = !options.results || store.getState().viewing;
  };
  const stopHow = store.subscribe(showHow);
  showHow();

  game = {
    store,
    scene,
    stop: () => {
      journey.stop();
      stopHints();
      stopHow();
      howButton.hidden = true;
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

  // Third row: place a pasted list of blocks ("3,0,0 3,1,0 ...") on the
  // current board, so a tester can reach a solved board without building it
  // tap by tap. The store applies the usual rules to each block.
  const blocksRow = document.createElement('div');
  blocksRow.className = 'debug-queue';
  const blocksInput = document.createElement('input');
  blocksInput.type = 'text';
  blocksInput.className = 'debug-blocks';
  blocksInput.placeholder = 'blocks: 0,0,0 1,0,0';
  blocksInput.setAttribute('aria-label', 'Blocks to place');
  blocksRow.append(blocksInput);
  addButton(blocksRow, 'place', () => {
    const keys = blocksInput.value.match(/\d+,\d+,\d+/g) ?? [];
    const placed = keys.filter((key) => game?.store.add(key) === true).length;
    blocksInput.value = '';
    blocksInput.placeholder = `placed ${placed} of ${keys.length}`;
  });
  bar.append(blocksRow);

  Object.assign(window, {
    twinShadowsDebug: {
      load: loadDebugState,
      render: () => game?.scene.renderNow(),
      // The warm-up on demand, and a way to make this device forget it has been had.
      warmup: startWarmup,
      forget: () => {
        remembered = { warmup: false, solveHint: false };
        try {
          localStorage.removeItem('twin-shadows.onboarding');
        } catch {
          // Nothing to forget where storage is unavailable.
        }
      },
      // Holds the board's animations at a chosen time, to photograph them frame by frame; null lets time run again.
      freezeAt: (time: number | null) => setMotionClock(time === null ? null : () => time),
      // For screenshots of the two looks that only a pointer or a refused tap brings up.
      ghost: (key: string | null) => game?.scene.setGhost(key),
      flash: (key: string) => game?.scene.flashBlock(key),
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
    onboarding = parsed.onboarding;
    day = {
      puzzle,
      options: {
        // A returning player gets their submitted sculpture back on the board.
        blocks: submission?.sculpture ?? [],
        submission,
        submitBlocked: canSubmit ? null : 'Log in to submit',
        results: true,
      },
    };
    // A player neither the server nor this device has seen before starts with the warm-up.
    if (needsWarmup(parsed.onboarding, remembered, submission !== null)) startWarmup();
    else startGame(day.puzzle, day.options);
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
