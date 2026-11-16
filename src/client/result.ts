// The result card shown over the board after submitting. Plain HTML; the data
// comes fresh from the server every time the card opens.

import type { JoinChoice, LeaderboardRow, MakerResult, Result } from '../shared/api';
import { rarityPercent } from '../shared/share';
import { blockText } from './count';
import { showStars } from './stars';

// --- Wording (no DOM, so it can be tested) ---------------------------------------

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export const ordinal = (value: number): string => {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
};

/** "3rd of 340", or "Tied 1st with 41 others" when the rank is shared. */
export const rankText = ({ rank, tied, solvers }: Pick<Result, 'rank' | 'tied' | 'solvers'>): string => {
  if (tied <= 1) return `${ordinal(rank)} of ${solvers}`;
  const others = tied - 1;
  return `Tied ${ordinal(rank)} with ${others} ${others === 1 ? 'other' : 'others'}`;
};

/** One line on how common the player's exact sculpture is. */
export const rarityText = ({ same, share, smallSample }: Result['rarity']): string => {
  if (smallSample) return "You're among the first solvers";
  if (same <= 1) return 'Only you built this';
  return `Same as ${rarityPercent(share)}% of solvers`;
};

/** "Streak: 3", with the best streak added only when it is higher. */
export const streakText = ({ current, best }: Result['streak']): string =>
  best > current ? `Streak: ${current} · Best: ${best}` : `Streak: ${current}`;

export { blockText };

/** "Community best: 8 blocks", marked when someone has beaten par. */
export const recordText = ({ blocks, underPar }: Result['record']): string =>
  `Community best: ${blockText(blocks)}${underPar ? ' (under par)' : ''}`;

/**
 * The rows that fit in `room` when the row at `last` must be the final one
 * showing: which row comes first, and their height together. Always whole
 * rows, and always at least the last one.
 */
export const wholeRowsEnding = (
  heights: readonly number[],
  last: number,
  room: number
): { first: number; height: number } => {
  let first = Math.min(Math.max(last, 0), Math.max(heights.length - 1, 0));
  let height = heights[first] ?? 0;
  while (first > 0 && height + (heights[first - 1] ?? 0) <= room) {
    first -= 1;
    height += heights[first] ?? 0;
  }
  return { first, height };
};

/** Where the Share button stands. */
export type ShareState = 'ready' | 'sharing' | 'shared' | 'failed';

const SHARE_BUTTON_TEXT: Record<ShareState, string> = {
  ready: 'Share result',
  sharing: 'Sharing\u2026',
  shared: 'Shared',
  failed: 'Retry share',
};

export const shareButtonText = (state: ShareState): string => SHARE_BUTTON_TEXT[state];

/** The Share button can be tapped only when there is something left to do. */
export const canShare = (state: ShareState): boolean => state === 'ready' || state === 'failed';

// --- The maker's view of their own puzzle ---------------------------------------

export const MAKER_TITLE = 'Your puzzle';
export const SOLVED_TITLE = 'Solved';

/** Said plainly on the card: the maker can look, and is never ranked. */
export const MAKER_NOTE = 'You made this puzzle, so you are not ranked on it.';

/** How the players are getting on with it. */
export const makerSolversText = (solvers: number): string => {
  if (solvers <= 0) return 'Nobody has solved it yet';
  return solvers === 1 ? '1 player has solved it' : `${solvers} players have solved it`;
};

/** Whether a result is the maker's view of their puzzle: it has no rank, because a maker is never ranked. */
export const isMakerResult = (result: Result | MakerResult): boolean => !('rank' in result);

export const JOIN_PROMPT_TEXT = 'Join the community for daily puzzles.';
export const JOIN_FAILED_TEXT = "Couldn't join. Try again.";

// --- The card --------------------------------------------------------------------

/**
 * What a tap on Share or Join came to. 'declined' means the player said no
 * when Reddit asked for permission, so nothing was done and nothing failed.
 */
export type ActionOutcome = 'done' | 'declined' | 'failed';

export type ResultCardOptions = {
  /**
   * Fetches the caller's result, or for the maker of the puzzle their view of
   * how players are doing. Resolves to null when it cannot be had; never throws.
   */
  load: () => Promise<Result | MakerResult | null>;
  /** Opens the way to making a puzzle. It runs after the card has closed. */
  openMake: () => void;
  /** The card's main next step. It runs after the card has closed. */
  openGallery: () => void;
  /** Posts the result as a comment. Gets the tap itself, which Reddit's permission check needs. Never throws. */
  share: (tap: Event) => Promise<ActionOutcome>;
  /** Sends the player's answer to the join prompt. Never throws. */
  answerJoin: (choice: JoinChoice, tap: Event) => Promise<ActionOutcome>;
};

export type ResultCard = {
  /** Shows the card and loads fresh data into it. */
  open: () => void;
  close: () => void;
  /** Closes the card and removes its listeners. */
  dispose: () => void;
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

const cell = (className: string, text: string): HTMLSpanElement => {
  const span = document.createElement('span');
  span.className = className;
  // textContent, never innerHTML: usernames come from other players.
  span.textContent = text;
  return span;
};

const rowItem = (row: LeaderboardRow): HTMLLIElement => {
  const item = document.createElement('li');
  item.className = row.you ? 'result-row you' : 'result-row';
  item.append(
    cell('result-row-rank', String(row.rank)),
    cell('result-row-name', row.you ? `${row.username} (you)` : row.username),
    cell('result-row-blocks', String(row.blocks))
  );
  return item;
};

/** Wires the result card to one game. */
export const createResultCard = ({ load, openGallery, openMake, share, answerJoin }: ResultCardOptions): ResultCard => {
  const layer = element('result-layer');
  const status = element('result-status');
  const body = element('result-body');
  const stars = element('result-stars');
  const blocks = element('result-blocks');
  const underPar = element('result-under');
  const rank = element('result-rank');
  const rarity = element('result-rarity');
  const streak = element('result-streak');
  const record = element('result-record');
  const gallery = element('result-gallery');
  const list = element('result-list');
  const retry = element('result-retry');
  const close = element('result-close');
  const shareButton = button('result-share');
  const joinBox = element('result-join');
  const joinText = element('result-join-text');
  const joinYes = button('result-join-yes');
  const joinNo = button('result-join-no');

  const listeners = new AbortController();
  // Counts loads, so a slow reply for an earlier opening is dropped.
  let latest = 0;

  let shareState: ShareState = 'ready';
  const setShareState = (state: ShareState): void => {
    shareState = state;
    shareButton.textContent = shareButtonText(state);
    shareButton.disabled = !canShare(state);
    // "Shared" carries a drawn tick.
    shareButton.classList.toggle('ticked', state === 'shared');
  };

  const setJoinBusy = (busy: boolean, text: string): void => {
    joinYes.disabled = busy;
    joinNo.disabled = busy;
    joinText.textContent = text;
  };

  const title = element('result-title');
  const make = element('result-make');

  /** The card for the maker of the puzzle: how players are doing, and no place of their own. */
  const showAsMaker = (result: MakerResult): void => {
    title.textContent = MAKER_TITLE;
    stars.hidden = true;
    underPar.hidden = true;
    blocks.textContent = makerSolversText(result.solvers);
    rank.textContent = `Par ${result.par}`;
    rarity.textContent = MAKER_NOTE;
    streak.hidden = true;
    record.hidden = result.record === null;
    if (result.record) record.textContent = recordText(result.record);
    list.replaceChildren(...result.leaderboard.map(rowItem));
    list.hidden = result.leaderboard.length === 0;
    // Nothing of the maker's own to share, and no prompt to join.
    shareButton.hidden = true;
    joinBox.hidden = true;
  };

  const show = (result: Result | MakerResult): void => {
    // A player's own result has a rank; the maker's view has none.
    if (!('rank' in result)) {
      showAsMaker(result);
      return;
    }
    title.textContent = SOLVED_TITLE;
    stars.hidden = false;
    streak.hidden = false;
    record.hidden = false;
    list.hidden = false;
    showStars(stars, result.stars);
    blocks.textContent = `${blockText(result.blocks)} · par ${result.par}`;
    underPar.hidden = result.blocks >= result.par;
    rank.textContent = rankText(result);
    rarity.textContent = rarityText(result.rarity);
    streak.textContent = streakText(result.streak);
    record.textContent = recordText(result.record);
    // A share in flight keeps its own state; otherwise the server knows best.
    if (shareState !== 'sharing') setShareState(result.shared ? 'shared' : 'ready');
    shareButton.hidden = false;
    joinBox.hidden = !result.joinPrompt;
    setJoinBusy(false, JOIN_PROMPT_TEXT);

    list.replaceChildren(...result.leaderboard.map(rowItem));
    if (result.own) {
      const gap = document.createElement('li');
      gap.className = 'result-row-gap';
      gap.textContent = '⋯';
      gap.setAttribute('aria-hidden', 'true');
      list.append(gap, rowItem(result.own));
    }
  };

  /**
   * On a short screen the list is clipped. It is cut to whole rows, never
   * through the middle of one, and scrolled so the player's row is the last
   * one showing.
   */
  const revealOwnRow = (): void => {
    // Back to the height the card gives it, to measure how much room there is.
    list.style.height = '';
    const rows = [...list.children].filter((row): row is HTMLElement => row instanceof HTMLElement);
    const own = rows.find((row) => row.classList.contains('you'));
    const room = list.clientHeight;
    if (rows.length === 0 || list.scrollHeight <= room + 1) {
      list.scrollTop = 0;
      return;
    }
    // Count back from the player's row (or the last row) for as many whole rows as fit.
    const last = own ? rows.indexOf(own) : rows.length - 1;
    const bottom = wholeRowsEnding(rows.map((row) => row.offsetHeight), last, room);
    const first = rows[bottom.first];
    const end = rows[last];
    if (!first || !end) return;
    list.style.height = `${bottom.height + (list.offsetHeight - list.clientHeight)}px`;
    list.scrollTop = first.offsetTop;
  };

  const refresh = (): void => {
    const request = ++latest;
    status.textContent = 'Loading results…';
    status.hidden = false;
    body.hidden = true;
    retry.hidden = true;
    void load().then((result) => {
      if (request !== latest || listeners.signal.aborted) return;
      if (!result) {
        status.textContent = "Couldn't load the results.";
        retry.hidden = false;
        return;
      }
      show(result);
      status.hidden = true;
      body.hidden = false;
      // After the body is visible, so the list has a size to measure.
      revealOwnRow();
    });
  };

  const hide = (): void => {
    latest += 1;
    layer.hidden = true;
  };

  const onShare = async (tap: Event): Promise<void> => {
    if (!canShare(shareState)) return;
    setShareState('sharing');
    const outcome = await share(tap);
    if (listeners.signal.aborted) return;
    setShareState(outcome === 'done' ? 'shared' : outcome === 'failed' ? 'failed' : 'ready');
  };

  const onJoin = async (tap: Event): Promise<void> => {
    setJoinBusy(true, 'Joining\u2026');
    const outcome = await answerJoin('join', tap);
    if (listeners.signal.aborted) return;
    // Joined: the prompt has done its job and never comes back.
    if (outcome === 'done') joinBox.hidden = true;
    else setJoinBusy(false, outcome === 'failed' ? JOIN_FAILED_TEXT : JOIN_PROMPT_TEXT);
  };

  const onDismiss = (tap: Event): void => {
    // Gone at once. If the answer does not reach the server, the prompt is
    // offered again another time, which is the safe way round.
    joinBox.hidden = true;
    void answerJoin('dismiss', tap);
  };

  shareButton.addEventListener('click', (tap) => void onShare(tap), { signal: listeners.signal });
  joinYes.addEventListener('click', (tap) => void onJoin(tap), { signal: listeners.signal });
  joinNo.addEventListener('click', onDismiss, { signal: listeners.signal });
  // The room for the list changes when the screen turns or resizes; cut it to whole rows again.
  window.addEventListener(
    'resize',
    () => {
      if (!layer.hidden && !body.hidden) revealOwnRow();
    },
    { signal: listeners.signal }
  );
  make.addEventListener(
    'click',
    () => {
      hide();
      openMake();
    },
    { signal: listeners.signal }
  );
  retry.addEventListener('click', refresh, { signal: listeners.signal });
  close.addEventListener('click', hide, { signal: listeners.signal });
  gallery.addEventListener(
    'click',
    () => {
      hide();
      openGallery();
    },
    { signal: listeners.signal }
  );

  return {
    open: () => {
      layer.hidden = false;
      refresh();
    },
    close: hide,
    dispose: () => {
      hide();
      listeners.abort();
    },
  };
};
