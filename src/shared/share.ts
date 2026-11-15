// The comment a player can post with their result. It is spoiler-free: the
// numbers only, never the sculpture or anything that hints at its shape.

import type { Result } from './api';
import type { Stars } from './score';

export type ShareFacts = {
  /** The N in "Twin Shadows #N". */
  number: number;
  blocks: number;
  par: number;
  stars: Stars;
  rarity: Result['rarity'];
};

/** A share of solvers as a whole percentage, never shown as 0%. */
export const rarityPercent = (share: number): number => Math.max(1, Math.round(share * 100));

const rarityLine = ({ same, share, smallSample }: Result['rarity']): string => {
  if (smallSample) return 'Among the first solvers.';
  if (same <= 1) return 'Nobody else built this sculpture.';
  return `Same as ${rarityPercent(share)}% of solvers.`;
};

/** "Twin Shadows #12: 9 blocks, par 7, 2 stars. Same as 4% of solvers." */
export const shareText = ({ number, blocks, par, stars, rarity }: ShareFacts): string =>
  `Twin Shadows #${number}: ${blocks} ${blocks === 1 ? 'block' : 'blocks'}, par ${par}, ` +
  `${stars} ${stars === 1 ? 'star' : 'stars'}. ${rarityLine(rarity)}`;

/** The same comment naming the player, for when Reddit posts it from the app's account. */
export const namedShareText = (username: string, text: string): string => `u/${username}: ${text}`;
