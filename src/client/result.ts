// The result card shown over the board after submitting. Plain HTML; the data
// comes fresh from the server every time the card opens.

import type { LeaderboardRow, Result } from '../shared/api';

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
  return `Same as ${Math.max(1, Math.round(share * 100))}% of solvers`;
};

/** "Streak: 3", with the best streak added only when it is higher. */
export const streakText = ({ current, best }: Result['streak']): string =>
  best > current ? `Streak: ${current} · Best: ${best}` : `Streak: ${current}`;

export const starText = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(3 - stars);

export const blockText = (count: number): string => `${count} ${count === 1 ? 'block' : 'blocks'}`;

// --- The card --------------------------------------------------------------------

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

/**
 * Wires the result card to one game. `load` fetches the caller's result and
 * resolves to null when it cannot be had; it never throws.
 */
export const createResultCard = (load: () => Promise<Result | null>): ResultCard => {
  const layer = element('result-layer');
  const status = element('result-status');
  const body = element('result-body');
  const stars = element('result-stars');
  const blocks = element('result-blocks');
  const underPar = element('result-under');
  const rank = element('result-rank');
  const rarity = element('result-rarity');
  const streak = element('result-streak');
  const list = element('result-list');
  const retry = element('result-retry');
  const close = element('result-close');

  const listeners = new AbortController();
  // Counts loads, so a slow reply for an earlier opening is dropped.
  let latest = 0;

  const show = (result: Result): void => {
    stars.textContent = starText(result.stars);
    stars.setAttribute('aria-label', `${result.stars} of 3 stars`);
    blocks.textContent = `${blockText(result.blocks)} · par ${result.par}`;
    underPar.hidden = result.blocks >= result.par;
    rank.textContent = rankText(result);
    rarity.textContent = rarityText(result.rarity);
    streak.textContent = streakText(result.streak);

    list.replaceChildren(...result.leaderboard.map(rowItem));
    if (result.own) {
      const gap = document.createElement('li');
      gap.className = 'result-row-gap';
      gap.textContent = '⋯';
      gap.setAttribute('aria-hidden', 'true');
      list.append(gap, rowItem(result.own));
    }
  };

  /** On a short screen the list is clipped: scroll just far enough to show the player's row. */
  const revealOwnRow = (): void => {
    const own = list.querySelector('.you');
    list.scrollTop = own instanceof HTMLElement ? own.offsetTop + own.offsetHeight - list.clientHeight : 0;
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

  retry.addEventListener('click', refresh, { signal: listeners.signal });
  close.addEventListener('click', hide, { signal: listeners.signal });

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
