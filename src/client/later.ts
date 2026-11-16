// What the game needs only after the board is up: the result card, the
// gallery, sharing and joining, and the cards for making and reviewing
// puzzles. One file, fetched in the background once the board has been drawn
// and waited for by the first tap that wants any of it, so none of it holds
// back the first draw.

import { canRunAsUser } from '@devvit/web/client';
import {
  parseGalleryResponse,
  parseJoinResponse,
  parseResultResponse,
  parseShareResponse,
  type Gallery,
  type GallerySort,
  type JoinChoice,
  type MakerResult,
  type Result,
} from '../shared/api';
import type { ActionOutcome } from './result';

export { createCommunityUi } from './communityUi';
export { createGallery } from './gallery';
export { createResultCard } from './result';

const RESULT_URL = '/api/result';
const GALLERY_URL = '/api/gallery';
const SHARE_URL = '/api/share';
const JOIN_URL = '/api/join';

/**
 * Fetches the caller's result for this post. The server only answers a player
 * who has submitted. Any failure becomes null, and the card offers a retry.
 */
export const loadResult = async (): Promise<Result | MakerResult | null> => {
  try {
    const response = await fetch(RESULT_URL);
    const body: unknown = await response.json();
    const parsed = parseResultResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status === 'not-submitted') throw new Error(parsed.message);
    return parsed.result;
  } catch (error) {
    console.error(`Could not load ${RESULT_URL}:`, error);
    return null;
  }
};

/** Fetches one page of this post's gallery. Like the result, only a player who has submitted gets it. */
export const loadGallery = async (sort: GallerySort, page: number): Promise<Gallery | null> => {
  const url = `${GALLERY_URL}?sort=${sort}&page=${page}`;
  try {
    const response = await fetch(url);
    const body: unknown = await response.json();
    const parsed = parseGalleryResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status !== 'ok') throw new Error(parsed.message);
    return parsed.gallery;
  } catch (error) {
    console.error(`Could not load ${url}:`, error);
    return null;
  }
};

/**
 * Asks Reddit whether the app may act as the player, which shows Reddit's own
 * permission prompt the first time. It needs the player's real tap. Anything
 * but a clear yes counts as no, so nothing is ever done as the player without it.
 */
const playerAllows = async (tap: Event): Promise<boolean> => {
  try {
    return await canRunAsUser(tap);
  } catch (error) {
    console.error('Could not ask for permission to act as the player:', error);
    return false;
  }
};

/** Posts the player's result as a comment on the post, after their tap on Share and Reddit's permission. */
export const shareResult = async (tap: Event): Promise<ActionOutcome> => {
  if (!(await playerAllows(tap))) return 'declined';
  try {
    const response = await fetch(SHARE_URL, { method: 'POST' });
    const body: unknown = await response.json();
    const parsed = parseShareResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status === 'not-submitted' || parsed.status === 'failed') throw new Error(parsed.message);
    return 'done';
  } catch (error) {
    console.error(`Could not share through ${SHARE_URL}:`, error);
    return 'failed';
  }
};

/** Sends the player's answer to the join prompt. Joining acts as the player, so it asks permission first. */
export const answerJoin = async (choice: JoinChoice, tap: Event): Promise<ActionOutcome> => {
  if (choice === 'join' && !(await playerAllows(tap))) return 'declined';
  try {
    const response = await fetch(JOIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    });
    const body: unknown = await response.json();
    const parsed = parseJoinResponse(body);
    if (!parsed) throw new Error(`Unreadable reply (HTTP ${response.status})`);
    if (parsed.status !== 'ok') throw new Error(parsed.message);
    return 'done';
  } catch (error) {
    console.error(`Could not send the answer to ${JOIN_URL}:`, error);
    return 'failed';
  }
};
