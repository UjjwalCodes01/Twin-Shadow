// The inline view shown in the feed: the first thing anyone sees, and the
// start screen. It shows the day's two shadows on paper, the player's own
// state, and one button. No three.js here, so it appears fast.

import { requestExpandedMode } from '@devvit/web/client';
import { parseSplashResponse, type SplashResponse } from '../shared/api';
import { parseSilhouette, type CellState } from '../shared/logic';
import { paintWall, type WallKind } from './paint';
import {
  buttonText,
  CREATOR_CREDIT,
  DESCRIPTION,
  headingText,
  playedText,
  solversText,
  streakText,
} from './splashText';
import { showStars } from './stars';
import { applyTheme, loadFonts } from './theme';

const SPLASH_URL = '/api/splash';
/** Longest side of a silhouette panel, in CSS px. */
const PANEL_PX = 108;
const MAX_PANEL_RATIO = 3;
/** Shown when the server says this post has no puzzle: the game's own message. */
const NO_PUZZLE = 'This post has no puzzle. Open a newer Twin Shadows post.';

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

applyTheme();

const button = element('play-button');
element('splash-description').textContent = DESCRIPTION;
element('splash-credit').textContent = CREATOR_CREDIT;

button.addEventListener('click', (event) => {
  requestExpandedMode(event, 'game');
});

/**
 * Paints one silhouette as a small sheet of paper, exactly as the game's
 * walls and panels are painted. Before the puzzle is solved it shows the
 * shape wanted; after, the shape filled with shadow.
 */
const paintPanel = (id: string, kind: WallKind, rows: readonly string[], solved: boolean): void => {
  const canvas = element(id);
  if (!(canvas instanceof HTMLCanvasElement)) return;
  // Top row first, as the silhouette is written and as the painter wants it.
  const grid = [...parseSilhouette(rows)].reverse();
  const columns = grid[0]?.length ?? 0;
  if (columns === 0) return;
  const cellPx = Math.floor(PANEL_PX / Math.max(columns, grid.length));
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PANEL_RATIO);
  canvas.width = Math.round(columns * cellPx * ratio);
  canvas.height = Math.round(grid.length * cellPx * ratio);
  canvas.style.width = `${columns * cellPx}px`;
  canvas.style.height = `${grid.length * cellPx}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  const lit: CellState = solved ? 'match' : 'missing';
  paintWall(context, {
    kind,
    columns,
    rows: grid.length,
    cell: cellPx * ratio,
    states: grid.map((row) => row.map((wanted): CellState => (wanted ? lit : 'empty'))),
    unit: ratio,
  });
};

const show = (splash: SplashResponse): void => {
  const { played, streak, solvers } = splash;
  element('splash-heading').textContent = headingText(splash);

  paintPanel('splash-front', 'front', splash.front, played !== null);
  paintPanel('splash-side', 'side', splash.side, played !== null);
  element('splash-panels').hidden = false;

  // The player's own state: nothing for one who has not played or is logged out.
  const playedLine = element('splash-played');
  playedLine.hidden = played === null;
  if (played) {
    showStars(element('splash-stars'), played.stars);
    element('splash-result').textContent = playedText(played);
  }
  // A streak, when there is one, and how many have solved the post.
  element('splash-stats').textContent = [streakText(streak), solversText(solvers)]
    .filter((part) => part !== null)
    .join(' · ');
  element('splash-state').hidden = false;

  button.textContent = buttonText(played);
};

const load = async (): Promise<void> => {
  try {
    const response = await fetch(SPLASH_URL);
    if (response.status === 404) {
      // The server knows this post and has no puzzle for it: nothing to play.
      const notice = element('splash-notice');
      notice.textContent = NO_PUZZLE;
      notice.hidden = false;
      button.hidden = true;
      return;
    }
    const body: unknown = await response.json();
    const splash = parseSplashResponse(body);
    if (!splash) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    // The panels carry no lettering, but the page does: wait for the font so
    // nothing shifts once it arrives. It never rejects.
    await loadFonts();
    show(splash);
  } catch (error) {
    // The name, the description and Play are already on the page, and the
    // game reports its own errors, so a failure here needs no message.
    console.error(`Could not load ${SPLASH_URL}:`, error);
  }
};

void load();
