import { describe, expect, it } from 'vitest';
import { TEST_PUZZLE, TEST_SOLUTION } from '../shared/puzzle';
import { createStore } from './store';

const { size } = TEST_PUZZLE;
const blocksOf = (store: ReturnType<typeof createStore>): string[] =>
  [...store.getState().blocks].sort();

describe('store', () => {
  it('starts empty, in add mode, with nothing to undo', () => {
    const state = createStore(size).getState();
    expect(state.blocks.size).toBe(0);
    expect(state.mode).toBe('add');
    expect(state.undoStack).toEqual([]);
  });

  it('adds a block and records it for undo', () => {
    const store = createStore(size);
    expect(store.add('0,0,0')).toBe(true);
    expect(blocksOf(store)).toEqual(['0,0,0']);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it('refuses occupied and out-of-board cells without touching the undo stack', () => {
    const store = createStore(size);
    store.add('0,0,0');
    expect(store.add('0,0,0')).toBe(false);
    expect(store.add('3,0,0')).toBe(false);
    expect(store.add('0,3,0')).toBe(false);
    expect(blocksOf(store)).toEqual(['0,0,0']);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it('removes a block, and refuses to remove one that is not there', () => {
    const store = createStore(size, ['0,0,0', '1,0,0']);
    expect(store.remove('0,0,0')).toBe(true);
    expect(blocksOf(store)).toEqual(['1,0,0']);
    expect(store.remove('2,2,2')).toBe(false);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it('undoes adds and removes in reverse order', () => {
    const store = createStore(size);
    store.add('0,0,0');
    store.add('0,1,0');
    store.remove('0,0,0');
    expect(blocksOf(store)).toEqual(['0,1,0']);
    store.undo();
    expect(blocksOf(store)).toEqual(['0,0,0', '0,1,0']);
    store.undo();
    expect(blocksOf(store)).toEqual(['0,0,0']);
    store.undo();
    expect(blocksOf(store)).toEqual([]);
    expect(store.getState().undoStack).toEqual([]);
  });

  it('does nothing when there is nothing to undo', () => {
    const store = createStore(size);
    store.undo();
    expect(store.getState().blocks.size).toBe(0);
  });

  it('resets the board, and undo brings it back', () => {
    const store = createStore(size, TEST_SOLUTION);
    store.reset();
    expect(store.getState().blocks.size).toBe(0);
    store.undo();
    expect(blocksOf(store)).toEqual([...TEST_SOLUTION].sort());
  });

  it('does not record a reset of an already empty board', () => {
    const store = createStore(size);
    store.reset();
    expect(store.getState().undoStack).toEqual([]);
  });

  it('switches mode without touching the blocks or the undo stack', () => {
    const store = createStore(size, ['0,0,0']);
    store.add('1,0,0');
    const before = store.getState();
    store.setMode('remove');
    const after = store.getState();
    expect(after.mode).toBe('remove');
    expect(after.blocks).toBe(before.blocks);
    expect(after.undoStack).toBe(before.undoStack);
  });

  it('rotates without touching the blocks', () => {
    const store = createStore(size, ['0,0,0']);
    store.rotate(1);
    store.rotate(-2);
    expect(store.getState().rotation).toBe(-1);
    expect(blocksOf(store)).toEqual(['0,0,0']);
  });

  it('notifies subscribers on every change, and stops after unsubscribe', () => {
    const store = createStore(size);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.add('0,0,0');
    store.setMode('remove');
    store.rotate(1);
    expect(calls).toBe(3);
    unsubscribe();
    store.undo();
    expect(calls).toBe(3);
  });

  describe('viewing another sculpture', () => {
    const theirs = ['2,0,2', '2,1,2'];
    const build = () => {
      const store = createStore(size);
      store.add('0,0,0');
      store.add('0,1,0');
      store.remove('0,0,0');
      return store;
    };

    it('shows the other sculpture and marks the board as viewing', () => {
      const store = build();
      store.view(theirs);
      expect(blocksOf(store)).toEqual([...theirs].sort());
      expect(store.getState().viewing).toBe(true);
      expect(store.getState().undoStack).toEqual([]);
    });

    it('blocks add, remove, undo and reset', () => {
      const store = build();
      store.view(theirs);
      const shown = store.getState();
      expect(store.add('1,0,0')).toBe(false);
      expect(store.remove('2,0,2')).toBe(false);
      store.undo();
      store.reset();
      expect(store.getState()).toBe(shown);
    });

    it('still rotates, and keeps the rotation on leaving', () => {
      const store = build();
      store.view(theirs);
      store.rotate(1);
      expect(store.getState().rotation).toBe(1);
      store.endView();
      expect(store.getState().rotation).toBe(1);
    });

    it('restores the player`s own blocks and undo stack exactly on leaving', () => {
      const store = build();
      const before = store.getState();
      store.view(theirs);
      store.endView();
      const after = store.getState();
      expect(after.viewing).toBe(false);
      expect(after.blocks).toBe(before.blocks);
      expect(after.undoStack).toBe(before.undoStack);
      // Undo works again and steps back through the player's own moves.
      store.undo();
      expect(blocksOf(store)).toEqual(['0,0,0', '0,1,0']);
    });

    it('keeps the player`s own board while stepping between viewed sculptures', () => {
      const store = build();
      const before = store.getState();
      store.view(theirs);
      store.view(['1,0,1']);
      store.view(['0,0,2', '1,0,2']);
      expect(blocksOf(store)).toEqual(['0,0,2', '1,0,2']);
      store.endView();
      expect(store.getState().blocks).toBe(before.blocks);
      expect(store.getState().undoStack).toBe(before.undoStack);
    });

    it('does nothing when asked to leave while not viewing', () => {
      const store = build();
      const before = store.getState();
      store.endView();
      expect(store.getState()).toBe(before);
    });
  });
});
