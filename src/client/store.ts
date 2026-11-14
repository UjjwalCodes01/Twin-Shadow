// The one place game state lives. The scene (and later the HUD) subscribe and
// re-read the whole state on every change.

export type GameState = {
  blocks: ReadonlySet<string>;
  /** Quarter turns of the board. Unbounded, so a tween always takes the short way. */
  rotation: number;
};

export type Listener = (state: GameState) => void;

export type Store = {
  getState: () => GameState;
  subscribe: (listener: Listener) => () => void;
  setBlocks: (keys: Iterable<string>) => void;
  rotate: (quarterTurns: number) => void;
};

export const createStore = (): Store => {
  let state: GameState = { blocks: new Set(), rotation: 0 };
  const listeners = new Set<Listener>();

  const update = (next: GameState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setBlocks: (keys) => update({ ...state, blocks: new Set(keys) }),
    rotate: (quarterTurns) => update({ ...state, rotation: state.rotation + quarterTurns }),
  };
};
