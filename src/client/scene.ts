// three.js view of the board. Reads the store, never writes game state.
//
// Board cell (x, y, z) sits at three.js (x, y, -z), re-centred on the origin:
// game z runs front to back, three.js z points at the viewer. Flipping z keeps
// the picture right-handed, so x still reads left to right from the front.

import * as THREE from 'three';
import {
  diffShadow,
  findFloating,
  parseKey,
  parseSilhouette,
  projectFront,
  projectSide,
  toKey,
  type CellState,
} from '../shared/logic';
import type { Puzzle } from '../shared/puzzle';
import type { GameState, Store } from './store';

// Placeholder palette. Art direction replaces this later. The two accents are
// repeated in game.css for the HUD panels: keep them in step.
const COLORS = {
  background: 0xe9e6df,
  floorBase: 0xbdb8ad,
  floorTile: 0xd6d1c6,
  wallGrid: 0xd9d4c8,
  frontWall: 0xeef4f2,
  frontAccent: 0x1f7a6d,
  sideWall: 0xf3eff8,
  sideAccent: 0x7a4fb0,
  shadowExtra: 0xd9483b,
  block: 0x7aa2c8,
  blockFloating: 0xe6a23c,
  blockRejected: 0xd9483b,
  blockEdge: 0x26303d,
};

const ROTATE_MS = 200;
const REJECT_FLASH_MS = 180;
const MAX_PIXEL_RATIO = 2;
/** Empty margin on each side of the board, as a share of the frame. */
const FRAME_MARGIN = 0.025;
const CAMERA_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
type BlockMesh = THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
type WallKind = 'front' | 'side';
type WallCell = { fill: BasicMesh; outline: BasicMesh };
type Wall = { shows: WallKind; cells: WallCell[][] };
type Tween = { from: number; to: number; startedAt: number | null };

/** What a tap landed on. Walls are never returned. */
export type Pick =
  | { kind: 'floor'; key: string }
  | { kind: 'block'; key: string; neighbour: string };

export type SceneHandle = {
  /** The floor cell or block face under a point given in client pixels. */
  pick: (clientX: number, clientY: number) => Pick | null;
  /** True while the board is turning. */
  isRotating: () => boolean;
  /** Shows a faint cube at `key`, or hides it with null. */
  setGhost: (key: string | null) => void;
  /** Briefly tints a block to show a tap on it was refused. */
  flashBlock: (key: string) => void;
  /** Draws immediately instead of on the next frame. */
  renderNow: () => void;
  dispose: () => void;
};

/** A flat square frame facing +z: `side` across, `thickness` wide. */
const squareFrame = (side: number, thickness: number): THREE.RingGeometry =>
  new THREE.RingGeometry(
    (side / 2 - thickness) * Math.SQRT2,
    (side / 2) * Math.SQRT2,
    4,
    1,
    Math.PI / 4
  );

const basic = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color });

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const createScene = (canvas: HTMLCanvasElement, puzzle: Puzzle, store: Store): SceneHandle => {
  const { w, d, h } = puzzle.size;
  const frontTarget = parseSilhouette(puzzle.front);
  const sideTarget = parseSilhouette(puzzle.side);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  // Lights stay in the scene, not the board group, so shading does not change
  // when the board turns.
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.3, 1, 0.8);
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(60);
  camera.lookAt(0, 0, 0);

  const board = new THREE.Group();
  scene.add(board);

  const cellPosition = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x + 0.5 - w / 2, y + 0.5, -(z + 0.5 - d / 2));

  // --- Floor ---------------------------------------------------------------
  // The base plane is the tap target, so the thin gaps between tiles are not
  // dead spots. The tiles on top are only decoration.
  const floorBase: BasicMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), basic(COLORS.floorBase));
  floorBase.rotation.x = -Math.PI / 2;
  board.add(floorBase);

  const tileGeometry = new THREE.PlaneGeometry(0.92, 0.92);
  const tileMaterial = basic(COLORS.floorTile);
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const tile: BasicMesh = new THREE.Mesh(tileGeometry, tileMaterial);
      tile.rotation.x = -Math.PI / 2;
      tile.position.copy(cellPosition(x, 0, z)).setY(0.002);
      board.add(tile);
    }
  }

  // --- Walls ---------------------------------------------------------------
  // Each wall is a group whose local +z is its inward normal. Materials are
  // one-sided, so a wall is culled whenever it faces away from the camera:
  // the two walls nearest the viewer vanish and one of each kind stays.
  // Cells are placed by board coordinate (`flip` undoes the wall's own turn),
  // so a shadow cell always sits directly behind the blocks that cast it.
  const gridMaterial = basic(COLORS.wallGrid);
  const extraMaterial = basic(COLORS.shadowExtra);
  const wallMaterials: Record<WallKind, { backing: THREE.MeshBasicMaterial; accent: THREE.MeshBasicMaterial }> = {
    front: { backing: basic(COLORS.frontWall), accent: basic(COLORS.frontAccent) },
    side: { backing: basic(COLORS.sideWall), accent: basic(COLORS.sideAccent) },
  };
  const gridGeometry = squareFrame(1, 0.02);
  const outlineGeometry = squareFrame(0.8, 0.08);
  const fillGeometry = new THREE.PlaneGeometry(0.9, 0.9);

  const buildWall = (
    shows: WallKind,
    columns: number,
    position: THREE.Vector3,
    rotationY: number,
    flip: 1 | -1
  ): Wall => {
    const { backing, accent } = wallMaterials[shows];
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = rotationY;
    board.add(group);

    const back: BasicMesh = new THREE.Mesh(new THREE.PlaneGeometry(columns, h), backing);
    back.position.set(0, h / 2, 0);
    group.add(back);

    const cells: WallCell[][] = [];
    for (let y = 0; y < h; y++) {
      const row: WallCell[] = [];
      for (let column = 0; column < columns; column++) {
        const localX = flip * (column + 0.5 - columns / 2);
        const grid: BasicMesh = new THREE.Mesh(gridGeometry, gridMaterial);
        grid.position.set(localX, y + 0.5, 0.002);
        const fill: BasicMesh = new THREE.Mesh(fillGeometry, accent);
        fill.position.set(localX, y + 0.5, 0.004);
        const outline: BasicMesh = new THREE.Mesh(outlineGeometry, accent);
        outline.position.set(localX, y + 0.5, 0.004);
        group.add(grid, fill, outline);
        row.push({ fill, outline });
      }
      cells.push(row);
    }
    return { shows, cells };
  };

  const walls: Wall[] = [
    buildWall('front', w, new THREE.Vector3(0, 0, -d / 2), 0, 1), // back
    buildWall('front', w, new THREE.Vector3(0, 0, d / 2), Math.PI, -1), // front
    buildWall('side', d, new THREE.Vector3(-w / 2, 0, 0), Math.PI / 2, 1), // left
    buildWall('side', d, new THREE.Vector3(w / 2, 0, 0), -Math.PI / 2, -1), // right
  ];

  const paintWall = (wall: Wall, states: CellState[][]): void => {
    const { accent } = wallMaterials[wall.shows];
    wall.cells.forEach((row, y) => {
      row.forEach((cell, column) => {
        const state = states[y]?.[column] ?? 'empty';
        cell.fill.visible = state === 'match' || state === 'extra';
        cell.fill.material = state === 'extra' ? extraMaterial : accent;
        cell.outline.visible = state === 'missing';
      });
    });
  };

  // --- Blocks --------------------------------------------------------------
  // polygonOffset pushes the faces back a hair so the edge lines draw cleanly.
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  const blockOptions = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  const blockMaterial = new THREE.MeshLambertMaterial({ color: COLORS.block, ...blockOptions });
  const floatingMaterial = new THREE.MeshLambertMaterial({
    color: COLORS.blockFloating,
    ...blockOptions,
  });
  const rejectedMaterial = new THREE.MeshLambertMaterial({
    color: COLORS.blockRejected,
    ...blockOptions,
  });
  const edgeGeometry = new THREE.EdgesGeometry(blockGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.blockEdge });
  const blockMeshes = new Map<string, BlockMesh>();
  const keyByMesh = new Map<THREE.Object3D, string>();
  const flashing = new Set<string>();
  const flashTimers = new Set<number>();

  const paintBlocks = (blocks: ReadonlySet<string>): void => {
    const floating = new Set(findFloating(blocks));
    for (const [key, mesh] of blockMeshes) {
      if (flashing.has(key)) mesh.material = rejectedMaterial;
      else mesh.material = floating.has(key) ? floatingMaterial : blockMaterial;
    }
  };

  const syncBlocks = (state: GameState): void => {
    for (const [key, mesh] of blockMeshes) {
      if (!state.blocks.has(key)) {
        board.remove(mesh);
        blockMeshes.delete(key);
        keyByMesh.delete(mesh);
      }
    }
    for (const key of state.blocks) {
      if (blockMeshes.has(key)) continue;
      const { x, y, z } = parseKey(key);
      const mesh: BlockMesh = new THREE.Mesh(blockGeometry, blockMaterial);
      mesh.position.copy(cellPosition(x, y, z));
      mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
      board.add(mesh);
      blockMeshes.set(key, mesh);
      keyByMesh.set(mesh, key);
    }
    paintBlocks(state.blocks);
  };

  // Hover preview for mouse users. Never a tap target.
  const ghost = new THREE.Mesh(
    blockGeometry,
    new THREE.MeshBasicMaterial({
      color: COLORS.block,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
  );
  ghost.visible = false;
  board.add(ghost);
  let ghostKey: string | null = null;

  // --- Rendering -----------------------------------------------------------
  let frame = 0;
  let tween: Tween | null = null;

  const renderNow = (): void => {
    renderer.render(scene, camera);
  };

  const tick = (now: number): void => {
    frame = 0;
    if (tween) {
      tween.startedAt ??= now;
      const t = Math.min((now - tween.startedAt) / ROTATE_MS, 1);
      const eased = 1 - (1 - t) ** 3;
      board.rotation.y = tween.from + (tween.to - tween.from) * eased;
      if (t < 1) requestRender();
      else tween = null;
    }
    renderNow();
  };

  // Draws once on the next frame. Only the rotation tween keeps asking.
  const requestRender = (): void => {
    if (frame === 0) frame = requestAnimationFrame(tick);
  };

  const angleFor = (state: GameState): number => (state.rotation * Math.PI) / 2;

  const sync = (state: GameState): void => {
    syncBlocks(state);
    const front = diffShadow(projectFront(state.blocks, puzzle.size), frontTarget);
    const side = diffShadow(projectSide(state.blocks, puzzle.size), sideTarget);
    for (const wall of walls) paintWall(wall, wall.shows === 'front' ? front : side);

    const target = angleFor(state);
    if (target !== (tween ? tween.to : board.rotation.y)) {
      tween = { from: board.rotation.y, to: target, startedAt: null };
    }
    requestRender();
  };

  // Fit a cylinder around the board's turning circle, so the framing holds at
  // every rotation and mid-tween, in portrait and landscape.
  const fitCamera = (width: number, height: number): void => {
    const radius = Math.hypot(w, d) / 2;
    const sinElevation = CAMERA_DIRECTION.y;
    const cosElevation = Math.sqrt(1 - sinElevation ** 2);
    const top = radius * sinElevation + h * cosElevation;
    const bottom = -radius * sinElevation;
    // Whichever of width or height runs out first sets the scale.
    const contentWidth = (2 * radius) / (1 - 2 * FRAME_MARGIN);
    const contentHeight = (top - bottom) / (1 - 2 * FRAME_MARGIN);
    const aspect = width / height;
    const viewHeight = Math.max(contentHeight, contentWidth / aspect);
    const viewWidth = viewHeight * aspect;
    const centreY = (top + bottom) / 2;
    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = centreY + viewHeight / 2;
    camera.bottom = centreY - viewHeight / 2;
    camera.updateProjectionMatrix();
  };

  const container = canvas.parentElement ?? canvas;
  const resize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    fitCamera(width, height);
    // Resizing clears the canvas, so redraw in the same frame to avoid a flash.
    renderNow();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // --- Picking -------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const pick = (clientX: number, clientY: number): Pick | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    // Rendering is on demand, so matrices may be stale since the last change.
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    // Nearest hit wins: a block in front of a floor tile takes the tap.
    const hit = raycaster.intersectObjects([floorBase, ...blockMeshes.values()], false)[0];
    if (!hit) return null;

    if (hit.object === floorBase) {
      const local = board.worldToLocal(hit.point.clone());
      const x = clamp(Math.floor(local.x + w / 2), 0, w - 1);
      const z = clamp(Math.floor(d / 2 - local.z), 0, d - 1);
      return { kind: 'floor', key: toKey(x, 0, z) };
    }

    const key = keyByMesh.get(hit.object);
    const normal = hit.face?.normal;
    if (key === undefined || !normal) return null;
    // Blocks are not rotated inside the board group, so the face normal is
    // already in board space. Flip z back to game coordinates.
    const cell = parseKey(key);
    const neighbour = toKey(
      cell.x + Math.round(normal.x),
      cell.y + Math.round(normal.y),
      cell.z - Math.round(normal.z)
    );
    return { kind: 'block', key, neighbour };
  };

  const setGhost = (key: string | null): void => {
    if (key === ghostKey) return;
    ghostKey = key;
    ghost.visible = key !== null;
    if (key !== null) {
      const { x, y, z } = parseKey(key);
      ghost.position.copy(cellPosition(x, y, z));
    }
    requestRender();
  };

  const flashBlock = (key: string): void => {
    if (!blockMeshes.has(key) || flashing.has(key)) return;
    flashing.add(key);
    paintBlocks(store.getState().blocks);
    requestRender();
    const timer = window.setTimeout(() => {
      flashTimers.delete(timer);
      flashing.delete(key);
      paintBlocks(store.getState().blocks);
      requestRender();
    }, REJECT_FLASH_MS);
    flashTimers.add(timer);
  };

  board.rotation.y = angleFor(store.getState());
  const unsubscribe = store.subscribe(sync);
  sync(store.getState());
  resize();

  return {
    pick,
    isRotating: () => tween !== null,
    setGhost,
    flashBlock,
    renderNow,
    dispose: () => {
      unsubscribe();
      resizeObserver.disconnect();
      for (const timer of flashTimers) window.clearTimeout(timer);
      if (frame !== 0) cancelAnimationFrame(frame);
      renderer.dispose();
      // Give the WebGL context back now; browsers only allow a handful.
      renderer.forceContextLoss();
    },
  };
};
