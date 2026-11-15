import { describe, expect, it } from 'vitest';
import { starFlags, starPath, starsLabel } from './stars';

describe('starFlags', () => {
  it('fills the earned stars from the left', () => {
    expect(starFlags(3)).toEqual([true, true, true]);
    expect(starFlags(2)).toEqual([true, true, false]);
    expect(starFlags(1)).toEqual([true, false, false]);
    expect(starFlags(0)).toEqual([false, false, false]);
  });
});

describe('starsLabel', () => {
  it('says the rating in words', () => {
    expect(starsLabel(2)).toBe('2 of 3 stars');
  });
});

describe('starPath', () => {
  const numbers = starPath()
    .replace(/[MLZ]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number);

  it('is one closed shape with ten corners', () => {
    expect(starPath()).toMatch(/^M[\d. ]+( L[\d. ]+){9} Z$/);
    expect(numbers).toHaveLength(20);
  });

  it('stays inside its 24 by 24 box', () => {
    for (const value of numbers) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(24);
    }
  });

  it('points up and is the same left and right', () => {
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(xs[0]).toBeCloseTo(12);
    expect(ys[0]).toBe(Math.min(...ys));
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(24, 1);
  });
});
