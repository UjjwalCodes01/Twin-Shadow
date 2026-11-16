// Puzzles made by players, as the game shows them: the help card that leads
// to making one, the choice of board, the checklist while building, sending,
// and for moderators the review of what has been sent. None of it is needed
// to draw the board, so it is loaded the first time one of these is wanted.
//
// A maker gives no name, title or other text: a puzzle is a sculpture, and
// its only credit is the maker's username.

import {
  parseMakePuzzleResponse,
  parseReviewResponse,
  type ReviewDecision,
  type ReviewPuzzle,
  type ReviewResponse,
} from '../shared/api';
import { COMMUNITY_BOARDS, PAR_REFUSALS, type CommunityBoard, type ParRefusal } from '../shared/community';
import type { CommunityBar } from './communityBar';
import { boardLabel, checklist, lastPuzzleText } from './maker';
import { paintSilhouette } from './paint';
import type { Store } from './store';

const PUZZLES_URL = '/api/community/puzzles';
const REVIEW_URL = '/api/community/review';
/** Longest side of a silhouette panel on the review card, in CSS px. */
const REVIEW_PANEL_PX = 104;

export const MAKE_INTRO =
  'Build a sculpture on an empty board. Its two shadows become the puzzle. If a moderator approves it, it is used for a Sunday puzzle, with your username as the credit.';
export const SEND_QUESTION =
  'Send this puzzle? How many blocks it takes to solve is worked out for you, and a moderator looks at it before it is used.';
export const SENDING = 'Sending…';
export const sentText = (par: number): string =>
  `Sent for review. It takes ${par} blocks to solve. A moderator will look at it.`;
export const SEND_FAILED = "Couldn't send it. Try again.";
export const NOTHING_WAITING = 'Nothing is waiting for review.';
/** Where a moderator is in the line of waiting puzzles: "2 of 5". */
export const positionText = (position: number, waiting: number): string => `${position} of ${waiting}`;
/** Why a player with a puzzle waiting cannot send another: the server's own words for it. */
const STILL_WAITING = 'Your last puzzle is still waiting for review.';

export type CommunityActions = {
  /** Replays the warm-up. */
  howToPlay: () => void;
  /** Puts an empty board of this kind up to build a puzzle on. */
  startMaking: (board: CommunityBoard) => void;
  /** Ends making and puts the player's own board back as it was. */
  stopMaking: () => void;
  /** Puts a waiting puzzle on the board, for a moderator to try before deciding. */
  tryPuzzle: (puzzle: ReviewPuzzle) => void;
};

export type CommunityUi = {
  openHelp: () => void;
  openMake: () => void;
  openReview: () => void;
  /** Runs the checklist for a puzzle being made on `store`. Returns a function that takes it away. */
  runMaker: (store: Store, board: CommunityBoard) => () => void;
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

const canvas = (id: string): HTMLCanvasElement => {
  const found = element(id);
  if (!(found instanceof HTMLCanvasElement)) throw new Error(`#${id} is not a canvas`);
  return found;
};

/** `bar` holds what the caller may do, and shows a moderator how many puzzles wait. */
export const createCommunityUi = (actions: CommunityActions, bar: CommunityBar): CommunityUi => {
  // --- Help: the warm-up again, or make a puzzle --------------------------------
  const helpLayer = element('help-layer');
  button('help-close').addEventListener('click', () => {
    helpLayer.hidden = true;
  });
  button('help-how').addEventListener('click', () => {
    helpLayer.hidden = true;
    actions.howToPlay();
  });

  // --- Choosing a board ---------------------------------------------------------
  const makeLayer = element('make-layer');
  const makeLast = element('make-last');
  const makeText = element('make-text');
  const makeBoards = element('make-boards');
  const boardButtons = [button('make-4'), button('make-5')];
  COMMUNITY_BOARDS.forEach((board, index) => {
    const choose = boardButtons[index];
    if (!choose) return;
    choose.textContent = boardLabel(board.size);
    choose.addEventListener('click', () => {
      makeLayer.hidden = true;
      actions.startMaking(board);
    });
  });
  button('make-close').addEventListener('click', () => {
    makeLayer.hidden = true;
  });
  const openMake = (): void => {
    const { canMake, why, last } = bar.getStatus();
    // First, what became of the last puzzle they sent, if they have sent one.
    makeLast.hidden = last === null;
    makeLast.textContent = last === null ? '' : lastPuzzleText(last, canMake);
    // A puzzle still waiting is the whole reason they cannot send another, so it is said once.
    makeText.hidden = last?.status === 'waiting' && !canMake;
    // A player who may not make one yet is told why, in the server's words.
    makeText.textContent = canMake ? MAKE_INTRO : (why ?? 'You cannot make a puzzle just now.');
    makeBoards.hidden = !canMake;
    makeLayer.hidden = false;
  };
  button('help-make').addEventListener('click', () => {
    helpLayer.hidden = true;
    openMake();
  });

  // --- Sending ------------------------------------------------------------------
  const sendLayer = element('send-layer');
  const sendText = element('send-text');
  const sendConfirm = button('send-confirm');
  const sendClose = button('send-close');
  /** What Send does when confirmed, and what closing the card does: set while a puzzle is being made. */
  let confirmSend: (() => void) | null = null;
  let afterSend: (() => void) | null = null;
  sendConfirm.addEventListener('click', () => confirmSend?.());
  sendClose.addEventListener('click', () => {
    sendLayer.hidden = true;
    afterSend?.();
    afterSend = null;
  });

  /**
   * Sends the sculpture. The server works the puzzle out and decides. When it
   * is sent back because of how many blocks it takes to solve, `sentBack` is
   * told which way, and the player goes on building.
   */
  const send = async (
    board: CommunityBoard,
    blocks: ReadonlySet<string>,
    sentBack: (refusal: ParRefusal) => void
  ): Promise<void> => {
    sendText.textContent = SENDING;
    sendConfirm.hidden = true;
    sendClose.disabled = true;
    try {
      const response = await fetch(PUZZLES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: board.size, blocks: [...blocks] }),
      });
      const body: unknown = await response.json();
      const parsed = parseMakePuzzleResponse(body);
      if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
      if (parsed.status === 'sent') {
        sendText.textContent = sentText(parsed.par);
        sendClose.textContent = 'Back to my board';
        // Their one waiting slot is now taken, until a moderator has looked.
        bar.setStatus({ ...bar.getStatus(), canMake: false, why: STILL_WAITING, last: { status: 'waiting' } });
        afterSend = actions.stopMaking;
      } else {
        // The server's own sentence says which rule stopped it, and for par which way to go.
        sendText.textContent = parsed.message;
        sendClose.textContent = 'Keep building';
        const refusal = PAR_REFUSALS.find((known) => known === parsed.reason);
        if (refusal) sentBack(refusal);
      }
    } catch (error) {
      console.error(`Could not send the puzzle to ${PUZZLES_URL}:`, error);
      sendText.textContent = SEND_FAILED;
      sendConfirm.hidden = false;
      sendClose.textContent = 'Keep building';
    }
    sendClose.disabled = false;
  };

  // --- The checklist while building -----------------------------------------------
  const makerPanel = element('maker');
  const makerList = element('maker-list');
  const makerSend = button('maker-send');
  const makerLeave = button('maker-leave');
  let leaveMaker: (() => void) | null = null;
  let askToSend: (() => void) | null = null;
  makerLeave.addEventListener('click', () => leaveMaker?.());
  makerSend.addEventListener('click', () => askToSend?.());

  const runMaker = (store: Store, board: CommunityBoard): (() => void) => {
    /** The sculpture the server sent back over par, and which way: said in the note until it changes. */
    let sentBack: { blocks: ReadonlySet<string>; refusal: ParRefusal } | null = null;

    const render = (): void => {
      const { blocks } = store.getState();
      const list = checklist(blocks, board, sentBack && sentBack.blocks === blocks ? sentBack.refusal : null);
      const rules = list.lines.map((line) => {
        const item = document.createElement('li');
        item.textContent = line.text;
        // Met or not yet met: said in words for a screen reader too.
        item.className = line.met ? 'met' : '';
        item.setAttribute('aria-label', `${line.text}: ${line.met ? 'done' : 'not yet'}`);
        return item;
      });
      // Not a rule to tick: how many blocks it takes to solve is only settled when the puzzle is sent.
      const note = document.createElement('li');
      note.className = 'note';
      note.textContent = list.note;
      makerList.replaceChildren(...rules, note);
      makerSend.disabled = !list.ready;
    };

    leaveMaker = actions.stopMaking;
    askToSend = () => {
      sendText.textContent = SEND_QUESTION;
      sendConfirm.hidden = false;
      sendClose.textContent = 'Keep building';
      afterSend = null;
      confirmSend = () => {
        const { blocks } = store.getState();
        void send(board, blocks, (refusal) => {
          sentBack = { blocks, refusal };
          render();
        });
      };
      sendLayer.hidden = false;
    };
    makerPanel.hidden = false;
    const unsubscribe = store.subscribe(render);
    render();
    return () => {
      unsubscribe();
      leaveMaker = null;
      askToSend = null;
      confirmSend = null;
      makerPanel.hidden = true;
      sendLayer.hidden = true;
    };
  };

  // --- Review, for moderators -----------------------------------------------------
  const reviewLayer = element('review-layer');
  const reviewStatus = element('review-status');
  const reviewBody = element('review-body');
  const reviewWaiting = element('review-waiting');
  const reviewSize = element('review-size');
  const reviewMaker = element('review-maker');
  const reviewDecide = element('review-decide');
  const reviewTry = button('review-try');
  const reviewPrev = button('review-prev');
  const reviewNext = button('review-next');
  const decideButtons = [button('review-approve'), button('review-reject')];
  const stepButtons = [reviewPrev, reviewNext];
  let shown: ReviewPuzzle | null = null;
  /** The place in the line the moderator is looking at, from 1: kept while they try a puzzle on the board. */
  let at = 1;

  const showReview = (reply: ReviewResponse | null): void => {
    for (const decide of decideButtons) decide.disabled = false;
    if (!reply || reply.status !== 'ok') {
      shown = null;
      reviewStatus.textContent = reply ? reply.message : "Couldn't load the puzzles waiting.";
      reviewStatus.hidden = false;
      reviewBody.hidden = true;
      reviewDecide.hidden = true;
      reviewTry.hidden = true;
      return;
    }
    bar.showWaiting(reply.waiting);
    shown = reply.puzzle;
    at = Math.max(reply.position, 1);
    reviewStatus.hidden = shown !== null;
    reviewStatus.textContent = NOTHING_WAITING;
    reviewBody.hidden = shown === null;
    reviewDecide.hidden = shown === null;
    reviewTry.hidden = shown === null;
    if (!shown) return;
    reviewWaiting.textContent = positionText(reply.position, reply.waiting);
    reviewPrev.disabled = reply.position <= 1;
    reviewNext.disabled = reply.position >= reply.waiting;
    paintSilhouette(canvas('review-front'), 'front', shown.front, false, REVIEW_PANEL_PX);
    paintSilhouette(canvas('review-side'), 'side', shown.side, false, REVIEW_PANEL_PX);
    reviewSize.textContent = `${boardLabel(shown.size)} · par ${shown.par}`;
    reviewMaker.textContent = `by u/${shown.maker}`;
  };

  /** Asks for the puzzle at the place being looked at, deciding the one shown first when a decision is given. */
  const askReview = async (decision?: ReviewDecision): Promise<void> => {
    try {
      const response =
        decision && shown
          ? await fetch(REVIEW_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: shown.id, decision, at }),
            })
          : await fetch(`${REVIEW_URL}?at=${at}`);
      const body: unknown = await response.json();
      const parsed = parseReviewResponse(body);
      if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
      showReview(parsed);
    } catch (error) {
      console.error(`Could not reach ${REVIEW_URL}:`, error);
      showReview(null);
    }
  };

  const openReview = (): void => {
    reviewStatus.textContent = 'Loading…';
    reviewStatus.hidden = false;
    reviewBody.hidden = true;
    reviewDecide.hidden = true;
    reviewTry.hidden = true;
    reviewLayer.hidden = false;
    void askReview();
  };
  decideButtons.forEach((decide, index) => {
    decide.addEventListener('click', () => {
      for (const other of decideButtons) other.disabled = true;
      void askReview(index === 0 ? 'approve' : 'reject');
    });
  });
  // Back and on along the line. The puzzle shown stays until the next one arrives.
  stepButtons.forEach((step, index) => {
    step.addEventListener('click', () => {
      for (const other of stepButtons) other.disabled = true;
      at = Math.max(at + (index === 0 ? -1 : 1), 1);
      void askReview();
    });
  });
  reviewTry.addEventListener('click', () => {
    if (!shown) return;
    reviewLayer.hidden = true;
    actions.tryPuzzle(shown);
  });
  button('review-close').addEventListener('click', () => {
    reviewLayer.hidden = true;
  });

  return {
    openHelp: () => {
      helpLayer.hidden = false;
    },
    openMake,
    openReview,
    runMaker,
  };
};
