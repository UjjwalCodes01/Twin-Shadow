// The one place game state lives. The scene and the HUD subscribe and re-read
// the whole state on every change. No DOM or three.js here, so it is testable.

import { canPlace } from '../shared/logic';
import type { Size } from '../shared/puzzle';

export type Mode = 'add' | 'remove';

export type GameState = {
  blocks: ReadonlySet<string>;
  /** Quarter turns of the board. Unbounded, so a tween always takes the short way. */
  rotation: number;
  /** What a tap on the board does. */
  mode: Mode;
  /** Earlier boards, oldest first. Undo pops the last one. */
  undoStack: readonly ReadonlySet<string>[];
  /**
   * True while the board shows someone else's sculpture. Nothing can be
   * edited then; only rotating works.
   */
  viewing: boolean;
};

export type Listener = (state: GameState) => void;

export type Store = {
  getState: () => GameState;
  subscribe: (listener: Listener) => () => void;
  /** Places a block. Returns false, changing nothing, if the cell is not allowed. */
  add: (key: string) => boolean;
  /** Removes a block. Returns false, changing nothing, if there is none at `key`. */
  remove: (key: string) => boolean;
  undo: () => void;
  /** Clears the board. Undoable. */
  reset: () => void;
  setMode: (mode: Mode) => void;
  rotate: (quarterTurns: number) => void;
  /**
   * Shows another sculpture on the board, read-only. The player's own board
   * and undo stack are set aside the first time, and kept while stepping
   * from one viewed sculpture to the next.
   */
  view: (blocks: Iterable<string>) => void;
  /** Leaves viewing mode and puts the player's own board back exactly as it was. */
  endView: () => void;
};

export const createStore = (size: Size, initialBlocks: Iterable<string> = []): Store => {
  let state: GameState = {
    blocks: new Set(initialBlocks),
    rotation: 0,
    mode: 'add',
    undoStack: [],
    viewing: false,
  };
  // The player's own board, set aside while they look at someone else's.
  let own: Pick<GameState, 'blocks' | 'undoStack'> | null = null;
  const listeners = new Set<Listener>();

  const update = (changes: Partial<GameState>): void => {
    state = { ...state, ...changes };
    for (const listener of listeners) listener(state);
  };

  const changeBlocks = (next: ReadonlySet<string>): void =>
    update({ blocks: next, undoStack: [...state.undoStack, state.blocks] });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add: (key) => {
      if (state.viewing || !canPlace(key, state.blocks, size)) return false;
      changeBlocks(new Set(state.blocks).add(key));
      return true;
    },
    remove: (key) => {
      if (state.viewing || !state.blocks.has(key)) return false;
      const next = new Set(state.blocks);
      next.delete(key);
      changeBlocks(next);
      return true;
    },
    undo: () => {
      if (state.viewing) return;
      const previous = state.undoStack.at(-1);
      if (previous) update({ blocks: previous, undoStack: state.undoStack.slice(0, -1) });
    },
    reset: () => {
      if (!state.viewing && state.blocks.size > 0) changeBlocks(new Set());
    },
    setMode: (mode) => {
      if (mode !== state.mode) update({ mode });
    },
    rotate: (quarterTurns) => update({ rotation: state.rotation + quarterTurns }),
    view: (blocks) => {
      own ??= { blocks: state.blocks, undoStack: state.undoStack };
      update({ blocks: new Set(blocks), undoStack: [], viewing: true });
    },
    endView: () => {
      if (!own) return;
      const { blocks, undoStack } = own;
      own = null;
      update({ blocks, undoStack, viewing: false });
    },
  };
};
