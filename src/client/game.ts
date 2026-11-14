import { TEST_PUZZLE } from '../shared/puzzle';
import { DEBUG_STATES, debugSetup } from './debug';
import { createHud } from './hud';
import { attachInput } from './input';
import { createScene } from './scene';
import { createStore } from './store';

const canvas = document.getElementById('board');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #board canvas');

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';
const setup = debug ? debugSetup(params.get('state')) : { puzzle: TEST_PUZZLE, blocks: [] };

const store = createStore(setup.puzzle.size, setup.blocks);
const startRotation = debug ? Number(params.get('rot') ?? 0) : 0;
if (Number.isInteger(startRotation) && startRotation !== 0) store.rotate(startRotation);

const scene = createScene(canvas, setup.puzzle, store);
createHud(setup.puzzle, store);
attachInput(canvas, setup.puzzle, store, scene);

if (debug) {
  // Each state is a link that reloads the page, keeping every other parameter.
  const urlFor = (state: string): string => {
    const next = new URLSearchParams(window.location.search);
    next.set('state', state);
    return `?${next.toString()}`;
  };
  const bar = document.getElementById('debug-bar');
  if (bar) {
    bar.hidden = false;
    for (const state of DEBUG_STATES) {
      const link = document.createElement('a');
      link.href = urlFor(state);
      link.textContent = state;
      bar.append(link);
    }
  }
  Object.assign(window, {
    twinShadowsDebug: {
      load: (state: string) => window.location.assign(urlFor(state)),
      render: scene.renderNow,
      store,
    },
  });
}
