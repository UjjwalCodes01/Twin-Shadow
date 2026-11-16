// The page's first script, kept small so it runs at once. It does two things
// at the same moment: asks the server for this post's puzzle, and fetches the
// game itself (play.ts, with the 3D board). Neither waits for the other, so
// the board is drawn as soon as the slower of the two has arrived.

import { PUZZLE_URL, retryButton, setLoadState } from './loadState';
import { applyTheme } from './theme';

// The page takes its colours and fonts from theme.ts, and the fonts start loading here.
applyTheme();

// A local build opened with ?debug=1 has no server, and starts from a bundled state.
const local = new URLSearchParams(window.location.search).get('debug') === '1';

/** Asks for the post's puzzle. The answer, or the failure, is read by the game once it has loaded. */
const askForPuzzle = (): Promise<Response> | null => {
  if (local) return null;
  const asked = fetch(PUZZLE_URL);
  // Not handled here; this only stops the browser reporting a failure nobody has read yet.
  asked.catch(() => {});
  return asked;
};

const load = async (asked: Promise<Response> | null): Promise<void> => {
  setLoadState('loading');
  try {
    const { start } = await import('./play');
    start(asked);
  } catch (error) {
    // The game's own file did not arrive. Retry fetches it again, and asks for the puzzle again.
    console.error('Could not load the game:', error);
    setLoadState('error');
    retryButton.onclick = () => void load(askForPuzzle());
  }
};

void load(askForPuzzle());
