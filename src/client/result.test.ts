import { describe, expect, it } from 'vitest';
import {
  blockText,
  canShare,
  isMakerResult,
  makerSolversText,
  ordinal,
  rankText,
  rarityText,
  recordText,
  shareButtonText,
  wholeRowsEnding,
  streakText,
} from './result';

describe('ordinal', () => {
  it('uses st, nd, rd and th', () => {
    expect([1, 2, 3, 4, 10].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '10th']);
    expect([21, 22, 23, 101, 340].map(ordinal)).toEqual(['21st', '22nd', '23rd', '101st', '340th']);
  });

  it('uses th for 11, 12 and 13, in any hundred', () => {
    expect([11, 12, 13, 111, 112, 113].map(ordinal)).toEqual(['11th', '12th', '13th', '111th', '112th', '113th']);
  });
});

describe('rankText', () => {
  it('gives the place out of all solvers when the rank is not shared', () => {
    expect(rankText({ rank: 3, tied: 1, solvers: 340 })).toBe('3rd of 340');
    expect(rankText({ rank: 1, tied: 1, solvers: 1 })).toBe('1st of 1');
  });

  it('says how many others share a tied rank', () => {
    expect(rankText({ rank: 1, tied: 42, solvers: 340 })).toBe('Tied 1st with 41 others');
    expect(rankText({ rank: 12, tied: 2, solvers: 40 })).toBe('Tied 12th with 1 other');
  });
});

describe('rarityText', () => {
  it('says the sample is small before anything else', () => {
    expect(rarityText({ same: 1, share: 1, smallSample: true })).toBe("You're among the first solvers");
    expect(rarityText({ same: 3, share: 0.75, smallSample: true })).toBe("You're among the first solvers");
  });

  it('says when nobody else built the same sculpture', () => {
    expect(rarityText({ same: 1, share: 0.2, smallSample: false })).toBe('Only you built this');
  });

  it('gives the share of solvers who built the same one', () => {
    expect(rarityText({ same: 3, share: 0.6, smallSample: false })).toBe('Same as 60% of solvers');
    expect(rarityText({ same: 41, share: 0.1206, smallSample: false })).toBe('Same as 12% of solvers');
    // Never "0%": the player is one of them.
    expect(rarityText({ same: 2, share: 0.002, smallSample: false })).toBe('Same as 1% of solvers');
  });
});

describe('streakText', () => {
  it('shows the best streak only when it is higher', () => {
    expect(streakText({ current: 3, best: 3 })).toBe('Streak: 3');
    expect(streakText({ current: 2, best: 9 })).toBe('Streak: 2 · Best: 9');
    expect(streakText({ current: 0, best: 0 })).toBe('Streak: 0');
  });
});

describe('recordText', () => {
  it('gives the fewest blocks anyone has submitted', () => {
    expect(recordText({ blocks: 8, underPar: false })).toBe('Community best: 8 blocks');
    expect(recordText({ blocks: 1, underPar: false })).toBe('Community best: 1 block');
  });

  it('marks a record that beats par', () => {
    expect(recordText({ blocks: 6, underPar: true })).toBe('Community best: 6 blocks (under par)');
  });
});

describe('small labels', () => {
  it('counts blocks in the singular and plural', () => {
    expect(blockText(1)).toBe('1 block');
    expect(blockText(9)).toBe('9 blocks');
  });
});

describe('the Share button', () => {
  it('reads differently in each state', () => {
    expect(shareButtonText('ready')).toBe('Share result');
    expect(shareButtonText('sharing')).toBe('Sharing\u2026');
    expect(shareButtonText('shared')).toBe('Shared');
    expect(shareButtonText('failed')).toBe('Retry share');
  });

  it('can be tapped only before sharing or after a failure', () => {
    expect(canShare('ready')).toBe(true);
    expect(canShare('failed')).toBe(true);
    expect(canShare('sharing')).toBe(false);
    expect(canShare('shared')).toBe(false);
  });
});

describe('wholeRowsEnding', () => {
  const rows = [30, 31, 31, 31, 14, 31];

  it('shows every row when there is room for them all', () => {
    expect(wholeRowsEnding(rows, 5, 400)).toEqual({ first: 0, height: 168 });
  });

  it('cuts to whole rows, counted back from the row that must show last', () => {
    // Room for the last row, the gap above it and one more, but not two.
    expect(wholeRowsEnding(rows, 5, 80)).toEqual({ first: 3, height: 76 });
    expect(wholeRowsEnding(rows, 5, 76)).toEqual({ first: 3, height: 76 });
    expect(wholeRowsEnding(rows, 5, 75)).toEqual({ first: 4, height: 45 });
  });

  it('always shows the last row, even with no room to speak of', () => {
    expect(wholeRowsEnding(rows, 5, 10)).toEqual({ first: 5, height: 31 });
  });

  it('can end on a row in the middle of the list', () => {
    expect(wholeRowsEnding(rows, 2, 62)).toEqual({ first: 1, height: 62 });
  });

  it('copes with an empty list', () => {
    expect(wholeRowsEnding([], 0, 100)).toEqual({ first: 0, height: 0 });
  });
});

describe('the maker`s view', () => {
  it('counts the players who have solved the puzzle', () => {
    expect(makerSolversText(0)).toBe('Nobody has solved it yet');
    expect(makerSolversText(1)).toBe('1 player has solved it');
    expect(makerSolversText(40)).toBe('40 players have solved it');
  });

  it('is told apart from a player`s own result by having no rank', () => {
    expect(isMakerResult({ par: 7, solvers: 2, leaderboard: [], record: null })).toBe(true);
    expect(
      isMakerResult({
        blocks: 9,
        par: 7,
        stars: 2,
        rank: 3,
        tied: 1,
        solvers: 40,
        leaderboard: [],
        own: null,
        record: { blocks: 7, underPar: false },
        rarity: { same: 1, share: 0.1, smallSample: false },
        streak: { current: 1, best: 1 },
        shared: false,
        joinPrompt: false,
      })
    ).toBe(false);
  });
});
