// three.js view of the board. Reads the store, never writes game state.
//
// Board cell (x, y, z) sits at three.js (x, y, -z), re-centred on the origin:
// game z runs front to back, three.js z points at the viewer. Flipping z keeps
// the picture right-handed, so x still reads left to right from the front.
//
// Every colour, material setting and line weight comes from theme.ts, and the
// walls, table and wood are painted by paint.ts. This file decides only how
// the board is built and how it behaves.

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
import { BLOCK_FACES, blockGeometry, createBlockShape, FACE_KINDS, type FaceKind } from './blockGeometry';
import { paintTable, paintWall, paintWood, type WallKind } from './paint';
import { faceContacts, isUntouched, shadeAt } from './shade';
import type { GameState, Store } from './store';
import { pickFor, THEME } from './theme';

const ROTATE_MS = 200;
const REJECT_FLASH_MS = 180;
const MAX_PIXEL_RATIO = 2;
/** Empty margin on each side of the board, as a share of the frame. */
const FRAME_MARGIN = 0.025;
const CAMERA_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
const UP = new THREE.Vector3(0, 1, 0);

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
type BodyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material[]>;
/** How a block is shown: standing, hovering with nothing under it, or flashing after a refused tap. */
type BlockState = 'standing' | 'floating' | 'refused';
/**
 * A block: `pick` is the plain unit cube taps land on, `body` is the wooden
 * block that is seen. `contacts` remembers what the block was last touching,
 * so its shading is only worked out again when that changes.
 */
type BlockView = {
  pick: THREE.Mesh;
  body: BodyMesh;
  cell: readonly [number, number, number];
  tone: number;
  variant: number;
  state: BlockState | null;
  contacts: string;
};
/**
 * A wall. `paint` draws it from the state of each of its cells, indexed
 * [y][column] in board order; `facing` says whether it would face the camera
 * with the board turned to an angle.
 */
type Wall = { shows: WallKind; paint: (states: CellState[][]) => void; facing: (angle: number) => boolean };
/** A canvas that a wall or the table is painted on, and the texture made from it. */
type Painted = { context: CanvasRenderingContext2D; texture: THREE.CanvasTexture };
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
  /** Shows a pencilled-in block at `key`, or hides it with null. */
  setGhost: (key: string | null) => void;
  /** Briefly stains a block red to show a tap on it was refused. */
  flashBlock: (key: string) => void;
  /** Draws immediately instead of on the next frame. */
  renderNow: () => void;
  dispose: () => void;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const createScene = (canvas: HTMLCanvasElement, puzzle: Puzzle, store: Store): SceneHandle => {
  const { w, d, h } = puzzle.size;
  const frontTarget = parseSilhouette(puzzle.front);
  const sideTarget = parseSilhouette(puzzle.side);
  const look = THEME.scene;

  // The canvas is see-through: the page, with its lamplight, shows behind the board.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();

  // Lights stay in the scene, not the board group, so shading does not change
  // when the board turns.
  scene.add(new THREE.AmbientLight(look.light.ambient.color, look.light.ambient.intensity));
  scene.add(new THREE.HemisphereLight(look.light.hemisphere.sky, look.light.hemisphere.ground, look.light.hemisphere.intensity));
  for (const lamp of look.light.lamps) {
    const light = new THREE.DirectionalLight(lamp.color, lamp.intensity);
    const [fromX, fromY, fromZ] = lamp.from;
    light.position.set(fromX, fromY, fromZ);
    scene.add(light);
  }

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(60);
  camera.lookAt(0, 0, 0);

  const board = new THREE.Group();
  scene.add(board);

  const cellPosition = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x + 0.5 - w / 2, y + 0.5, -(z + 0.5 - d / 2));

  /** A texture made from a canvas that paint.ts draws on. */
  const painted = (width: number, height: number, sharpen: number): Painted | null => {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const context = surface.getContext('2d');
    if (!context) return null;
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Walls, table and block faces are all seen at a slant, where plain filtering smears.
    texture.anisotropy = Math.min(sharpen, renderer.capabilities.getMaxAnisotropy());
    return { context, texture };
  };

  // --- Table -----------------------------------------------------------------
  // The top is the tap target for the floor, painted with the wood, the marks
  // where blocks may stand and the shadows of the blocks standing on it.
  const tableCell = look.tableCellPx;
  const tableSurface = painted(w * tableCell, d * tableCell, look.sharpen.sheets);
  const floorBase: BasicMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial(tableSurface ? { map: tableSurface.texture } : { color: look.table.color })
  );
  floorBase.rotation.x = -Math.PI / 2;
  board.add(floorBase);

  let lastTable = '';
  /** Repaints the table for the blocks now standing on it. Hovering blocks cast nothing. */
  const paintFloor = (standing: ReadonlySet<string>): void => {
    if (!tableSurface) return;
    // Seen from above with the back row at the top, as the texture lies on the table.
    const lowest = Array.from({ length: d }, () => Array.from({ length: w }, () => -1));
    for (const key of standing) {
      const { x, y, z } = parseKey(key);
      const row = lowest[d - 1 - z];
      const current = row?.[x];
      if (row && current !== undefined && (current < 0 || y < current)) row[x] = y;
    }
    const signature = JSON.stringify(lowest);
    if (signature === lastTable) return;
    lastTable = signature;
    paintTable(tableSurface.context, { columns: w, rows: d, cell: tableCell, lowest });
    tableSurface.texture.needsUpdate = true;
  };

  // The slab of the table, a little wider than the board.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w + 2 * look.table.overhang, look.table.depth, d + 2 * look.table.overhang),
    new THREE.MeshStandardMaterial({ color: look.table.color, roughness: look.table.roughness, metalness: 0 })
  );
  slab.position.y = -look.table.depth / 2 - 0.004;
  board.add(slab);

  // --- Walls ---------------------------------------------------------------
  // Each wall is a group whose local +z is its inward normal. Its material is
  // one-sided, so a wall is culled whenever it faces away from the camera:
  // the two walls nearest the viewer vanish and one of each kind stays. A
  // wall is one sheet of paper, painted again whenever its shadow changes.
  const wallCell = look.wallCellPx;

  const buildWall = (
    shows: WallKind,
    columns: number,
    position: THREE.Vector3,
    rotationY: number,
    flip: 1 | -1
  ): Wall => {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = rotationY;
    board.add(group);

    const surface = painted(columns * wallCell, h * wallCell, look.sharpen.sheets);
    const sheet: BasicMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(columns, h),
      new THREE.MeshBasicMaterial(surface ? { map: surface.texture } : { color: THEME.paint.wall.paper })
    );
    sheet.position.set(0, h / 2, 0);
    group.add(sheet);

    // Out of the wall, into the room, before the board is turned.
    const inward = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, rotationY);
    let last = '';
    return {
      shows,
      // The material is one-sided, so the wall shows only when it faces the camera.
      facing: (angle) => inward.clone().applyAxisAngle(UP, angle).dot(CAMERA_DIRECTION) > 0,
      paint: (states) => {
        if (!surface) return;
        // Into drawing order: top row first, and columns as they run across
        // this wall's face, which for two of the four walls is back to front,
        // so a shadow always falls directly behind the blocks that cast it.
        const ordered: CellState[][] = [];
        for (let y = h - 1; y >= 0; y--) {
          const row: CellState[] = [];
          for (let across = 0; across < columns; across++) {
            row.push(states[y]?.[flip === 1 ? across : columns - 1 - across] ?? 'empty');
          }
          ordered.push(row);
        }
        const signature = JSON.stringify(ordered);
        if (signature === last) return;
        last = signature;
        paintWall(surface.context, { kind: shows, columns, rows: h, cell: wallCell, states: ordered, unit: 1 });
        surface.texture.needsUpdate = true;
      },
    };
  };

  const walls: Wall[] = [
    buildWall('front', w, new THREE.Vector3(0, 0, -d / 2), 0, 1), // back
    buildWall('front', w, new THREE.Vector3(0, 0, d / 2), Math.PI, -1), // front
    buildWall('side', d, new THREE.Vector3(-w / 2, 0, 0), Math.PI / 2, 1), // left
    buildWall('side', d, new THREE.Vector3(w / 2, 0, 0), -Math.PI / 2, -1), // right
  ];

  // --- Blocks --------------------------------------------------------------
  // Taps always land on a plain unit cube, so the face that was hit names the
  // neighbouring cell exactly. The wooden block that is seen sits inside it.
  const blockLook = look.blocks;
  const pickGeometry = new THREE.BoxGeometry(1, 1, 1);
  const unseenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const shape = createBlockShape(blockLook.radius);

  // The wood on a face: painted once for each piece of grain and kept.
  const woodTextures = new Map<string, THREE.Texture | null>();
  const woodTexture = (end: boolean, variant: number, floating: boolean): THREE.Texture | null => {
    const key = `${end}:${variant}:${floating}`;
    const kept = woodTextures.get(key);
    if (kept !== undefined) return kept;
    const size = THEME.paint.wood.size;
    const surface = painted(size, size, look.sharpen.wood);
    if (surface) paintWood(surface.context, { end, variant, floating });
    const texture = surface?.texture ?? null;
    woodTextures.set(key, texture);
    return texture;
  };

  /** A tone as one face shows it: the two pairs of side faces lean towards the two lamps. */
  const faceColor = (tone: number, kind: FaceKind): THREE.Color => {
    const color = new THREE.Color(tone);
    const { warm, cool, amount } = blockLook.lampTint;
    if (kind === 'warm') color.lerp(new THREE.Color(warm), amount);
    if (kind === 'cool') color.lerp(new THREE.Color(cool), amount);
    return color;
  };

  /** Three materials, one per kind of face, for a block of one tone and one piece of grain. */
  const faceMaterials = (
    tone: number,
    variant: number,
    floating: boolean,
    extra: THREE.MeshStandardMaterialParameters = {}
  ): THREE.Material[] =>
    FACE_KINDS.map((kind) => {
      const map = woodTexture(kind === 'top', variant, floating);
      return new THREE.MeshStandardMaterial({
        color: faceColor(tone, kind),
        roughness: blockLook.roughness,
        metalness: 0,
        // The shading where blocks touch is carried as a brightness per point.
        vertexColors: true,
        ...(map ? { map } : {}),
        ...extra,
      });
    });

  const standingMaterials = new Map<string, THREE.Material[]>();
  const materialsFor = (view: BlockView, state: BlockState): THREE.Material[] => {
    const tone = blockLook.tones[view.tone] ?? blockLook.tones[0];
    const key = `${state}:${view.tone}:${view.variant}`;
    let materials = standingMaterials.get(key);
    if (!materials) {
      if (state === 'floating') materials = faceMaterials(blockLook.floating.color, view.variant, true);
      else if (state === 'refused') {
        const stained = new THREE.Color(tone).lerp(new THREE.Color(blockLook.refused.color), blockLook.refused.amount);
        materials = faceMaterials(stained.getHex(), view.variant, false);
      } else materials = faceMaterials(tone, view.variant, false);
      standingMaterials.set(key, materials);
    }
    return materials;
  };

  const blockViews = new Map<string, BlockView>();
  const keyByMesh = new Map<THREE.Object3D, string>();
  const flashing = new Set<string>();
  const flashTimers = new Set<number>();

  // Cells are looked up many times per block when shading, so they are kept
  // as numbers rather than strings. Coordinates here are three.js ones.
  const cellNumber = (x: number, y: number, z: number): number => (x + 2) + (y + 2) * 32 + (z + 34) * 1024;

  /** Works out each block's look and shading from what is on the board. */
  const paintBlocks = (blocks: ReadonlySet<string>): ReadonlySet<string> => {
    const floating = new Set(findFloating(blocks));
    const standing = new Set<string>();
    const solidCells = new Set<number>();
    for (const key of blocks) {
      if (floating.has(key)) continue;
      standing.add(key);
      const { x, y, z } = parseKey(key);
      solidCells.add(cellNumber(x, y, -z));
    }
    // The table is solid everywhere below the board; a hovering block is not solid at all.
    const solid = (x: number, y: number, z: number): boolean => y < 0 || solidCells.has(cellNumber(x, y, z));

    for (const [key, view] of blockViews) {
      const state: BlockState = flashing.has(key) ? 'refused' : floating.has(key) ? 'floating' : 'standing';
      if (state !== view.state) {
        view.state = state;
        view.body.material = materialsFor(view, state);
        // A hovering block is smaller and lifted clear of where it would sit.
        const hovering = state === 'floating';
        view.body.scale.setScalar(hovering ? blockLook.floating.scale : blockLook.scale);
        view.body.position.y = hovering ? blockLook.floating.lift : 0;
      }

      // Contact shading: darker towards whatever each face touches.
      const contacts =
        floating.has(key)
          ? []
          : BLOCK_FACES.map(({ normal, u, v }) => faceContacts(view.cell, normal, u, v, solid, blockLook.contact));
      const signature = JSON.stringify(contacts);
      if (signature === view.contacts) continue;
      view.contacts = signature;
      const colors = view.body.geometry.getAttribute('color');
      for (let vertex = 0; vertex < shape.vertexCount; vertex++) {
        const face = contacts[shape.faceOf[vertex] ?? 0];
        const shade =
          !face || isUntouched(face)
            ? 1
            : shadeAt(shape.across[vertex] ?? 0, shape.up[vertex] ?? 0, face, blockLook.contact.reach);
        colors.setXYZ(vertex, shade, shade, shade);
      }
      colors.needsUpdate = true;
    }
    return standing;
  };

  const syncBlocks = (state: GameState): ReadonlySet<string> => {
    for (const [key, view] of blockViews) {
      if (!state.blocks.has(key)) {
        board.remove(view.pick);
        view.body.geometry.dispose();
        blockViews.delete(key);
        keyByMesh.delete(view.pick);
      }
    }
    for (const key of state.blocks) {
      if (blockViews.has(key)) continue;
      const { x, y, z } = parseKey(key);
      const pick = new THREE.Mesh(pickGeometry, unseenMaterial);
      pick.position.copy(cellPosition(x, y, z));
      // The materials are given when the block is first painted, just below.
      const body: BodyMesh = new THREE.Mesh(blockGeometry(shape), []);
      pick.add(body);
      board.add(pick);
      blockViews.set(key, {
        pick,
        body,
        cell: [x, y, -z],
        tone: pickFor(key, blockLook.tones.length),
        variant: pickFor(key, THEME.paint.wood.variants, 7),
        state: null,
        contacts: '',
      });
      keyByMesh.set(pick, key);
    }
    return paintBlocks(state.blocks);
  };

  // Hover preview for mouse users: a block pencilled in, never a tap target.
  const ghost: BodyMesh = new THREE.Mesh(
    blockGeometry(shape),
    faceMaterials(blockLook.floating.color, 0, true, {
      transparent: true,
      opacity: blockLook.ghost.opacity,
      depthWrite: false,
    })
  );
  ghost.scale.setScalar(blockLook.scale);
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
    const standing = syncBlocks(state);
    const front = diffShadow(projectFront(state.blocks, puzzle.size), frontTarget);
    const side = diffShadow(projectSide(state.blocks, puzzle.size), sideTarget);
    // Only the two walls that will be facing the camera are painted; painting
    // is the costly part of a change. The other two are painted when the
    // board is next turned towards them, which comes through here as well.
    const target = angleFor(state);
    for (const wall of walls) {
      if (wall.facing(target)) wall.paint(wall.shows === 'front' ? front : side);
    }
    paintFloor(standing);

    if (target !== (tween ? tween.to : board.rotation.y)) {
      tween = { from: board.rotation.y, to: target, startedAt: null };
    }
    requestRender();
  };

  // Fit a cylinder around the table's turning circle, so the framing holds at
  // every rotation and mid-tween, in portrait and landscape.
  const fitCamera = (width: number, height: number): void => {
    const { overhang, depth } = look.table;
    const radius = Math.hypot(w + 2 * overhang, d + 2 * overhang) / 2;
    const sinElevation = CAMERA_DIRECTION.y;
    const cosElevation = Math.sqrt(1 - sinElevation ** 2);
    const top = (Math.hypot(w, d) / 2) * sinElevation + h * cosElevation;
    const bottom = -radius * sinElevation - depth * cosElevation;
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
    const picks = [...blockViews.values()].map((view) => view.pick);
    const hit = raycaster.intersectObjects([floorBase, ...picks], false)[0];
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
    if (!blockViews.has(key) || flashing.has(key)) return;
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
