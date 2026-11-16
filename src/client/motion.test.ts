import { describe, expect, it } from 'vitest';
import { TEST_PUZZLE } from '../shared/puzzle';
import { bobOffset, createBlockMotion, DROP_MS, dropOffset, fadeAt, liftAt } from './motion';
import { createStore } from './store';
import { THEME } from './theme';

const { drop, lift, bob, swapMs } = THEME.motion;

describe('dropOffset', () => {
  it('starts above the block`s place and ends exactly on it', () => {
    expect(dropOffset(0)).toBe(drop.height);
    expect(dropOffset(DROP_MS)).toBe(0);
    expect(dropOffset(DROP_MS + 500)).toBe(0);
  });

  it('falls all the way down before it settles', () => {
    let last = dropOffset(0);
    for (let elapsed = 5; elapsed <= drop.fallMs; elapsed += 5) {
      const now = dropOffset(elapsed);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
    expect(dropOffset(drop.fallMs)).toBeCloseTo(0);
  });

  it('settles with one small rebound, never below the table', () => {
    const middle = dropOffset(drop.fallMs + drop.settleMs / 2);
    expect(middle).toBeCloseTo(drop.rebound);
    for (let elapsed = 0; elapsed <= DROP_MS; elapsed += 3) expect(dropOffset(elapsed)).toBeGreaterThanOrEqual(0);
  });

  it('takes about 120 ms in all', () => {
    expect(DROP_MS).toBeGreaterThanOrEqual(100);
    expect(DROP_MS).toBeLessThanOrEqual(140);
  });
});

describe('liftAt', () => {
  it('rises and fades to nothing in about 100 ms', () => {
    expect(liftAt(0)).toEqual({ offset: 0, opacity: 1 });
    expect(liftAt(lift.ms).opacity).toBe(0);
    expect(liftAt(lift.ms).offset).toBeCloseTo(lift.height);
    expect(liftAt(lift.ms / 2).opacity).toBeCloseTo(0.5);
    expect(lift.ms).toBeLessThanOrEqual(120);
  });
});

describe('fadeAt and bobOffset', () => {
  it('fades from nothing to all there', () => {
    expect(fadeAt(0, 150)).toBe(0);
    expect(fadeAt(75, 150)).toBe(0.5);
    expect(fadeAt(400, 150)).toBe(1);
    // No time to fade in means it is simply there.
    expect(fadeAt(0, 0)).toBe(1);
  });

  it('bobs a very little, up and down', () => {
    for (let now = 0; now < bob.periodMs * 2; now += 50) expect(Math.abs(bobOffset(now))).toBeLessThanOrEqual(bob.height);
    expect(bob.height).toBeLessThan(0.05);
    expect(bobOffset(bob.periodMs / 4)).toBeCloseTo(bob.height);
    expect(bobOffset(bob.periodMs * 0.75)).toBeCloseTo(-bob.height);
  });
});

describe('createBlockMotion', () => {
  const set = (...keys: string[]): Set<string> => new Set(keys);

  it('does not animate the board as it was found', () => {
    const motion = createBlockMotion(swapMs);
    expect(motion.sync(set('0,0,0', '1,0,0'), 0, 'drop')).toEqual({ arrived: [], left: [] });
    expect(motion.moving(0)).toBe(false);
    expect(motion.arriving('0,0,0', 0)).toEqual({ offset: 0, opacity: 1, moving: false });
  });

  it('drops a block that is placed, then leaves it at rest', () => {
    const motion = createBlockMotion(swapMs);
    motion.sync(set(), 0, 'drop');
    expect(motion.sync(set('0,0,0'), 1000, 'drop').arrived).toEqual(['0,0,0']);
    expect(motion.arriving('0,0,0', 1000).offset).toBe(drop.height);
    expect(motion.arriving('0,0,0', 1040).moving).toBe(true);
    expect(motion.moving(1040)).toBe(true);
    expect(motion.arriving('0,0,0', 1000 + DROP_MS)).toEqual({ offset: 0, opacity: 1, moving: false });
    expect(motion.moving(1000 + DROP_MS)).toBe(false);
  });

  it('keeps a removed block for as long as it takes to lift away', () => {
    const motion = createBlockMotion(swapMs);
    motion.sync(set('0,0,0'), 0, 'drop');
    expect(motion.sync(set(), 500, 'drop').left).toEqual(['0,0,0']);
    const [going] = motion.leaving(550);
    expect(going?.key).toBe('0,0,0');
    expect(going?.opacity).toBeCloseTo(0.5);
    expect(going?.offset).toBeGreaterThan(0);
    expect(motion.leaving(500 + lift.ms)).toEqual([]);
    expect(motion.moving(500 + lift.ms)).toBe(false);
  });

  it('fades rather than falls when one sculpture is swapped for another', () => {
    const motion = createBlockMotion(swapMs);
    motion.sync(set('0,0,0'), 0, 'fade');
    const { arrived, left } = motion.sync(set('1,0,0'), 100, 'fade');
    expect(arrived).toEqual(['1,0,0']);
    expect(left).toEqual(['0,0,0']);
    const half = 100 + swapMs / 2;
    expect(motion.arriving('1,0,0', half)).toEqual({ offset: 0, opacity: 0.5, moving: true });
    expect(motion.leaving(half)).toEqual([{ key: '0,0,0', offset: 0, opacity: 0.5 }]);
    expect(motion.moving(100 + swapMs)).toBe(false);
  });

  it('animates nothing when asked not to, as for reduced motion', () => {
    const motion = createBlockMotion(swapMs);
    motion.sync(set(), 0, 'none');
    motion.sync(set('0,0,0'), 10, 'none');
    expect(motion.moving(10)).toBe(false);
    motion.sync(set(), 20, 'none');
    expect(motion.leaving(20)).toEqual([]);
  });

  it('stops a block leaving if it is put straight back', () => {
    const motion = createBlockMotion(swapMs);
    motion.sync(set('0,0,0'), 0, 'drop');
    motion.sync(set(), 100, 'drop');
    motion.sync(set('0,0,0'), 130, 'drop');
    expect(motion.leaving(140)).toEqual([]);
    expect(motion.arriving('0,0,0', 140).moving).toBe(true);
  });
});

describe('a tap during a placement animation', () => {
  it('still places a block: the animation only draws, it never holds the game back', () => {
    const store = createStore(TEST_PUZZLE.size);
    const motion = createBlockMotion(swapMs);
    motion.sync(store.getState().blocks, 0, 'drop');

    // First tap: the block is in the game at once, and starts to drop.
    expect(store.add('0,0,0')).toBe(true);
    motion.sync(store.getState().blocks, 1000, 'drop');
    expect(motion.moving(1000)).toBe(true);

    // Second tap 50 ms later, mid-drop: accepted just the same.
    expect(motion.arriving('0,0,0', 1050).moving).toBe(true);
    expect(store.add('1,0,0')).toBe(true);
    expect([...store.getState().blocks].sort()).toEqual(['0,0,0', '1,0,0']);
    motion.sync(store.getState().blocks, 1050, 'drop');

    // Both are animating; neither waited for the other.
    expect(motion.arriving('0,0,0', 1060).moving).toBe(true);
    expect(motion.arriving('1,0,0', 1060).moving).toBe(true);
    // And a removal mid-drop is accepted too.
    expect(store.remove('0,0,0')).toBe(true);
    motion.sync(store.getState().blocks, 1070, 'drop');
    expect(motion.leaving(1080).map((going) => going.key)).toEqual(['0,0,0']);

    // Everything comes to rest on its own.
    expect(motion.moving(1050 + DROP_MS + lift.ms)).toBe(false);
  });
});
