import { describe, expect, it } from 'vitest';
import { createSounds, soundForChange, type BoardMoment } from './sound';

const board = (blocks: number, changes: Partial<BoardMoment> = {}): BoardMoment => ({
  blocks,
  viewing: false,
  making: false,
  ...changes,
});

describe('soundForChange', () => {
  it('knocks when a block is placed, and makes the lighter sound when one is taken away', () => {
    expect(soundForChange(board(2), board(3))).toBe('knock');
    expect(soundForChange(board(3), board(2))).toBe('lift');
  });

  it('makes one sound however many blocks changed at once, as for Reset', () => {
    expect(soundForChange(board(9), board(0))).toBe('lift');
    expect(soundForChange(board(0), board(9))).toBe('knock');
  });

  it('is silent when nothing was placed or removed, as for turning the board', () => {
    expect(soundForChange(board(4), board(4))).toBeNull();
  });

  it('is silent while someone else`s sculpture is on the board, and going to and from it', () => {
    expect(soundForChange(board(4), board(9, { viewing: true }))).toBeNull();
    expect(soundForChange(board(9, { viewing: true }), board(6, { viewing: true }))).toBeNull();
    expect(soundForChange(board(6, { viewing: true }), board(4))).toBeNull();
  });

  it('is silent going into and out of making a puzzle, but not while building one', () => {
    expect(soundForChange(board(7), board(0, { making: true }))).toBeNull();
    expect(soundForChange(board(3, { making: true }), board(7))).toBeNull();
    expect(soundForChange(board(0, { making: true }), board(1, { making: true }))).toBe('knock');
  });
});

describe('createSounds', () => {
  it('does nothing, and does not fail, before the player has tapped or where there is no sound', () => {
    const sounds = createSounds();
    expect(() => {
      sounds.knock(85);
      sounds.lift();
      sounds.solved();
    }).not.toThrow();
  });

  it('remembers being muted', () => {
    const sounds = createSounds();
    expect(sounds.isMuted()).toBe(false);
    sounds.setMuted(true);
    expect(sounds.isMuted()).toBe(true);
    expect(() => sounds.knock()).not.toThrow();
  });
});
