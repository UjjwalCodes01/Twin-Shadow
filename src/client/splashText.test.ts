import { describe, expect, it } from 'vitest';
import { buttonText, CREATOR_CREDIT, dateText, headingText, playedText, solversText, streakText } from './splashText';

describe('dateText', () => {
  it('writes the date out in words', () => {
    expect(dateText('2026-11-30')).toBe('30 November 2026');
    expect(dateText('2026-12-01')).toBe('1 December 2026');
    expect(dateText('2027-01-09')).toBe('9 January 2027');
  });

  it('leaves alone anything that is not a date', () => {
    expect(dateText('soon')).toBe('soon');
    expect(dateText('2026-13-01')).toBe('2026-13-01');
  });
});

describe('headingText', () => {
  it('gives the puzzle number and the post`s date', () => {
    expect(headingText({ number: 12, date: '2026-11-30' })).toBe('Puzzle #12 · 30 November 2026');
  });
});

describe('playedText', () => {
  it('gives the blocks against par', () => {
    expect(playedText({ blocks: 9, par: 7 })).toBe('9 blocks · par 7');
    expect(playedText({ blocks: 1, par: 1 })).toBe('1 block · par 1');
  });
});

describe('solversText', () => {
  it('counts the players who have solved the post', () => {
    expect(solversText(0)).toBe('Nobody has solved this yet');
    expect(solversText(1)).toBe('1 player has solved this');
    expect(solversText(340)).toBe('340 players have solved this');
  });
});

describe('streakText', () => {
  it('shows a streak of at least one day', () => {
    expect(streakText(1)).toBe('1-day streak');
    expect(streakText(12)).toBe('12-day streak');
  });

  it('shows nothing for no streak, or for a logged-out visitor', () => {
    expect(streakText(0)).toBeNull();
    expect(streakText(null)).toBeNull();
  });
});

describe('buttonText', () => {
  it('offers to play before solving and the results after', () => {
    expect(buttonText(null)).toBe('Play');
    expect(buttonText({ blocks: 7, par: 6, stars: 2 })).toBe('See results');
  });
});

describe('the credit', () => {
  it('names the creator', () => {
    expect(CREATOR_CREDIT).toMatch(/^by u\/\S+$/);
  });
});
