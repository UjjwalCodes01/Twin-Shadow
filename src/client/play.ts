// The game itself: everything needed to put a puzzle on the board and play
// it. game.ts, the page's small first script, asks the server for the puzzle
// and loads this file at the same moment, so neither waits for the other.
// What is only wanted after the board is up (the result card, the gallery,
// making and reviewing puzzles) is in later.ts and is loaded when wanted.

import { showToast } from '@devvit/web/client';
import {
  parseDebugPuzzleResponse,
  parsePuzzleResponse,
  parseSubmitResponse,
  type Onboarding,
  type OnboardingEvent,
  type ReviewPuzzle,
  type Submission,
} from '../shared/api';
import { boardFor, type CommunityBoard } from '../shared/community';
import { diffShadow, isSolved, parseSilhouette, projectFront, projectSide } from '../shared/logic';
import { TEST_PUZZLE, TEST_SOLUTION, type Puzzle } from '../shared/puzzle';
import { createCommunityBar } from './communityBar';
import type { CommunityUi } from './communityUi';
import { DEBUG_STATES, debugSetup } from './debug';
import type { GalleryHandle } from './gallery';
import { createHintBar } from './hintBar';
import { createHints, HINT_TEXT, SOLVE_HINT_TEXT, WARMUP_DONE_LABEL } from './hints';
import { createHud, type SubmitOutcome } from './hud';
import { attachInput } from './input';
import { journeys, NO_JOURNEY } from './journey';
import { PUZZLE_URL, retryButton, setLoadState } from './loadState';
import { makerBoard } from './maker';
import { prefersReducedMotion, setMotionClock } from './motion';
import type { ResultCard } from './result';
import { createScene, type SceneHandle } from './scene';
import { createSounds, soundForChange, type BoardMoment } from './sound';
import { createStore, type Store } from './store';
import { THEME } from './theme';
import { afterEvent, needsSolveHint, needsWarmup, readRemembered, remember } from './warmup';

const SUBMIT_URL = '/api/submit';
const PREFS_URL = '/api/prefs';
const SOUND_URL = '/api/sound';
/** How long after a board's first frame the rest of the game is fetched in the background. */
const LATER_DELAY_MS = 400;

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
  /** True for the warm-up: the test puzzle with hints, never submitted or scored. */
  warmup?: boolean;
  /** A store to build the game on, in place of a new one: the player's own, kept through maker mode. */
  store?: Store;
  /** The board a puzzle is being made on. Nothing to match, nothing scored. */
  maker?: CommunityBoard;
  /** True when the player made this puzzle: they can see its results, but cannot submit. */
  own?: boolean;
};

/** Said under the count during the warm-up, where Submit would be. */
const WARMUP_NOTE = 'Warm-up: nothing here is scored';
const MAKER_NOTE = 'Making a puzzle: nothing here is scored';
const OWN_NOTE = 'Your puzzle: you are not ranked on it';
const TRIAL_NOTE = 'Trying a puzzle: nothing here is scored';

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

const stage = element('stage');

// --- What is loaded only when wanted ------------------------------------------------
// The result card, the gallery, and making and reviewing puzzles are not
// needed to draw the board. They come in one file, fetched in the background
// once the board is up, and waited for by the first tap that wants them.

type Later = typeof import('./later');
let laterParts: Promise<Later> | null = null;

/** The rest of the game, or null when it could not be fetched: the player is told, and the next tap tries again. */
const later = async (): Promise<Later | null> => {
  laterParts ??= import('./later');
  try {
    return await laterParts;
  } catch (error) {
    console.error('Could not load the rest of the game:', error);
    laterParts = null;
    showToast("Couldn't load that. Try again.");
    return null;
  }
};

/** Fetches the rest of the game ahead of the first tap that wants it. A failure here is silent: a tap tries again. */
const fetchLaterAhead = (): void => {
  if (laterParts) return;
  const ahead = import('./later');
  laterParts = ahead;
  ahead.catch(() => {
    if (laterParts === ahead) laterParts = null;
  });
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
/** The day's post number and, for a puzzle a player made, the maker's username. */
let dayCredit: { post: number; maker: string | null } | null = null;

const rememberEvent = (event: OnboardingEvent): void => {
  remembered = afterEvent(remembered, event);
  remember(event);
};

/** True while the board holds the day's own puzzle, and not the warm-up, a puzzle being made or a debug state. */
let onDay = false;
/** The store of the day's puzzle while it is on the board: maker mode borrows it and gives it back. */
let dayStore: Store | null = null;

/** Keeps the day's board exactly as it stands, to come back to after something else has had the board. */
const keepDayBoard = (): void => {
  if (!game || !day || !onDay) return;
  // Someone else's sculpture is not the player's board: go back to their own first.
  game.store.endView();
  const { blocks, rotation } = game.store.getState();
  day.options = { ...day.options, blocks: [...blocks], rotation };
};

/** Puts the day's puzzle back on the board as it was left. */
const backToDay = (): void => {
  if (day) startGame(day.puzzle, day.options);
};

/** Puts the warm-up on the board. The day's board is kept exactly as it stands. */
const startWarmup = (): void => {
  keepDayBoard();
  startGame(TEST_PUZZLE, { warmup: true, submitBlocked: WARMUP_NOTE });
};

/** Ends the warm-up, remembers how, and goes on (or back) to the day's puzzle. */
const endWarmup = (event: 'warmup-finished' | 'warmup-skipped'): void => {
  rememberEvent(event);
  backToDay();
};

// --- Making and reviewing puzzles -----------------------------------------------

/**
 * Starts a puzzle of the player's own on an empty board. Their own board is
 * set aside inside its store, undo stack and all, and comes back when they leave.
 */
const startMaking = (board: CommunityBoard): void => {
  if (!game || !onDay) return;
  const store = game.store;
  store.endView();
  store.make(board.size);
  dayStore = store;
  startGame(makerBoard(board), { maker: board, store, submitBlocked: MAKER_NOTE });
};

/** Leaves maker mode: the player's own board is back exactly as they left it. */
const stopMaking = (): void => {
  if (!dayStore || !day) return;
  dayStore.endMake();
  startGame(day.puzzle, { ...day.options, store: dayStore });
};

/** Puts a puzzle that waits for review on the board, for a moderator to try. Nothing about it is submitted. */
const tryPuzzle = (waiting: ReviewPuzzle): void => {
  keepDayBoard();
  const puzzle: Puzzle = {
    id: waiting.id,
    number: 0,
    tier: boardFor(waiting.size)?.tier ?? 1,
    size: waiting.size,
    front: waiting.front,
    side: waiting.side,
    par: waiting.par,
  };
  startGame(puzzle, { submitBlocked: TRIAL_NOTE });
  hintBar.open(null);
  hintBar.show(`Trying the puzzle by u/${waiting.maker}.`, {
    label: 'Back to review',
    run: () => {
      hintBar.close();
      backToDay();
      openReview();
    },
  });
};

/** The cards for help, making and review, once they have been loaded. */
let communityUi: CommunityUi | null = null;

/** Loads those cards the first time one is wanted. Null when they could not be fetched. */
const community = async (): Promise<CommunityUi | null> => {
  if (communityUi) return communityUi;
  const parts = await later();
  if (!parts) return null;
  communityUi ??= parts.createCommunityUi({ howToPlay: startWarmup, startMaking, stopMaking, tryPuzzle }, communityBar);
  return communityUi;
};
const openHelp = (): void => void community().then((ui) => ui?.openHelp());
const openMake = (): void => void community().then((ui) => ui?.openMake());
function openReview(): void {
  void community().then((ui) => ui?.openReview());
}

// The line under the readout: the maker's credit and, for a moderator, the way to the review.
const communityBar = createCommunityBar(openReview);

// "?" opens help: the warm-up again, or making a puzzle.
howButton.addEventListener('click', openHelp);

// --- Sound ------------------------------------------------------------------------
// Made in code, quiet, and only after the player's first tap. The mute button
// is remembered on this device and, for a logged-in player, on the server.

const MUTED_STORAGE_KEY = 'twin-shadows.muted';
// The first sound of a session leaves one line in the server's log, so it can
// be seen there that sound really starts on players' devices. In the
// background, and a failure changes nothing.
const sounds = createSounds((state) => {
  void fetch(SOUND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  }).catch(() => {});
});
const soundButton = element('sound-toggle');
/** How long after a block is placed it lands: when its knock is heard. Nothing drops with reduced motion. */
const KNOCK_DELAY_MS = prefersReducedMotion() ? 0 : THEME.motion.drop.fallMs;

const showSound = (): void => {
  const on = !sounds.isMuted();
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.setAttribute('aria-label', on ? 'Sound is on. Turn it off' : 'Sound is off. Turn it on');
};

/** What this device remembers about sound, or null when it has never been set here. */
const rememberedMute = (): boolean | null => {
  try {
    const saved = localStorage.getItem(MUTED_STORAGE_KEY);
    return saved === null ? null : saved === 'true';
  } catch {
    return null;
  }
};

const setMuted = (muted: boolean, remember: boolean): void => {
  sounds.setMuted(muted);
  showSound();
  if (!remember) return;
  try {
    localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
  } catch {
    // Storage is unavailable; the server may still remember.
  }
  // In the background: a logged-out visitor is refused, and the device has it anyway.
  void fetch(PREFS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted }),
  }).catch((error: unknown) => {
    console.error(`Could not save the sound setting at ${PREFS_URL}:`, error);
  });
};

soundButton.addEventListener('click', () => setMuted(!sounds.isMuted(), true));
setMuted(rememberedMute() ?? false, false);
// A browser lets sound start only from a touch, so it is set up on the first one.
document.addEventListener('pointerdown', () => sounds.unlock(), { once: true, capture: true });

/** Plays the board's sounds for one game. Returns a function that stops listening. */
const runSounds = (puzzle: Puzzle, store: Store, free: boolean): (() => void) => {
  const moment = (): BoardMoment => {
    const { blocks, viewing, making } = store.getState();
    return { blocks: blocks.size, viewing, making };
  };
  let before = moment();
  let solvedBefore = !free && isSolved(store.getState().blocks, puzzle);
  let solvedOnce = solvedBefore;
  return store.subscribe((state) => {
    const after = moment();
    const sound = soundForChange(before, after);
    before = after;
    if (sound === 'knock') sounds.knock(KNOCK_DELAY_MS);
    if (sound === 'lift') sounds.lift();
    // Two notes the first time this sculpture becomes a valid solve, as its last block lands.
    const solved = !free && !state.viewing && isSolved(state.blocks, puzzle);
    if (solved && !solvedBefore && !solvedOnce) {
      solvedOnce = true;
      sounds.solved();
    }
    solvedBefore = solved;
  });
};

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

  // Maker mode borrows the player's own store and gives it back; everything else starts a new one.
  const store = options.store ?? createStore(puzzle.size, options.blocks ?? []);
  if (!options.store && options.rotation) store.rotate(options.rotation);
  const free = options.maker !== undefined;
  onDay = options.results === true;
  if (onDay) dayStore = store;
  const scene = createScene(canvas, puzzle, store, { free });
  // The credit for a puzzle a player made belongs to the day's puzzle, not to whatever else has the board.
  communityBar.setCredit(dayCredit?.post ?? 0, onDay ? (dayCredit?.maker ?? null) : null);
  const stopSounds = runSounds(puzzle, store, free);
  // A puzzle is only ever made from the cards that hold the checklist, so they are loaded by now.
  const stopMaker = options.maker && communityUi ? communityUi.runMaker(store, options.maker) : (): void => {};
  soundButton.hidden = false;
  // Journey telemetry watches the post's own puzzle only, never a debug one.
  const journey = options.results
    ? journeys.track(store, puzzle, { submitted: Boolean(options.submission) })
    : NO_JOURNEY;
  // The result card and the gallery lead to each other, so each gets a way to
  // open the other. They are made the first time the card is wanted, for the
  // post's own puzzle only: a debug puzzle has neither.
  let stopped = false;
  let cards: { card: ResultCard; gallery: GalleryHandle } | null = null;
  let making: Promise<void> | null = null;
  const makeCards = async (): Promise<void> => {
    const parts = await later();
    // Nothing is made for a game that has ended while this was being fetched.
    if (!parts || stopped || cards) return;
    const gallery = parts.createGallery(store, { load: parts.loadGallery, backToResult: () => cards?.card.open() });
    const card = parts.createResultCard({
      load: async () => {
        const result = await parts.loadResult();
        if (result) journey.resultViewed();
        return result;
      },
      openGallery: () => {
        journey.galleryOpened();
        gallery.open();
      },
      openMake,
      share: async (tap) => {
        const outcome = await parts.shareResult(tap);
        if (outcome === 'done') journey.resultShared();
        return outcome;
      },
      answerJoin: parts.answerJoin,
    });
    cards = { card, gallery };
  };
  const openCard = (): void => {
    if (cards) {
      cards.card.open();
      return;
    }
    making ??= makeCards();
    void making.then(() => {
      // A fetch that failed leaves nothing made, and the next tap starts again.
      if (!cards) making = null;
      else if (!stopped) cards.card.open();
    });
  };
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
        // Remembered with the day's puzzle, so coming back to it later shows it as submitted.
        if (onDay && day) day.options = { ...day.options, submission: outcome.submission };
      }
      return outcome;
    },
    openResult: options.results ? openCard : null,
    // Nothing to submit in the warm-up, on a puzzle being made, or on a puzzle the player made.
    practice: options.warmup === true || free || options.own === true,
    free,
    resultsWithoutSubmission: options.own === true,
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
      stopSounds();
      stopMaker();
      stopHow();
      howButton.hidden = true;
      removeHud();
      stopped = true;
      cards?.gallery.dispose();
      cards?.card.dispose();
      scene.dispose();
      canvas.remove();
    },
  };
  setLoadState('ready');
  // A player who already submitted comes back to their result.
  if (options.results && options.submission) openCard();
  // Everything else is fetched once this board has had its first frame, so it never holds that frame back.
  else requestAnimationFrame(() => window.setTimeout(fetchLaterAhead, LATER_DELAY_MS));
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
 * so a broken round trip is always visible. `asked` is a request already on
 * its way: the page's first script sends one before this file has arrived.
 */
async function loadPostPuzzle(asked?: Promise<Response>): Promise<void> {
  setLoadState('loading');
  try {
    const response = await (asked ?? fetch(PUZZLE_URL));
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
    dayCredit = { post: parsed.post, maker: parsed.maker };
    communityBar.setStatus(parsed.community);
    // This device's own setting wins; otherwise the server's, which follows a player between devices.
    if (rememberedMute() === null) setMuted(parsed.muted, false);
    day = {
      puzzle,
      options: {
        // A returning player gets their submitted sculpture back on the board.
        blocks: submission?.sculpture ?? [],
        submission,
        // The maker of this puzzle can look at its results but is never ranked on it.
        submitBlocked: parsed.yours ? OWN_NOTE : canSubmit ? null : 'Log in to submit',
        results: true,
        own: parsed.yours,
      },
    };
    // A player neither the server nor this device has seen before starts with the warm-up.
    // Not the maker of this puzzle, who plainly knows how to play.
    if (!parsed.yours && needsWarmup(parsed.onboarding, remembered, submission !== null)) startWarmup();
    else startGame(day.puzzle, day.options);
    if (debug) showDebugBar();
  } catch (error) {
    game?.stop();
    game = null;
    console.error(`Could not load ${PUZZLE_URL}:`, error);
    setLoadState('error');
  }
}

/**
 * Starts the game. `asked` is the request for the post's puzzle that the
 * page's first script has already sent, or null for a local debug build,
 * which has no server and starts from a bundled state.
 */
export const start = (asked: Promise<Response> | null): void => {
  // Retry asks afresh. The first script's own Retry, for a failed download, is replaced by this one.
  retryButton.onclick = () => void loadPostPuzzle();
  if (asked) {
    void loadPostPuzzle(asked);
    return;
  }
  showDebugBar();
  const params = new URLSearchParams(window.location.search);
  const rotation = Number(params.get('rot') ?? 0);
  loadDebugState(params.get('state'), Number.isInteger(rotation) ? rotation : 0);
};
