// How a solve is scored. Shared so the client can show the rating live and
// the server can record the same one.

import { parseKey } from './logic';

export type Stars = 1 | 2 | 3;

/** Blocks over par that still earn two stars. */
export const TWO_STAR_MARGIN = 3;

/**
 * Stars for a valid solve: 3 at or under par, 2 within TWO_STAR_MARGIN blocks
 * over par, 1 for any other valid solve.
 */
export const starsFor = (blocks: number, par: number): Stars => {
  if (blocks <= par) return 3;
  if (blocks <= par + TWO_STAR_MARGIN) return 2;
  return 1;
};

/** Block keys in one fixed order: by height, then front to back, then left to right. */
export const sortBlocks = (blocks: Iterable<string>): string[] =>
  [...blocks].sort((a, b) => {
    const ca = parseKey(a);
    const cb = parseKey(b);
    return ca.y - cb.y || ca.z - cb.z || ca.x - cb.x;
  });

/**
 * One string per sculpture, the same however the blocks were placed: keys
 * sorted and joined. Two players built the same thing when these match.
 */
export const canonicalSculpture = (blocks: Iterable<string>): string => sortBlocks(blocks).join(';');
