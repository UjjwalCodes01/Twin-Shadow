import { describe, expect, it } from 'vitest';
import { afterEvent, needsSolveHint, needsWarmup, NOTHING_REMEMBERED } from './warmup';

const NEW = { warmup: true, solveHint: true };
const SEEN = { warmup: false, solveHint: false };

describe('needsWarmup', () => {
  it('is shown to a brand new player', () => {
    expect(needsWarmup(NEW, NOTHING_REMEMBERED, false)).toBe(true);
  });

  it('is shown once: not again after the server has recorded it finished or skipped', () => {
    expect(needsWarmup(SEEN, NOTHING_REMEMBERED, false)).toBe(false);
  });

  it('is not shown again on a device that remembers it, even when the server does not', () => {
    // A logged-out visitor, or a recording that failed: the server still says new.
    expect(needsWarmup(NEW, afterEvent(NOTHING_REMEMBERED, 'warmup-skipped'), false)).toBe(false);
    expect(needsWarmup(NEW, afterEvent(NOTHING_REMEMBERED, 'warmup-finished'), false)).toBe(false);
  });

  it('is not shown to a player who has already submitted this puzzle', () => {
    expect(needsWarmup(NEW, NOTHING_REMEMBERED, true)).toBe(false);
  });
});

describe('needsSolveHint', () => {
  it('is shown once to a new player, and kept apart from the warm-up', () => {
    expect(needsSolveHint(NEW, NOTHING_REMEMBERED, false)).toBe(true);
    const skipped = afterEvent(NOTHING_REMEMBERED, 'warmup-skipped');
    expect(needsSolveHint(NEW, skipped, false)).toBe(true);
    expect(needsSolveHint(NEW, afterEvent(skipped, 'solve-hint-seen'), false)).toBe(false);
    expect(needsSolveHint(SEEN, NOTHING_REMEMBERED, false)).toBe(false);
    expect(needsSolveHint(NEW, NOTHING_REMEMBERED, true)).toBe(false);
  });
});

describe('afterEvent', () => {
  it('remembers each thing without forgetting the other', () => {
    const one = afterEvent(NOTHING_REMEMBERED, 'solve-hint-seen');
    expect(one).toEqual({ warmup: false, solveHint: true });
    expect(afterEvent(one, 'warmup-finished')).toEqual({ warmup: true, solveHint: true });
  });
});
