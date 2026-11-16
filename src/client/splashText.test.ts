import { describe, expect, it } from 'vitest';
import { buttonText, CREATOR_CREDIT, dateText, headingLines, playedText, solversText, streakText } from './splashText';

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

describe('headingLines', () => {
  it('gives the puzzle number and the post`s date on one line, each a whole phrase', () => {
    expect(headingLines({ number: 12, date: '2026-11-30', maker: null })).toEqual([
      ['Puzzle #12', '· 30 November 2026'],
    ]);
  });

  it('credits the maker of a puzzle a player made next to the number, with the date on its own line', () => {
    expect(headingLines({ number: 14, date: '2026-12-06', maker: 'moss-and-brick' })).toEqual([
      ['Puzzle #14', 'by u/moss-and-brick'],
      ['6 December 2026'],
    ]);
  });

  it('never splits a number, a username or a date between phrases', () => {
    const phrases = headingLines({ number: 140, date: '2026-12-06', maker: 'a-name-with-hyphens_20' }).flat();
    expect(phrases).toEqual(['Puzzle #140', 'by u/a-name-with-hyphens_20', '6 December 2026']);
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
    expect(solversText(0)).toBe('Be the first to solve it');
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
  it('names the game`s creator, and says it is the game they made', () => {
    expect(CREATOR_CREDIT).toBe('Game by u/Significant_You460');
  });
});
