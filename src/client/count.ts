// Small wordings used all over the game. No DOM.

/** "1 block", "9 blocks". */
export const blockText = (blocks: number): string => `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`;
