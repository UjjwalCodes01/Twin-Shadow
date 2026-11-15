// three.js view of the board. Reads the store, never writes game state.
//
// Board cell (x, y, z) sits at three.js (x, y, -z), re-centred on the origin:
// game z runs front to back, three.js z points at the viewer. Flipping z keeps
// the picture right-handed, so x still reads left to right from the front.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
import { loadFonts, toneIndex, type Theme, type WallKind } from './theme';

// Every colour, material setting and line weight comes from the theme. This
// file decides only how the board is built and how it behaves.

const ROTATE_MS = 200;
const REJECT_FLASH_MS = 180;
const MAX_PIXEL_RATIO = 2;
/** Empty margin on each side of the board, as a share of the frame. */
const FRAME_MARGIN = 0.025;
const CAMERA_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
type LitMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
/** A block: `pick` is the unit cube taps land on, `body` is what is seen. They are the same mesh for a plain box. */
type BlockView = { pick: LitMesh; body: LitMesh; tone: number };
type WallCell = { fill: BasicMesh; outline: BasicMesh };
/** Paints a wall from the state of each of its cells, indexed [y][column] in board order. */
type Wall = { shows: WallKind; paint: (states: CellState[][]) => void };
/** A canvas that a painted wall or floor is drawn on, and the texture made from it. */
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

export const createScene = (
  canvas: HTMLCanvasElement,
  puzzle: Puzzle,
  store: Store,
  theme: Theme
): SceneHandle => {
  const { w, d, h } = puzzle.size;
  const frontTarget = parseSilhouette(puzzle.front);
  const sideTarget = parseSilhouette(puzzle.side);
  const look = theme.scene;
  let disposed = false;

  // With no background colour the canvas is see-through and the page shows behind the board.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: look.background === null });
  const scene = new THREE.Scene();
  if (look.background === null) renderer.setClearColor(0x000000, 0);
  else scene.background = new THREE.Color(look.background);

  // Lights stay in the scene, not the board group, so shading does not change
  // when the board turns.
  scene.add(new THREE.AmbientLight(look.light.ambient.color, look.light.ambient.intensity));
  if (look.light.hemisphere) {
    const { sky, ground, intensity } = look.light.hemisphere;
    scene.add(new THREE.HemisphereLight(sky, ground, intensity));
  }
  for (const lamp of look.light.lamps) {
    const light = new THREE.DirectionalLight(lamp.color, lamp.intensity);
    light.position.set(...lamp.from);
    scene.add(light);
  }

  // A canvas to paint a wall or the floor on, for themes that draw them.
  const painted = (width: number, height: number): Painted | null => {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const context = surface.getContext('2d');
    if (!context) return null;
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Walls and floor are seen at a slant, where plain filtering smears.
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return { context, texture };
  };

  const litMaterial = (color: number, offset: boolean): THREE.Material => {
    // polygonOffset pushes the faces back a hair so edge lines draw cleanly.
    const options = offset ? { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } : {};
    return look.blocks.material === 'standard'
      ? new THREE.MeshStandardMaterial({ color, roughness: look.blocks.roughness, metalness: 0, ...options })
      : new THREE.MeshLambertMaterial({ color, ...options });
  };

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
  const floorLook = look.floor;
  const floorBase: BasicMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    basic(floorLook.style === 'tiles' ? floorLook.base : 0xffffff)
  );
  floorBase.rotation.x = -Math.PI / 2;
  board.add(floorBase);

  // Repaints a drawn floor for the blocks now on the board. Does nothing for a tiled one.
  let paintFloor: (blocks: ReadonlySet<string>) => void = () => {};
  if (floorLook.style === 'tiles') {
    const tileGeometry = new THREE.PlaneGeometry(floorLook.tileSize, floorLook.tileSize);
    const tileMaterial = basic(floorLook.tile);
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const tile: BasicMesh = new THREE.Mesh(tileGeometry, tileMaterial);
        tile.rotation.x = -Math.PI / 2;
        tile.position.copy(cellPosition(x, 0, z)).setY(0.002);
        board.add(tile);
      }
    }
  } else {
    const cell = floorLook.cellPx;
    const surface = painted(w * cell, d * cell);
    if (surface) {
      floorBase.material.map = surface.texture;
      let last = '';
      paintFloor = (blocks) => {
        // Seen from above with the back row at the top, as the texture lies on the floor.
        const lowest = Array.from({ length: d }, () => Array.from({ length: w }, () => -1));
        for (const key of blocks) {
          const { x, y, z } = parseKey(key);
          const row = lowest[d - 1 - z];
          const current = row?.[x];
          if (row && current !== undefined && (current < 0 || y < current)) row[x] = y;
        }
        const signature = JSON.stringify(lowest);
        if (signature === last) return;
        last = signature;
        surface.context.clearRect(0, 0, w * cell, d * cell);
        floorLook.draw(surface.context, { columns: w, rows: d, cell, lowest });
        surface.texture.needsUpdate = true;
      };
    }
  }

  // A table top or plinth under the floor, wider than the board by its overhang.
  if (look.slab) {
    const { color, depth, overhang } = look.slab;
    const slab: LitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2 * overhang, depth, d + 2 * overhang),
      litMaterial(color, false)
    );
    slab.position.y = -depth / 2 - 0.004;
    board.add(slab);
  }

  // --- Walls ---------------------------------------------------------------
  // Each wall is a group whose local +z is its inward normal. Materials are
  // one-sided, so a wall is culled whenever it faces away from the camera:
  // the two walls nearest the viewer vanish and one of each kind stays.
  // Cells are placed by board coordinate (`flip` undoes the wall's own turn),
  // so a shadow cell always sits directly behind the blocks that cast it.
  const wallLook = look.walls;
  const headroom = wallLook.style === 'drawn' ? wallLook.headroom : 0;

  /** A wall built from flat shapes: a square per lit cell, a frame per missing one. */
  const buildCellWall = (
    shows: WallKind,
    columns: number,
    group: THREE.Group,
    flip: 1 | -1,
    shapes: {
      backing: THREE.MeshBasicMaterial;
      accent: THREE.MeshBasicMaterial;
      extra: THREE.MeshBasicMaterial;
      grid: THREE.MeshBasicMaterial;
      gridGeometry: THREE.BufferGeometry;
      outlineGeometry: THREE.BufferGeometry;
      fillGeometry: THREE.BufferGeometry;
    }
  ): Wall => {
    const back: BasicMesh = new THREE.Mesh(new THREE.PlaneGeometry(columns, h), shapes.backing);
    back.position.set(0, h / 2, 0);
    group.add(back);

    const cells: WallCell[][] = [];
    for (let y = 0; y < h; y++) {
      const row: WallCell[] = [];
      for (let column = 0; column < columns; column++) {
        const localX = flip * (column + 0.5 - columns / 2);
        const grid: BasicMesh = new THREE.Mesh(shapes.gridGeometry, shapes.grid);
        grid.position.set(localX, y + 0.5, 0.002);
        const fill: BasicMesh = new THREE.Mesh(shapes.fillGeometry, shapes.accent);
        fill.position.set(localX, y + 0.5, 0.004);
        const outline: BasicMesh = new THREE.Mesh(shapes.outlineGeometry, shapes.accent);
        outline.position.set(localX, y + 0.5, 0.004);
        group.add(grid, fill, outline);
        row.push({ fill, outline });
      }
      cells.push(row);
    }
    return {
      shows,
      paint: (states) => {
        cells.forEach((row, y) => {
          row.forEach((cell, column) => {
            const state = states[y]?.[column] ?? 'empty';
            cell.fill.visible = state === 'match' || state === 'extra';
            cell.fill.material = state === 'extra' ? shapes.extra : shapes.accent;
            cell.outline.visible = state === 'missing';
          });
        });
      },
    };
  };

  /** A wall painted on a canvas by the theme, again whenever its cells change. */
  const buildDrawnWall = (
    shows: WallKind,
    columns: number,
    group: THREE.Group,
    flip: 1 | -1,
    cellPx: number,
    draw: (context: CanvasRenderingContext2D, paint: Parameters<Extract<Theme['scene']['walls'], { style: 'drawn' }>['draw']>[1]) => void
  ): Wall => {
    const headroomPx = Math.round(headroom * cellPx);
    const surface = painted(columns * cellPx, h * cellPx + headroomPx);
    const back: BasicMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(columns, h + headroom),
      new THREE.MeshBasicMaterial(surface ? { map: surface.texture } : { color: 0x808080 })
    );
    back.position.set(0, (h + headroom) / 2, 0);
    group.add(back);

    let last = '';
    return {
      shows,
      paint: (states) => {
        if (!surface) return;
        // Into drawing order: top row first, and columns as they run across
        // this wall's face, which for two of the four walls is back to front.
        const ordered: CellState[][] = [];
        for (let y = h - 1; y >= 0; y--) {
          const row: CellState[] = [];
          for (let across = 0; across < columns; across++) {
            row.push(states[y]?.[flip === 1 ? across : columns - 1 - across] ?? 'empty');
          }
          ordered.push(row);
        }
        const signature = `${fontsReady}|${JSON.stringify(ordered)}`;
        if (signature === last) return;
        last = signature;
        surface.context.clearRect(0, 0, columns * cellPx, h * cellPx + headroomPx);
        draw(surface.context, {
          kind: shows,
          columns,
          rows: h,
          cell: cellPx,
          headroom: headroomPx,
          states: ordered,
          font: fontsReady ? theme.sceneFont : 'sans-serif',
        });
        surface.texture.needsUpdate = true;
      },
    };
  };

  // Lettering on a painted wall waits for the theme's font; the walls are
  // painted again once it has arrived.
  let fontsReady = theme.fonts.length === 0;

  const wallGroup = (position: THREE.Vector3, rotationY: number): THREE.Group => {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = rotationY;
    board.add(group);
    return group;
  };

  const WALL_PLACES: { shows: WallKind; columns: number; position: THREE.Vector3; rotationY: number; flip: 1 | -1 }[] = [
    { shows: 'front', columns: w, position: new THREE.Vector3(0, 0, -d / 2), rotationY: 0, flip: 1 }, // back
    { shows: 'front', columns: w, position: new THREE.Vector3(0, 0, d / 2), rotationY: Math.PI, flip: -1 }, // front
    { shows: 'side', columns: d, position: new THREE.Vector3(-w / 2, 0, 0), rotationY: Math.PI / 2, flip: 1 }, // left
    { shows: 'side', columns: d, position: new THREE.Vector3(w / 2, 0, 0), rotationY: -Math.PI / 2, flip: -1 }, // right
  ];

  let walls: Wall[];
  if (wallLook.style === 'cells') {
    const shared = {
      grid: basic(wallLook.grid),
      extra: basic(wallLook.extra),
      gridGeometry: squareFrame(1, wallLook.gridWeight),
      outlineGeometry: squareFrame(wallLook.outlineSize, wallLook.outlineWeight),
      fillGeometry: new THREE.PlaneGeometry(wallLook.fillSize, wallLook.fillSize),
    };
    const kinds: Record<WallKind, { backing: THREE.MeshBasicMaterial; accent: THREE.MeshBasicMaterial }> = {
      front: { backing: basic(wallLook.frontBacking), accent: basic(wallLook.frontAccent) },
      side: { backing: basic(wallLook.sideBacking), accent: basic(wallLook.sideAccent) },
    };
    walls = WALL_PLACES.map(({ shows, columns, position, rotationY, flip }) =>
      buildCellWall(shows, columns, wallGroup(position, rotationY), flip, { ...shared, ...kinds[shows] })
    );
  } else {
    const { cellPx, draw } = wallLook;
    walls = WALL_PLACES.map(({ shows, columns, position, rotationY, flip }) =>
      buildDrawnWall(shows, columns, wallGroup(position, rotationY), flip, cellPx, draw)
    );
  }

  // --- Blocks --------------------------------------------------------------
  // Taps always land on a plain unit cube, so the face that was hit names the
  // neighbouring cell exactly. A rounded or shrunken block is drawn by a
  // second mesh inside an invisible cube.
  const blockLook = look.blocks;
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  const plainBox = blockLook.shape === 'box' && blockLook.scale === 1;
  const bodyGeometry: THREE.BufferGeometry =
    blockLook.shape === 'rounded' ? new RoundedBoxGeometry(1, 1, 1, 3, blockLook.radius) : blockGeometry;
  const hasEdges = blockLook.edges !== null;
  const toneMaterials = blockLook.tones.map((tone) => litMaterial(tone, hasEdges));
  const floatingMaterial = litMaterial(blockLook.floating, hasEdges);
  const rejectedMaterial = litMaterial(blockLook.rejected, hasEdges);
  const unseenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const edgeGeometry = new THREE.EdgesGeometry(blockGeometry);
  const edgeMaterial = blockLook.edges
    ? new THREE.LineBasicMaterial({
        color: blockLook.edges.color,
        opacity: blockLook.edges.opacity,
        transparent: blockLook.edges.opacity < 1,
      })
    : null;
  const blockViews = new Map<string, BlockView>();
  const keyByMesh = new Map<THREE.Object3D, string>();
  const flashing = new Set<string>();
  const flashTimers = new Set<number>();

  const paintBlocks = (blocks: ReadonlySet<string>): void => {
    const floating = new Set(findFloating(blocks));
    for (const [key, view] of blockViews) {
      if (flashing.has(key)) view.body.material = rejectedMaterial;
      else view.body.material = floating.has(key) ? floatingMaterial : (toneMaterials[view.tone] ?? floatingMaterial);
    }
  };

  const syncBlocks = (state: GameState): void => {
    for (const [key, view] of blockViews) {
      if (!state.blocks.has(key)) {
        board.remove(view.pick);
        blockViews.delete(key);
        keyByMesh.delete(view.pick);
      }
    }
    for (const key of state.blocks) {
      if (blockViews.has(key)) continue;
      const { x, y, z } = parseKey(key);
      const tone = toneIndex(key, toneMaterials.length);
      const material = toneMaterials[tone] ?? floatingMaterial;
      const pick: LitMesh = new THREE.Mesh(blockGeometry, plainBox ? material : unseenMaterial);
      pick.position.copy(cellPosition(x, y, z));
      let body = pick;
      if (!plainBox) {
        body = new THREE.Mesh(bodyGeometry, material);
        body.scale.setScalar(blockLook.scale);
        pick.add(body);
      }
      if (edgeMaterial) pick.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
      board.add(pick);
      blockViews.set(key, { pick, body, tone });
      keyByMesh.set(pick, key);
    }
    paintBlocks(state.blocks);
  };

  // Hover preview for mouse users. Never a tap target.
  const ghost = new THREE.Mesh(
    bodyGeometry,
    new THREE.MeshBasicMaterial({
      color: blockLook.ghost.color,
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
    syncBlocks(state);
    const front = diffShadow(projectFront(state.blocks, puzzle.size), frontTarget);
    const side = diffShadow(projectSide(state.blocks, puzzle.size), sideTarget);
    for (const wall of walls) wall.paint(wall.shows === 'front' ? front : side);
    paintFloor(state.blocks);

    const target = angleFor(state);
    if (target !== (tween ? tween.to : board.rotation.y)) {
      tween = { from: board.rotation.y, to: target, startedAt: null };
    }
    requestRender();
  };

  // Fit a cylinder around the board's turning circle, so the framing holds at
  // every rotation and mid-tween, in portrait and landscape.
  const fitCamera = (width: number, height: number): void => {
    // A slab under the floor is wider than the board and reaches below it; a
    // title strip makes the walls taller. With neither, this is the board alone.
    const overhang = look.slab?.overhang ?? 0;
    const depth = look.slab?.depth ?? 0;
    const radius = Math.hypot(w + 2 * overhang, d + 2 * overhang) / 2;
    const sinElevation = CAMERA_DIRECTION.y;
    const cosElevation = Math.sqrt(1 - sinElevation ** 2);
    const top = (Math.hypot(w, d) / 2) * sinElevation + (h + headroom) * cosElevation;
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

  if (!fontsReady) {
    void loadFonts(theme).then(() => {
      if (disposed) return;
      fontsReady = true;
      sync(store.getState());
    });
  }

  return {
    pick,
    isRotating: () => tween !== null,
    setGhost,
    flashBlock,
    renderNow,
    dispose: () => {
      disposed = true;
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
