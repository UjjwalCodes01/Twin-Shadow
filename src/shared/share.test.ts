import { describe, expect, it } from 'vitest';
import { namedShareText, rarityPercent, shareText } from './share';

const facts = { number: 12, blocks: 9, par: 7, stars: 2, rarity: { same: 4, share: 0.04, smallSample: false } } as const;

describe('shareText', () => {
  it('gives the post number, blocks, par, stars and rarity', () => {
    expect(shareText(facts)).toBe('Twin Shadows #12: 9 blocks, par 7, 2 stars. Same as 4% of solvers.');
  });

  it('uses the singular for one star and one block', () => {
    const text = shareText({ ...facts, blocks: 1, stars: 1 });
    expect(text).toBe('Twin Shadows #12: 1 block, par 7, 1 star. Same as 4% of solvers.');
  });

  it('says so when nobody else built the sculpture', () => {
    const text = shareText({ ...facts, rarity: { same: 1, share: 0.01, smallSample: false } });
    expect(text).toBe('Twin Shadows #12: 9 blocks, par 7, 2 stars. Nobody else built this sculpture.');
  });

  it('gives no percentage while there are too few solvers', () => {
    const text = shareText({ ...facts, rarity: { same: 1, share: 1, smallSample: true } });
    expect(text).toBe('Twin Shadows #12: 9 blocks, par 7, 2 stars. Among the first solvers.');
  });

  it('never shows a share as 0%', () => {
    expect(rarityPercent(0.001)).toBe(1);
    expect(rarityPercent(0.256)).toBe(26);
  });
});

describe('namedShareText', () => {
  it('puts the player`s name in front', () => {
    expect(namedShareText('ann', 'Twin Shadows #1: done.')).toBe('u/ann: Twin Shadows #1: done.');
  });
});
