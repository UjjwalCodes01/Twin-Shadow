// The slim line under the readout: who made the puzzle on the board, and for
// a moderator the way to the puzzles waiting for review. It also holds what
// the server said the caller may do about puzzles made by players. Small, and
// needed from the first draw; the cards it leads to are loaded when wanted.

import type { CommunityStatus } from '../shared/api';

export const reviewLabel = (waiting: number): string => `Review (${waiting})`;
export const creditLine = (post: number, maker: string): string => `Puzzle #${post} by u/${maker}`;

export type CommunityBar = {
  /** What the server says the caller may do: make a puzzle, review puzzles. */
  setStatus: (status: CommunityStatus) => void;
  getStatus: () => CommunityStatus;
  /** Shows who made the puzzle on the board, or nothing for a generated one. */
  setCredit: (post: number, maker: string | null) => void;
  /** Shows how many puzzles wait for review. Only a moderator has a number at all. */
  showWaiting: (waiting: number | null) => void;
};

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

/** `openReview` runs when a moderator taps the count of waiting puzzles. */
export const createCommunityBar = (openReview: () => void): CommunityBar => {
  let status: CommunityStatus = { canMake: false, why: null, last: null, review: null };
  const banner = element('banner');
  const credit = element('banner-credit');
  const reviewOpen = element('review-open');
  const syncBanner = (): void => {
    banner.hidden = credit.hidden && reviewOpen.hidden;
  };
  const showWaiting = (waiting: number | null): void => {
    // The button only shows when something waits.
    reviewOpen.hidden = waiting === null || waiting === 0;
    reviewOpen.textContent = waiting === null ? '' : reviewLabel(waiting);
    syncBanner();
  };
  reviewOpen.addEventListener('click', openReview);

  return {
    setStatus: (next) => {
      status = next;
      showWaiting(next.review);
    },
    getStatus: () => status,
    setCredit: (post, maker) => {
      credit.hidden = maker === null;
      credit.textContent = maker === null ? '' : creditLine(post, maker);
      syncBanner();
    },
    showWaiting,
  };
};
