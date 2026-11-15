// Every colour, material setting, line weight, font and corner radius the game
// uses, for the HUD and for the 3D board. game.css holds layout only and reads
// its values from the variables set here; scene.ts builds the board from the
// `scene` part of a theme.
//
// "plain" is the look the game has always had. The other three are art
// directions to choose between, reachable in debug mode only.
//
// No three.js in this file: scene colours are plain numbers (0xrrggbb), and
// walls and floors that are drawn rather than built from flat shapes are
// painted on an ordinary 2D canvas, in code, with no image files.

import type { CellState } from '../shared/logic';

export const THEME_IDS = ['plain', 'lamp', 'blueprint', 'night'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const isThemeId = (value: unknown): value is ThemeId => THEME_IDS.some((id) => id === value);

// --- The HUD -------------------------------------------------------------------

/** Every CSS variable game.css reads. A theme must give each one a value. */
export const HUD_VARIABLES = [
  // Colours.
  '--page',
  '--page-image',
  '--page-size',
  '--ink',
  '--ink-soft',
  '--surface',
  '--line',
  '--front',
  '--side',
  '--extra',
  '--floating',
  '--on-strong',
  '--list-bg',
  '--overlay',
  // Fonts.
  '--font-body',
  '--font-display',
  '--label-case',
  '--label-spacing',
  '--count-size',
  // Corner radii.
  '--radius-control',
  '--radius-card',
  '--radius-cell',
  '--radius-small',
  '--radius-pill',
  // Line weights.
  '--line-thin',
  '--line-strong',
  '--icon-stroke',
  // Depth.
  '--card-border',
  '--card-shadow',
  '--control-shadow',
  // Cells of the two silhouette panels. Border values are whole `border`
  // shorthands, so a theme can choose dashed or solid as well as the weight.
  '--cell-bg',
  '--cell-border',
  '--front-match-bg',
  '--front-match-border',
  '--front-match-shadow',
  '--front-missing-bg',
  '--front-missing-border',
  '--side-match-bg',
  '--side-match-border',
  '--side-match-shadow',
  '--side-missing-bg',
  '--side-missing-border',
  '--extra-bg',
  '--extra-border',
  '--extra-shadow',
] as const;
export type HudVariable = (typeof HUD_VARIABLES)[number];
export type HudTheme = Record<HudVariable, string>;

// --- The 3D board ----------------------------------------------------------------

export type WallKind = 'front' | 'side';

/** One wall to paint. */
export type WallPaint = {
  kind: WallKind;
  columns: number;
  rows: number;
  /** Pixels per cell. */
  cell: number;
  /** Pixels of bare wall above the top row. */
  headroom: number;
  /** [row][column] in drawing order: top row first, columns left to right as seen. */
  states: CellState[][];
  /** The font to use for any lettering, once it has loaded. */
  font: string;
};

/** The floor to paint, seen from above with the back row at the top. */
export type FloorPaint = {
  columns: number;
  rows: number;
  /** Pixels per tile. */
  cell: number;
  /** [row][column]: height of the lowest block above each tile, -1 where there is none. */
  lowest: number[][];
};

type Draw<Paint> = (context: CanvasRenderingContext2D, paint: Paint) => void;

export type LightTheme = {
  ambient: { color: number; intensity: number };
  /** Sky and ground light, for softer shading. */
  hemisphere: { sky: number; ground: number; intensity: number } | null;
  /** Lamps. Each shines from `from` towards the middle of the board. */
  lamps: { color: number; intensity: number; from: readonly [number, number, number] }[];
};

export type FloorTheme =
  | {
      style: 'tiles';
      base: number;
      tile: number;
      /** Side of a tile, where a cell is 1. The rest shows the base as a gap. */
      tileSize: number;
    }
  | { style: 'drawn'; cellPx: number; draw: Draw<FloorPaint> };

export type WallTheme =
  | {
      /** Flat shapes: a square per matched or extra cell, a frame per missing one. */
      style: 'cells';
      grid: number;
      /** Thickness of the grid frame round each cell, where a cell is 1. */
      gridWeight: number;
      frontBacking: number;
      frontAccent: number;
      sideBacking: number;
      sideAccent: number;
      extra: number;
      /** Side of the filled square. */
      fillSize: number;
      /** Side and thickness of the frame that marks a missing cell. */
      outlineSize: number;
      outlineWeight: number;
    }
  | {
      /** The whole wall painted on a canvas, again whenever the shadows change. */
      style: 'drawn';
      cellPx: number;
      /** Bare wall above the top row, in cells. */
      headroom: number;
      draw: Draw<WallPaint>;
    };

export type BlockTheme = {
  shape: 'box' | 'rounded';
  /** Corner radius of a rounded block, where a block is 1. */
  radius: number;
  /** Size of the visible block inside its cell: below 1 leaves a groove between blocks. */
  scale: number;
  material: 'lambert' | 'standard';
  /** Used by 'standard': 1 is fully matt. */
  roughness: number;
  /** One or more tones. Each block takes one, always the same for the same cell. */
  tones: number[];
  floating: number;
  rejected: number;
  /** Lines along the edges of a block, or null for none. */
  edges: { color: number; opacity: number } | null;
  ghost: { color: number; opacity: number };
};

export type SceneTheme = {
  /** Colour behind the board, or null to let the page show through the canvas. */
  background: number | null;
  light: LightTheme;
  floor: FloorTheme;
  /** A slab under the floor (a table top, a plinth), or null. */
  slab: { color: number; depth: number; overhang: number } | null;
  walls: WallTheme;
  blocks: BlockTheme;
};

export type FontFile = { family: string; weight: '400' | '700'; url: string };

export type Theme = {
  id: ThemeId;
  /** Shown on the debug bar. */
  name: string;
  /** Font files to load before this theme is drawn. */
  fonts: FontFile[];
  /** The family used for lettering drawn on the board's walls. */
  sceneFont: string;
  hud: HudTheme;
  scene: SceneTheme;
};

// --- Fonts -----------------------------------------------------------------------
// Bundled with the app, each under the SIL Open Font License. See fonts/README.md.

// Each address is written out in full, as `new URL('<file>', import.meta.url)`:
// that exact form is what tells the build to ship the file with the app.

const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const FRAUNCES: FontFile[] = [
  {
    family: 'Fraunces',
    weight: '400',
    url: new URL('./fonts/fraunces/fraunces-latin-400-normal.woff2', import.meta.url).href,
  },
  {
    family: 'Fraunces',
    weight: '700',
    url: new URL('./fonts/fraunces/fraunces-latin-700-normal.woff2', import.meta.url).href,
  },
];
const PLEX_MONO: FontFile[] = [
  {
    family: 'IBM Plex Mono',
    weight: '400',
    url: new URL('./fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2', import.meta.url).href,
  },
  {
    family: 'IBM Plex Mono',
    weight: '700',
    url: new URL('./fonts/ibm-plex-mono/ibm-plex-mono-latin-700-normal.woff2', import.meta.url).href,
  },
];
const JOST: FontFile[] = [
  { family: 'Jost', weight: '400', url: new URL('./fonts/jost/jost-latin-400-normal.woff2', import.meta.url).href },
  { family: 'Jost', weight: '700', url: new URL('./fonts/jost/jost-latin-700-normal.woff2', import.meta.url).href },
];

// --- Drawing helpers for painted walls and floors ---------------------------------

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const rgba = (color: number, alpha: number): string =>
  `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;

type CellVisit = (x: number, y: number, state: CellState) => void;

/** Calls `visit` with the top-left corner of every cell, below the headroom. */
const eachCell = ({ states, cell, headroom }: WallPaint, visit: CellVisit): void => {
  states.forEach((row, rowIndex) => {
    row.forEach((state, column) => visit(column * cell, headroom + rowIndex * cell, state));
  });
};

/** One path made of every cell that passes `wanted`, so they can be filled as a single shape. */
const cellsPath = (
  context: CanvasRenderingContext2D,
  paint: WallPaint,
  wanted: (state: CellState) => boolean,
  inset = 0
): boolean => {
  let any = false;
  context.beginPath();
  eachCell(paint, (x, y, state) => {
    if (!wanted(state)) return;
    any = true;
    context.rect(x + inset, y + inset, paint.cell - 2 * inset, paint.cell - 2 * inset);
  });
  return any;
};

/** Parallel diagonal strokes across one cell. `rising` strokes climb to the right. */
const hatchCell = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  gap: number,
  rising: boolean
): void => {
  context.save();
  context.beginPath();
  context.rect(x, y, size, size);
  context.clip();
  context.beginPath();
  for (let offset = -size; offset < size; offset += gap) {
    if (rising) {
      context.moveTo(x + offset, y + size);
      context.lineTo(x + offset + size, y);
    } else {
      context.moveTo(x + offset, y);
      context.lineTo(x + offset + size, y + size);
    }
  }
  context.stroke();
  context.restore();
};

/** A cross from corner to corner of one cell, inset from its edges. */
const crossCell = (context: CanvasRenderingContext2D, x: number, y: number, size: number, inset: number): void => {
  context.beginPath();
  context.moveTo(x + inset, y + inset);
  context.lineTo(x + size - inset, y + size - inset);
  context.moveTo(x + size - inset, y + inset);
  context.lineTo(x + inset, y + size - inset);
  context.stroke();
};

const isLit = (state: CellState): boolean => state === 'match' || state === 'extra';

/**
 * A fixed scatter of numbers in [0, 1) for specks and grain: the same every
 * time, so a wall does not shimmer when it is painted again. (Not the game's
 * seeded generator: this file is also read by the build, and stays free of
 * imports that run.)
 */
const scatter = (seed: number): (() => number) => {
  let step = seed;
  return () => {
    step += 1;
    const value = Math.sin(step * 127.1 + seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
};

/** Soft dark patches on a floor under the blocks, darker where a block touches it. */
const contactShadows = (
  context: CanvasRenderingContext2D,
  { lowest, cell }: FloorPaint,
  color: number,
  strength: number
): void => {
  context.save();
  lowest.forEach((row, rowIndex) => {
    row.forEach((height, column) => {
      if (height < 0) return;
      // A block higher up casts a fainter, wider shadow than one on the floor.
      const alpha = strength / (1 + height * 0.9);
      const spread = cell * (0.1 + Math.min(height, 3) * 0.05);
      context.shadowColor = rgba(color, alpha);
      context.shadowBlur = cell * 0.3;
      context.fillStyle = rgba(color, alpha);
      context.fillRect(column * cell - spread, rowIndex * cell - spread, cell + 2 * spread, cell + 2 * spread);
    });
  });
  context.restore();
};

// --- Plain: the look the game has always had -------------------------------------

const PLAIN: Theme = {
  id: 'plain',
  name: 'plain',
  fonts: [],
  sceneFont: 'sans-serif',
  hud: {
    '--page': '#e9e6df',
    '--page-image': 'none',
    '--page-size': 'auto',
    '--ink': '#26303d',
    '--ink-soft': '#55606e',
    '--surface': '#f6f3ec',
    '--line': '#c9c3b6',
    '--front': '#1f7a6d',
    '--side': '#7a4fb0',
    '--extra': '#d9483b',
    '--floating': '#b26b00',
    '--on-strong': '#ffffff',
    '--list-bg': '#ffffff',
    // 55% of the ink colour, written the way the build has always minified it.
    '--overlay': '#26303d8c',
    '--font-body': SYSTEM_SANS,
    '--font-display': SYSTEM_SANS,
    '--label-case': 'uppercase',
    '--label-spacing': '0.04em',
    '--count-size': '1rem',
    '--radius-control': '8px',
    '--radius-card': '12px',
    '--radius-cell': '2px',
    '--radius-small': '6px',
    '--radius-pill': '999px',
    '--line-thin': '1px',
    '--line-strong': '2px',
    '--icon-stroke': '2',
    '--card-border': 'none',
    '--card-shadow': 'none',
    '--control-shadow': 'none',
    '--cell-bg': '#f6f3ec',
    '--cell-border': '1px solid #c9c3b6',
    '--front-match-bg': '#1f7a6d',
    '--front-match-border': '1px solid #1f7a6d',
    '--front-match-shadow': 'none',
    '--front-missing-bg': 'transparent',
    '--front-missing-border': '2px solid #1f7a6d',
    '--side-match-bg': '#7a4fb0',
    '--side-match-border': '1px solid #7a4fb0',
    '--side-match-shadow': 'none',
    '--side-missing-bg': 'transparent',
    '--side-missing-border': '2px solid #7a4fb0',
    '--extra-bg': '#d9483b',
    '--extra-border': '1px solid #d9483b',
    '--extra-shadow': 'none',
  },
  scene: {
    background: 0xe9e6df,
    light: {
      ambient: { color: 0xffffff, intensity: 1.7 },
      hemisphere: null,
      lamps: [{ color: 0xffffff, intensity: 1.6, from: [0.3, 1, 0.8] }],
    },
    floor: { style: 'tiles', base: 0xbdb8ad, tile: 0xd6d1c6, tileSize: 0.92 },
    slab: null,
    walls: {
      style: 'cells',
      grid: 0xd9d4c8,
      gridWeight: 0.02,
      frontBacking: 0xeef4f2,
      frontAccent: 0x1f7a6d,
      sideBacking: 0xf3eff8,
      sideAccent: 0x7a4fb0,
      extra: 0xd9483b,
      fillSize: 0.9,
      outlineSize: 0.8,
      outlineWeight: 0.08,
    },
    blocks: {
      shape: 'box',
      radius: 0,
      scale: 1,
      material: 'lambert',
      roughness: 1,
      tones: [0x7aa2c8],
      floating: 0xe6a23c,
      rejected: 0xd9483b,
      edges: { color: 0x26303d, opacity: 1 },
      ghost: { color: 0x7aa2c8, opacity: 0.35 },
    },
  },
};

// --- A. Lamp and paper -----------------------------------------------------------
// Wooden blocks on a table, two lamps, shadows thrown on cream paper.

const LAMP = {
  paper: 0xf6edd9,
  paperEdge: 0xcdbb98,
  pencil: 0x5b4c3e,
  warmShadow: 0x4a2c1a,
  coolShadow: 0x24324e,
  red: 0xc0392b,
  table: 0x94683f,
  tableDark: 0x6e4a2c,
} as const;

const drawLampWall: Draw<WallPaint> = (context, paint) => {
  const { cell, columns, rows, kind, headroom } = paint;
  const width = columns * cell;
  const height = headroom + rows * cell;
  const shadow = kind === 'front' ? LAMP.warmShadow : LAMP.coolShadow;

  // Paper, with a speckle of fibres so it is not a flat fill.
  context.fillStyle = hex(LAMP.paper);
  context.fillRect(0, 0, width, height);
  const random = scatter(kind === 'front' ? 11 : 23);
  for (let speck = 0; speck < columns * rows * 26; speck++) {
    const dark = random() < 0.5;
    context.fillStyle = dark ? rgba(LAMP.pencil, 0.05) : 'rgba(255, 255, 255, 0.35)';
    context.fillRect(random() * width, random() * height, 1 + random() * 2.5, 1);
  }

  // Faint ruled grid, as if drawn lightly in pencil.
  context.strokeStyle = rgba(LAMP.pencil, 0.14);
  context.lineWidth = Math.max(1, cell * 0.012);
  context.beginPath();
  for (let column = 1; column < columns; column++) {
    context.moveTo(column * cell, 0);
    context.lineTo(column * cell, height);
  }
  for (let row = 1; row < rows; row++) {
    context.moveTo(0, headroom + row * cell);
    context.lineTo(width, headroom + row * cell);
  }
  context.stroke();

  // The cast shadow: every lit cell as one shape, so neighbours merge, with a
  // soft edge all round.
  if (cellsPath(context, paint, isLit, cell * 0.02)) {
    context.save();
    context.shadowColor = rgba(shadow, 0.8);
    context.shadowBlur = cell * 0.2;
    context.fillStyle = rgba(shadow, 0.82);
    context.fill();
    // Neighbouring cells overlap a little, so no light shows between them.
    context.shadowBlur = 0;
    cellsPath(context, paint, isLit, -cell * 0.02);
    context.fill();
    context.restore();
  }

  // Shadow that falls where it should not: tinted red and struck through.
  if (cellsPath(context, paint, (state) => state === 'extra', cell * 0.02)) {
    context.save();
    context.shadowColor = rgba(LAMP.red, 0.7);
    context.shadowBlur = cell * 0.14;
    context.fillStyle = rgba(LAMP.red, 0.55);
    context.fill();
    context.restore();
  }
  context.lineCap = 'round';
  eachCell(paint, (x, y, state) => {
    if (state === 'extra') {
      context.strokeStyle = rgba(0xffe1d6, 0.85);
      context.lineWidth = cell * 0.035;
      hatchCell(context, x + cell * 0.12, y + cell * 0.12, cell * 0.76, cell * 0.19, true);
    }
  });

  // The outline the shadow is meant to fill: dashed pencil while it is still
  // empty, a quiet light line once the shadow is in it.
  eachCell(paint, (x, y, state) => {
    if (state !== 'missing' && state !== 'match') return;
    const inset = cell * 0.1;
    context.lineWidth = cell * (state === 'missing' ? 0.04 : 0.02);
    context.strokeStyle = state === 'missing' ? rgba(LAMP.pencil, 0.85) : rgba(LAMP.paper, 0.4);
    context.setLineDash(state === 'missing' ? [cell * 0.13, cell * 0.09] : []);
    context.strokeRect(x + inset, y + inset, cell - 2 * inset, cell - 2 * inset);
  });
  context.setLineDash([]);

  // The edge of the sheet.
  context.strokeStyle = hex(LAMP.paperEdge);
  context.lineWidth = cell * 0.04;
  context.strokeRect(0, 0, width, height);
};

const drawLampFloor: Draw<FloorPaint> = (context, paint) => {
  const { cell, columns, rows } = paint;
  const width = columns * cell;
  const height = rows * cell;
  context.fillStyle = hex(LAMP.table);
  context.fillRect(0, 0, width, height);

  // Wood grain: long, slightly wavering strokes along the boards.
  const random = scatter(7);
  for (let stroke = 0; stroke < rows * 22; stroke++) {
    const y = random() * height;
    const start = random() * width * 0.6 - width * 0.1;
    const length = width * (0.3 + random() * 0.7);
    context.strokeStyle = random() < 0.6 ? rgba(LAMP.tableDark, 0.2) : 'rgba(255, 226, 170, 0.12)';
    context.lineWidth = 1 + random() * 1.5;
    context.beginPath();
    context.moveTo(start, y);
    context.bezierCurveTo(start + length * 0.3, y + 3, start + length * 0.6, y - 3, start + length, y + 1);
    context.stroke();
  }

  // Where each block may stand, marked lightly.
  context.strokeStyle = 'rgba(255, 236, 200, 0.28)';
  context.lineWidth = Math.max(1, cell * 0.015);
  context.beginPath();
  for (let column = 0; column <= columns; column++) {
    context.moveTo(column * cell, 0);
    context.lineTo(column * cell, height);
  }
  for (let row = 0; row <= rows; row++) {
    context.moveTo(0, row * cell);
    context.lineTo(width, row * cell);
  }
  context.stroke();

  contactShadows(context, paint, 0x2a1608, 0.42);
};

const LAMP_THEME: Theme = {
  id: 'lamp',
  name: 'lamp',
  fonts: FRAUNCES,
  sceneFont: 'Fraunces',
  hud: {
    '--page': '#dfcfb0',
    '--page-image': 'radial-gradient(120% 75% at 50% 34%, #f7ecd3 0%, #e6d6b6 55%, #c9b28a 100%)',
    '--page-size': 'auto',
    '--ink': '#3a291c',
    '--ink-soft': '#5c4838',
    '--surface': '#fbf4e3',
    '--line': '#c8b390',
    '--front': '#7c3815',
    '--side': '#2c456e',
    '--extra': '#972211',
    '--floating': '#7d4a00',
    '--on-strong': '#fff8ea',
    '--list-bg': '#fffaf0',
    '--overlay': 'rgb(58 41 28 / 55%)',
    '--font-body': "'Fraunces', Georgia, 'Times New Roman', serif",
    '--font-display': "'Fraunces', Georgia, 'Times New Roman', serif",
    '--label-case': 'none',
    '--label-spacing': '0.02em',
    '--count-size': '1.05rem',
    '--radius-control': '6px',
    '--radius-card': '4px',
    '--radius-cell': '1px',
    '--radius-small': '4px',
    '--radius-pill': '999px',
    '--line-thin': '1px',
    '--line-strong': '2px',
    '--icon-stroke': '1.8',
    '--card-border': '1px solid #c8b390',
    '--card-shadow': '0 10px 28px rgb(58 41 28 / 35%)',
    '--control-shadow': '0 1px 0 rgb(58 41 28 / 25%)',
    '--cell-bg': '#fbf4e3',
    '--cell-border': '1px solid #d9c8a8',
    '--front-match-bg': '#5a3a26',
    '--front-match-border': '1px solid #5a3a26',
    '--front-match-shadow': '0 0 2px #5a3a26',
    '--front-missing-bg': 'transparent',
    '--front-missing-border': '2px dashed #5c4838',
    '--side-match-bg': '#34425c',
    '--side-match-border': '1px solid #34425c',
    '--side-match-shadow': '0 0 2px #34425c',
    '--side-missing-bg': 'transparent',
    '--side-missing-border': '2px dashed #5c4838',
    '--extra-bg': 'repeating-linear-gradient(45deg, #b8321f 0 3px, #7d2114 3px 5px)',
    '--extra-border': '1px solid #7d2114',
    '--extra-shadow': '0 0 2px #b8321f',
  },
  scene: {
    background: null,
    light: {
      ambient: { color: 0xfff1dc, intensity: 0.55 },
      hemisphere: { sky: 0xfff4de, ground: 0x7a5a3a, intensity: 1.5 },
      lamps: [
        { color: 0xffd9a3, intensity: 2.4, from: [0.9, 1.1, 0.5] },
        { color: 0xc6d6ff, intensity: 1.0, from: [-0.5, 0.7, 1] },
      ],
    },
    floor: { style: 'drawn', cellPx: 96, draw: drawLampFloor },
    slab: { color: 0x6e4a2c, depth: 0.28, overhang: 0.22 },
    walls: { style: 'drawn', cellPx: 112, headroom: 0, draw: drawLampWall },
    blocks: {
      shape: 'rounded',
      radius: 0.075,
      scale: 0.975,
      material: 'standard',
      roughness: 0.72,
      tones: [0xe8c796, 0xdcb27c, 0xcd9c66, 0xbf8853],
      floating: 0xf2c94c,
      rejected: 0xc0392b,
      edges: null,
      ghost: { color: 0xe6c088, opacity: 0.4 },
    },
  },
};

// --- B. Blueprint ----------------------------------------------------------------
// An architect's drawing: white line work on deep blue drafting paper.

const BLUE = {
  paper: 0x0f3a78,
  panel: 0x144487,
  line: 0xffffff,
  red: 0xff8a7a,
} as const;

const drawBlueprintWall: Draw<WallPaint> = (context, paint) => {
  const { cell, columns, rows, kind, headroom, font } = paint;
  const width = columns * cell;
  const height = headroom + rows * cell;
  const thin = Math.max(1.5, cell * 0.016);

  context.fillStyle = hex(BLUE.panel);
  context.fillRect(0, 0, width, height);

  // Drafting grid: a fine line every quarter cell, a firmer one on each cell.
  context.strokeStyle = rgba(BLUE.line, 0.07);
  context.lineWidth = 1;
  context.beginPath();
  for (let x = cell / 4; x < width; x += cell / 4) {
    context.moveTo(x, headroom);
    context.lineTo(x, height);
  }
  for (let y = headroom + cell / 4; y < height; y += cell / 4) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
  context.strokeStyle = rgba(BLUE.line, 0.22);
  context.lineWidth = thin * 0.7;
  context.beginPath();
  for (let column = 0; column <= columns; column++) {
    context.moveTo(column * cell, headroom);
    context.lineTo(column * cell, height);
  }
  for (let row = 0; row <= rows; row++) {
    context.moveTo(0, headroom + row * cell);
    context.lineTo(width, headroom + row * cell);
  }
  context.stroke();

  eachCell(paint, (x, y, state) => {
    if (state === 'empty') return;
    const inset = cell * 0.09;
    const size = cell - 2 * inset;
    const red = state === 'extra';
    context.strokeStyle = red ? hex(BLUE.red) : hex(BLUE.line);
    if (state !== 'missing') {
      // Matched: hatched one way. Extra: cross-hatched, in red pencil.
      context.lineWidth = thin * (red ? 1.5 : 0.9);
      hatchCell(context, x + inset, y + inset, size, cell * 0.13, true);
      if (red) hatchCell(context, x + inset, y + inset, size, cell * 0.13, false);
    }
    context.lineWidth = thin * (state === 'missing' ? 1.2 : 1.6);
    context.strokeRect(x + inset, y + inset, size, size);
  });

  // The title strip, as on an elevation drawing.
  context.strokeStyle = hex(BLUE.line);
  context.lineWidth = thin;
  context.strokeRect(thin / 2, thin / 2, width - thin, height - thin);
  if (headroom > 0) {
    context.beginPath();
    context.moveTo(0, headroom);
    context.lineTo(width, headroom);
    context.stroke();
    context.fillStyle = hex(BLUE.line);
    context.font = `700 ${Math.round(headroom * 0.5)}px ${font}`;
    context.textBaseline = 'middle';
    const title = kind === 'front' ? 'FRONT ELEVATION' : 'SIDE ELEVATION';
    // Shrinks to fit a narrow wall rather than running off it.
    context.fillText(title, cell * 0.14, headroom * 0.54, width - cell * 0.28);
  }
};

const drawBlueprintFloor: Draw<FloorPaint> = (context, { cell, columns, rows }) => {
  const width = columns * cell;
  const height = rows * cell;
  context.fillStyle = hex(0x123f80);
  context.fillRect(0, 0, width, height);
  context.strokeStyle = rgba(BLUE.line, 0.08);
  context.lineWidth = 1;
  context.beginPath();
  for (let x = cell / 4; x < width; x += cell / 4) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = cell / 4; y < height; y += cell / 4) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
  context.strokeStyle = rgba(BLUE.line, 0.5);
  context.lineWidth = Math.max(1.5, cell * 0.016);
  context.beginPath();
  for (let column = 0; column <= columns; column++) {
    context.moveTo(column * cell, 0);
    context.lineTo(column * cell, height);
  }
  for (let row = 0; row <= rows; row++) {
    context.moveTo(0, row * cell);
    context.lineTo(width, row * cell);
  }
  context.stroke();
};

const HATCH_WHITE = 'repeating-linear-gradient(45deg, #ffffff 0 1px, transparent 1px 4px)';
const HATCH_RED =
  'repeating-linear-gradient(45deg, #ff8a7a 0 1px, transparent 1px 4px), ' +
  'repeating-linear-gradient(-45deg, #ff8a7a 0 1px, transparent 1px 4px)';

const BLUEPRINT_THEME: Theme = {
  id: 'blueprint',
  name: 'blueprint',
  fonts: PLEX_MONO,
  sceneFont: "'IBM Plex Mono'",
  hud: {
    '--page': '#0f3a78',
    '--page-image':
      'linear-gradient(rgb(255 255 255 / 6%) 1px, transparent 1px), ' +
      'linear-gradient(90deg, rgb(255 255 255 / 6%) 1px, transparent 1px)',
    '--page-size': '20px 20px',
    '--ink': '#f4f7ff',
    '--ink-soft': '#b7c8e8',
    '--surface': '#174a92',
    '--line': '#6d8fc6',
    '--front': '#ffffff',
    '--side': '#ffffff',
    '--extra': '#ff9a8e',
    '--floating': '#ffd166',
    '--on-strong': '#0f3a78',
    '--list-bg': '#123f82',
    '--overlay': 'rgb(6 24 54 / 70%)',
    '--font-body': "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
    '--font-display': "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
    '--label-case': 'uppercase',
    '--label-spacing': '0.06em',
    '--count-size': '0.84rem',
    '--radius-control': '2px',
    '--radius-card': '2px',
    '--radius-cell': '0px',
    '--radius-small': '2px',
    '--radius-pill': '2px',
    '--line-thin': '1px',
    '--line-strong': '1px',
    '--icon-stroke': '1.5',
    '--card-border': '1px solid #f4f7ff',
    '--card-shadow': '0 0 0 4px #0f3a78, 0 0 0 5px rgb(255 255 255 / 45%)',
    '--control-shadow': 'none',
    '--cell-bg': 'transparent',
    '--cell-border': '1px solid rgb(255 255 255 / 20%)',
    '--front-match-bg': HATCH_WHITE,
    '--front-match-border': '1px solid #ffffff',
    '--front-match-shadow': 'none',
    '--front-missing-bg': 'transparent',
    '--front-missing-border': '1px solid #ffffff',
    '--side-match-bg': HATCH_WHITE,
    '--side-match-border': '1px solid #ffffff',
    '--side-match-shadow': 'none',
    '--side-missing-bg': 'transparent',
    '--side-missing-border': '1px solid #ffffff',
    '--extra-bg': HATCH_RED,
    '--extra-border': '1px solid #ff8a7a',
    '--extra-shadow': 'none',
  },
  scene: {
    background: null,
    light: {
      ambient: { color: 0xffffff, intensity: 2.3 },
      hemisphere: null,
      lamps: [{ color: 0xffffff, intensity: 1.1, from: [0.3, 1, 0.8] }],
    },
    floor: { style: 'drawn', cellPx: 96, draw: drawBlueprintFloor },
    slab: null,
    walls: { style: 'drawn', cellPx: 112, headroom: 0.42, draw: drawBlueprintWall },
    blocks: {
      shape: 'box',
      radius: 0,
      scale: 1,
      material: 'lambert',
      roughness: 1,
      tones: [0x3d74c4],
      floating: 0xc79a2e,
      rejected: 0xd9584d,
      edges: { color: 0xffffff, opacity: 1 },
      ghost: { color: 0xffffff, opacity: 0.25 },
    },
  },
};

// --- C. Night gallery ------------------------------------------------------------
// A dark room, a plinth, two spotlights; the shadows are pools of coloured light.

const NIGHT = {
  wall: 0x121318,
  line: 0x3a3c46,
  front: 0xffb347,
  side: 0x5ad1ff,
  red: 0xff5a52,
  plinth: 0x2c2e36,
} as const;

const drawNightWall: Draw<WallPaint> = (context, paint) => {
  const { cell, columns, rows, kind, headroom } = paint;
  const width = columns * cell;
  const height = headroom + rows * cell;
  const light = kind === 'front' ? NIGHT.front : NIGHT.side;

  context.fillStyle = hex(NIGHT.wall);
  context.fillRect(0, 0, width, height);

  // Seams of the wall panels, barely there.
  context.strokeStyle = rgba(0xffffff, 0.05);
  context.lineWidth = Math.max(1, cell * 0.012);
  context.beginPath();
  for (let column = 1; column < columns; column++) {
    context.moveTo(column * cell, 0);
    context.lineTo(column * cell, height);
  }
  for (let row = 1; row < rows; row++) {
    context.moveTo(0, headroom + row * cell);
    context.lineTo(width, headroom + row * cell);
  }
  context.stroke();

  // Pools of light: all the matched cells as one glowing shape, then the
  // stray ones in red.
  const pool = (wanted: (state: CellState) => boolean, color: number): void => {
    if (!cellsPath(context, paint, wanted, cell * 0.08)) return;
    context.save();
    context.shadowColor = rgba(color, 0.95);
    context.shadowBlur = cell * 0.34;
    context.fillStyle = rgba(color, 0.9);
    context.fill();
    // A brighter heart, so the pool reads as light and not as paint.
    context.shadowBlur = 0;
    context.globalCompositeOperation = 'lighter';
    cellsPath(context, paint, wanted, cell * 0.24);
    context.fillStyle = 'rgba(255, 255, 255, 0.22)';
    context.fill();
    context.restore();
  };
  pool((state) => state === 'match', light);
  pool((state) => state === 'extra', NIGHT.red);

  context.lineCap = 'round';
  eachCell(paint, (x, y, state) => {
    if (state === 'missing') {
      // Where light is still wanted: a dim outline in the wall's colour.
      const inset = cell * 0.1;
      context.strokeStyle = rgba(light, 0.62);
      context.lineWidth = cell * 0.032;
      context.strokeRect(x + inset, y + inset, cell - 2 * inset, cell - 2 * inset);
    } else if (state === 'extra') {
      // A cross, so a stray cell is told apart by shape as well as colour.
      context.strokeStyle = rgba(0x1a0605, 0.85);
      context.lineWidth = cell * 0.075;
      crossCell(context, x, y, cell, cell * 0.28);
    }
  });

  context.strokeStyle = rgba(0xffffff, 0.1);
  context.lineWidth = cell * 0.03;
  context.strokeRect(0, 0, width, height);
};

const drawNightFloor: Draw<FloorPaint> = (context, paint) => {
  const { cell, columns, rows } = paint;
  const width = columns * cell;
  const height = rows * cell;
  // The top of the plinth, brightest in the middle where the spotlights meet.
  const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
  glow.addColorStop(0, '#4a4d58');
  glow.addColorStop(1, '#2b2d35');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  context.lineWidth = Math.max(1, cell * 0.014);
  context.beginPath();
  for (let column = 0; column <= columns; column++) {
    context.moveTo(column * cell, 0);
    context.lineTo(column * cell, height);
  }
  for (let row = 0; row <= rows; row++) {
    context.moveTo(0, row * cell);
    context.lineTo(width, row * cell);
  }
  context.stroke();

  contactShadows(context, paint, 0x000000, 0.55);
};

const CROSS_ON_RED =
  'linear-gradient(45deg, transparent 42%, #1a0605 42% 58%, transparent 58%), ' +
  'linear-gradient(-45deg, transparent 42%, #1a0605 42% 58%, transparent 58%), #ff5a52';

const NIGHT_THEME: Theme = {
  id: 'night',
  name: 'night',
  fonts: JOST,
  sceneFont: 'Jost',
  hud: {
    '--page': '#0b0c10',
    '--page-image': 'radial-gradient(95% 55% at 50% 42%, #262830 0%, #14151a 55%, #0b0c10 100%)',
    '--page-size': 'auto',
    '--ink': '#eeece6',
    '--ink-soft': '#a6a8b1',
    '--surface': '#1a1b21',
    '--line': '#3d3f4a',
    '--front': '#ffb347',
    '--side': '#5ad1ff',
    '--extra': '#ff6a62',
    '--floating': '#ffc861',
    '--on-strong': '#0b0c10',
    '--list-bg': '#121318',
    '--overlay': 'rgb(0 0 0 / 68%)',
    '--font-body': "'Jost', 'Century Gothic', 'Avenir Next', Helvetica, Arial, sans-serif",
    '--font-display': "'Jost', 'Century Gothic', 'Avenir Next', Helvetica, Arial, sans-serif",
    '--label-case': 'uppercase',
    '--label-spacing': '0.12em',
    '--count-size': '1.05rem',
    '--radius-control': '10px',
    '--radius-card': '14px',
    '--radius-cell': '2px',
    '--radius-small': '6px',
    '--radius-pill': '999px',
    '--line-thin': '1px',
    '--line-strong': '2px',
    '--icon-stroke': '1.8',
    '--card-border': '1px solid #3d3f4a',
    '--card-shadow': '0 18px 50px rgb(0 0 0 / 70%)',
    '--control-shadow': 'none',
    '--cell-bg': '#15161b',
    '--cell-border': '1px solid #2c2e37',
    '--front-match-bg': '#ffb347',
    '--front-match-border': '1px solid #ffb347',
    '--front-match-shadow': '0 0 6px rgb(255 179 71 / 85%)',
    '--front-missing-bg': 'transparent',
    '--front-missing-border': '1px solid rgb(255 179 71 / 60%)',
    '--side-match-bg': '#5ad1ff',
    '--side-match-border': '1px solid #5ad1ff',
    '--side-match-shadow': '0 0 6px rgb(90 209 255 / 85%)',
    '--side-missing-bg': 'transparent',
    '--side-missing-border': '1px solid rgb(90 209 255 / 60%)',
    '--extra-bg': CROSS_ON_RED,
    '--extra-border': '1px solid #ff5a52',
    '--extra-shadow': '0 0 6px rgb(255 90 82 / 85%)',
  },
  scene: {
    background: null,
    light: {
      ambient: { color: 0x8088a0, intensity: 0.5 },
      hemisphere: { sky: 0x9aa4c0, ground: 0x15161b, intensity: 0.6 },
      lamps: [
        { color: 0xfff0d8, intensity: 3.0, from: [0.7, 1.2, 0.45] },
        { color: 0x9cc2ff, intensity: 1.3, from: [-0.6, 0.8, 0.9] },
      ],
    },
    floor: { style: 'drawn', cellPx: 96, draw: drawNightFloor },
    slab: { color: 0x202229, depth: 0.75, overhang: 0.12 },
    walls: { style: 'drawn', cellPx: 112, headroom: 0, draw: drawNightWall },
    blocks: {
      shape: 'rounded',
      radius: 0.035,
      scale: 0.985,
      material: 'standard',
      roughness: 0.95,
      tones: [0xe9e5db],
      floating: 0xffc861,
      rejected: 0xff5a52,
      edges: null,
      ghost: { color: 0xe9e5db, opacity: 0.3 },
    },
  },
};

// --- Choosing and applying a theme ---------------------------------------------------

export const THEMES: Record<ThemeId, Theme> = {
  plain: PLAIN,
  lamp: LAMP_THEME,
  blueprint: BLUEPRINT_THEME,
  night: NIGHT_THEME,
};

/** The theme every player gets. The others are debug-only until one is chosen. */
export const DEFAULT_THEME: Theme = PLAIN;

/** Which tone a block takes: the same for the same cell every time, with no pattern across the board. */
export const toneIndex = (key: string, tones: number): number => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % Math.max(tones, 1);
};

const loaded = new Set<string>();

/**
 * Starts loading a theme's font files and resolves when they can be drawn
 * with. A font that fails to load is left to the fallback named in the
 * theme's font stack; it never rejects.
 */
export const loadFonts = async (theme: Theme): Promise<void> => {
  if (typeof FontFace === 'undefined') return;
  await Promise.all(
    theme.fonts.map(async ({ family, weight, url }) => {
      if (loaded.has(url)) return;
      loaded.add(url);
      try {
        const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, style: 'normal', display: 'swap' });
        document.fonts.add(face);
        await face.load();
      } catch (error) {
        console.warn(`Could not load the font ${family} ${weight}:`, error);
      }
    })
  );
};

/** Puts a theme's HUD values on the page. The 3D board takes its part when it is built. */
export const applyHudTheme = (theme: Theme, root: HTMLElement = document.documentElement): void => {
  for (const name of HUD_VARIABLES) root.style.setProperty(name, theme.hud[name]);
  root.dataset.theme = theme.id;
  void loadFonts(theme);
};
