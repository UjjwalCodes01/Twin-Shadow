// What the page shows while the game is on its way: loading, ready, or what
// went wrong. Shared by the page's small first script and the game itself.

export const PUZZLE_URL = '/api/puzzle';

/** 'missing' is a post with no puzzle saved for it: asking again cannot help, so there is no Retry. */
export type LoadState = 'loading' | 'ready' | 'error' | 'missing';

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

const notice = element('notice');
const noticeText = element('notice-text');
/** Shown only for an error. Whoever is loading sets what it does. */
export const retryButton = element('retry');

const NOTICES: Record<LoadState, string> = {
  loading: 'Loading puzzle…',
  ready: '',
  error: "Couldn't load this puzzle.",
  missing: 'This post has no puzzle. Open a newer Twin Shadows post.',
};

// CSS shows the HUD only when the page is ready.
export const setLoadState = (state: LoadState): void => {
  document.body.dataset.state = state;
  notice.hidden = state === 'ready';
  retryButton.hidden = state !== 'error';
  noticeText.textContent = NOTICES[state];
};
