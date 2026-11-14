import { TEST_PUZZLE, TEST_SOLUTION } from '../shared/puzzle';
import { createScene } from './scene';
import { createStore } from './store';

const canvas = document.getElementById('board');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #board canvas');

const store = createStore();

// --- TEMPORARY debug hook: remove in step 3 --------------------------------
// Step 2 has no input yet, so these let you load board states and rotate.
//   URL:     game.html?state=empty|solution|broken&rot=0..3
//   Console: twinShadowsDebug.solution(), .empty(), .broken(), .rotate(1)
//   Keys:    left and right arrows rotate
//   Buttons: the bar at the bottom of the screen
const DEBUG_STATES: Record<string, readonly string[]> = {
  empty: [],
  solution: TEST_SOLUTION,
  // Solution plus an extra block at 1,0,0 and a floating block at 1,2,2.
  broken: [...TEST_SOLUTION, '1,0,0', '1,2,2'],
};

const loadDebugState = (name: string): void => {
  const keys = DEBUG_STATES[name];
  if (keys) store.setBlocks(keys);
};

const params = new URLSearchParams(window.location.search);
loadDebugState(params.get('state') ?? 'empty');
const startRotation = Number(params.get('rot') ?? 0);
if (Number.isInteger(startRotation)) store.rotate(startRotation);

Object.assign(window, {
  twinShadowsDebug: {
    empty: () => loadDebugState('empty'),
    solution: () => loadDebugState('solution'),
    broken: () => loadDebugState('broken'),
    rotate: (quarterTurns: number) => store.rotate(quarterTurns),
  },
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') store.rotate(1);
  if (event.key === 'ArrowRight') store.rotate(-1);
});

const onClick = (id: string, action: () => void): void => {
  document.getElementById(id)?.addEventListener('click', action);
};
onClick('debug-rotate-left', () => store.rotate(1));
onClick('debug-rotate-right', () => store.rotate(-1));
onClick('debug-empty', () => loadDebugState('empty'));
onClick('debug-solution', () => loadDebugState('solution'));
onClick('debug-broken', () => loadDebugState('broken'));
// --- end of temporary debug hook --------------------------------------------

createScene(canvas, TEST_PUZZLE, store);
