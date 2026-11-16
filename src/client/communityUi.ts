// Puzzles made by players, as the game shows them: the help card that leads
// to making one, the choice of board, the checklist while building, sending,
// and for moderators the review of what has been sent.
//
// A maker gives no name, title or other text: a puzzle is a sculpture, and
// its only credit is the maker's username.

import {
  parseMakePuzzleResponse,
  parseReviewResponse,
  type CommunityStatus,
  type ReviewDecision,
  type ReviewPuzzle,
  type ReviewResponse,
} from '../shared/api';
import { COMMUNITY_BOARDS, type CommunityBoard } from '../shared/community';
import { boardLabel, checklist, estimatePar } from './maker';
import { paintSilhouette } from './paint';
import type { Store } from './store';

const PUZZLES_URL = '/api/community/puzzles';
const REVIEW_URL = '/api/community/review';
/** The checklist waits this long after the last change before working out par, which takes a moment. */
const PAR_DELAY_MS = 300;
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
export const reviewLabel = (waiting: number): string => `Review (${waiting})`;
export const waitingText = (waiting: number): string =>
  waiting === 1 ? '1 puzzle waiting' : `${waiting} puzzles waiting`;
export const creditLine = (post: number, maker: string): string => `Puzzle #${post} by u/${maker}`;

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
  /** What the server says the caller may do: make a puzzle, review puzzles. */
  setStatus: (status: CommunityStatus) => void;
  /** Shows who made the puzzle on the board, or nothing for a generated one. */
  setCredit: (post: number, maker: string | null) => void;
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

export const createCommunityUi = (actions: CommunityActions): CommunityUi => {
  let status: CommunityStatus = { canMake: false, why: null, review: null };

  // --- Banner: the maker's credit, and for a moderator the way to the review ---
  const banner = element('banner');
  const credit = element('banner-credit');
  const reviewOpen = button('review-open');
  const syncBanner = (): void => {
    banner.hidden = credit.hidden && reviewOpen.hidden;
  };
  const showWaiting = (waiting: number | null): void => {
    // Only a moderator has a number at all, and the button only shows when something waits.
    reviewOpen.hidden = waiting === null || waiting === 0;
    reviewOpen.textContent = waiting === null ? '' : reviewLabel(waiting);
    syncBanner();
  };

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
    // A player who may not make one yet is told why, in the server's words.
    makeText.textContent = status.canMake ? MAKE_INTRO : (status.why ?? 'You cannot make a puzzle just now.');
    makeBoards.hidden = !status.canMake;
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

  const send = async (board: CommunityBoard, blocks: string[]): Promise<void> => {
    sendText.textContent = SENDING;
    sendConfirm.hidden = true;
    sendClose.disabled = true;
    try {
      const response = await fetch(PUZZLES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: board.size, blocks }),
      });
      const body: unknown = await response.json();
      const parsed = parseMakePuzzleResponse(body);
      if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
      if (parsed.status === 'sent') {
        sendText.textContent = sentText(parsed.par);
        sendClose.textContent = 'Back to my board';
        // Their one waiting slot is now taken, until a moderator has looked.
        status = { ...status, canMake: false, why: 'Your last puzzle is still waiting for review.' };
        afterSend = actions.stopMaking;
      } else {
        // The server's own sentence says which rule stopped it.
        sendText.textContent = parsed.message;
        sendClose.textContent = 'Keep building';
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
    /** The estimate of par for the sculpture it was worked out for; out of date as soon as that changes. */
    let par: { for: ReadonlySet<string>; value: number | null } | null = null;
    let timer = 0;

    const render = (): void => {
      const { blocks } = store.getState();
      const known = par && par.for === blocks ? par.value : null;
      const list = checklist(blocks, board, known);
      makerList.replaceChildren(
        ...list.lines.map((line) => {
          const item = document.createElement('li');
          item.textContent = line.text;
          // Met, not yet met, or still being worked out: said in words for a screen reader too.
          item.className = line.met === true ? 'met' : line.met === null ? 'working' : '';
          item.setAttribute('aria-label', `${line.text}: ${line.met === true ? 'done' : line.met === null ? 'checking' : 'not yet'}`);
          return item;
        })
      );
      makerSend.disabled = !list.ready;
    };

    const update = (): void => {
      render();
      // Par takes a moment to work out, so it waits until the player pauses.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const { blocks } = store.getState();
        par = { for: blocks, value: estimatePar(blocks, board) };
        render();
      }, PAR_DELAY_MS);
    };

    leaveMaker = actions.stopMaking;
    askToSend = () => {
      sendText.textContent = SEND_QUESTION;
      sendConfirm.hidden = false;
      sendClose.textContent = 'Keep building';
      afterSend = null;
      confirmSend = () => void send(board, [...store.getState().blocks]);
      sendLayer.hidden = false;
    };
    makerPanel.hidden = false;
    const unsubscribe = store.subscribe(update);
    update();
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
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
  const decideButtons = [button('review-approve'), button('review-reject')];
  let shown: ReviewPuzzle | null = null;

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
    showWaiting(reply.waiting);
    shown = reply.puzzle;
    reviewStatus.hidden = shown !== null;
    reviewStatus.textContent = NOTHING_WAITING;
    reviewBody.hidden = shown === null;
    reviewDecide.hidden = shown === null;
    reviewTry.hidden = shown === null;
    if (!shown) return;
    reviewWaiting.textContent = waitingText(reply.waiting);
    paintSilhouette(canvas('review-front'), 'front', shown.front, false, REVIEW_PANEL_PX);
    paintSilhouette(canvas('review-side'), 'side', shown.side, false, REVIEW_PANEL_PX);
    reviewSize.textContent = `${boardLabel(shown.size)} · par ${shown.par}`;
    reviewMaker.textContent = `by u/${shown.maker}`;
  };

  const askReview = async (decision?: ReviewDecision): Promise<void> => {
    try {
      const response =
        decision && shown
          ? await fetch(REVIEW_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: shown.id, decision }),
            })
          : await fetch(REVIEW_URL);
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
  reviewOpen.addEventListener('click', openReview);
  decideButtons.forEach((decide, index) => {
    decide.addEventListener('click', () => {
      for (const other of decideButtons) other.disabled = true;
      void askReview(index === 0 ? 'approve' : 'reject');
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
    setStatus: (next) => {
      status = next;
      showWaiting(next.review);
    },
    setCredit: (post, maker) => {
      credit.hidden = maker === null;
      credit.textContent = maker === null ? '' : creditLine(post, maker);
      syncBanner();
    },
    openHelp: () => {
      helpLayer.hidden = false;
    },
    openMake,
    openReview,
    runMaker,
  };
};
