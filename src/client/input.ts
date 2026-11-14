// Turns pointer events on the canvas into game actions. Every interaction is a
// single tap: no drag, pinch or long-press.

import { canPlace } from '../shared/logic';
import type { Puzzle } from '../shared/puzzle';
import type { Pick, SceneHandle } from './scene';
import type { Store } from './store';

/** A press that travels this far (CSS px) is a drag or scroll, not a tap. */
const TAP_SLOP_PX = 8;

type Press = { pointerId: number; x: number; y: number; moved: boolean };

export const attachInput = (
  canvas: HTMLCanvasElement,
  puzzle: Puzzle,
  store: Store,
  scene: SceneHandle
): void => {
  let press: Press | null = null;
  let mouse: { x: number; y: number } | null = null;

  /** The cell an add-mode tap on `pick` would fill. */
  const placementFor = (pick: Pick): string => (pick.kind === 'floor' ? pick.key : pick.neighbour);

  const tap = (x: number, y: number): void => {
    const pick = scene.pick(x, y);
    if (!pick) return;
    if (store.getState().mode === 'remove') {
      if (pick.kind === 'block') store.remove(pick.key);
      return;
    }
    const added = store.add(placementFor(pick));
    // A refused placement always comes from a block face (top of a full
    // column, or a face against the edge of the board). Flash that block so
    // the tap does not feel dead.
    if (!added && pick.kind === 'block') scene.flashBlock(pick.key);
  };

  // Desktop only: a faint cube where a tap would place a block.
  const updateGhost = (): void => {
    if (!mouse || scene.isRotating() || store.getState().mode !== 'add') {
      scene.setGhost(null);
      return;
    }
    const pick = scene.pick(mouse.x, mouse.y);
    const key = pick ? placementFor(pick) : null;
    const allowed = key !== null && canPlace(key, store.getState().blocks, puzzle.size);
    scene.setGhost(allowed ? key : null);
  };

  canvas.addEventListener('pointerdown', (event) => {
    // A second finger cancels the tap, so a pinch never places a block.
    press = event.isPrimary
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      : null;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (press && event.pointerId === press.pointerId) {
      const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (distance >= TAP_SLOP_PX) press.moved = true;
    }
    if (event.pointerType === 'mouse') {
      mouse = { x: event.clientX, y: event.clientY };
      updateGhost();
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    const finished = press;
    press = null;
    if (!finished || event.pointerId !== finished.pointerId || finished.moved) return;
    const distance = Math.hypot(event.clientX - finished.x, event.clientY - finished.y);
    if (distance >= TAP_SLOP_PX || scene.isRotating()) return;
    tap(event.clientX, event.clientY);
  });

  // The browser took the gesture over (for example to scroll).
  canvas.addEventListener('pointercancel', () => {
    press = null;
  });

  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') {
      mouse = null;
      scene.setGhost(null);
    }
  });

  store.subscribe(updateGhost);
};
