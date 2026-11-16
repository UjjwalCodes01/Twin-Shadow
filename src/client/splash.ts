// The inline view shown in the feed: the first thing anyone sees, and the
// start screen. It shows the day's two shadows on paper, the player's own
// state, and one button. No three.js here, so it appears fast.

import { requestExpandedMode } from '@devvit/web/client';
import { parseSplashResponse, type SplashResponse } from '../shared/api';
import { paintCluster, paintSilhouette, type WallKind } from './paint';
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
 * Draws the cluster of blocks at whatever size the stylesheet has given its
 * canvas. Left out, by the stylesheet, where it would crowd the panels.
 */
const paintArt = (): void => {
  const art = element('splash-art');
  if (!(art instanceof HTMLCanvasElement)) return;
  const { width, height } = art.getBoundingClientRect();
  const context = art.getContext('2d');
  if (width === 0 || height === 0 || !context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  art.width = Math.round(width * ratio);
  art.height = Math.round(height * ratio);
  paintCluster(context, art.width, art.height);
};
paintArt();
window.addEventListener('resize', paintArt);

/** Paints one of the day's two shadows on its canvas. */
const paintPanel = (id: string, kind: WallKind, rows: readonly string[], solved: boolean): void => {
  const canvas = element(id);
  if (canvas instanceof HTMLCanvasElement) paintSilhouette(canvas, kind, rows, solved, PANEL_PX);
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
