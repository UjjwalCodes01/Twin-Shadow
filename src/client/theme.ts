// The look of the game, "Lamp and paper": wooden blocks on a table under two
// lamps, their shadows thrown on cream paper walls.
//
// This is the single place for colours, materials, line weights, fonts and
// corner radii. game.css is layout and sizes only and reads the variables in
// `hud`; paint.ts draws the walls, panels, table and wood from `paint`;
// scene.ts builds the board from `scene`.
//
// Nothing here runs on import and nothing is imported, because the build also
// reads this file to write the HUD variables into the stylesheet. Scene and
// paint colours are plain numbers (0xrrggbb). Sizes in `paint` are shares of
// one cell unless they say pixels.

// --- The HUD -------------------------------------------------------------------

/** Every CSS variable game.css reads. */
export const HUD_VARIABLES = [
  // Colours.
  '--page',
  '--page-image',
  '--ink',
  '--ink-soft',
  '--surface',
  '--line',
  '--front',
  '--side',
  '--extra',
  '--warn',
  '--star-fill',
  '--star-line',
  '--on-strong',
  '--list-bg',
  '--overlay',
  // Fonts.
  '--font-body',
  '--font-display',
  // Corner radii.
  '--radius-control',
  '--radius-card',
  '--radius-small',
  '--radius-pill',
  // Line weights.
  '--line-thin',
  '--line-strong',
  '--icon-stroke',
  '--star-stroke',
  // Depth: how cards, panels and buttons sit on the page.
  '--card-border',
  '--card-shadow',
  '--panel-shadow',
  '--control-shadow',
  '--control-shadow-pressed',
] as const;
export type HudVariable = (typeof HUD_VARIABLES)[number];
export type HudTheme = Record<HudVariable, string>;

export type FontFile = { family: string; weight: '400' | '700'; url: string };

// --- Fonts -----------------------------------------------------------------------
// Bundled with the app under the SIL Open Font License. See fonts/README.md.
// Each address is written out in full, as `new URL('<file>', import.meta.url)`:
// that exact form is what tells the build to ship the file with the app.

const FONTS: FontFile[] = [
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

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";

// --- Colours shared by the HUD and the board ----------------------------------------
// Named once here, so the panel labels, the wall shadows and the lamps that
// tint the blocks cannot drift apart.

const WARM_SHADOW = 0x4a2c1a; // thrown on the front wall by the warm lamp
const COOL_SHADOW = 0x24324e; // thrown on the side wall by the cool lamp
const WRONG_RED = 0xb8321f;
const PENCIL = 0x4f4034;
const PAPER = 0xf6edd9;

const HUD: HudTheme = {
  '--page': '#dfcfb0',
  '--page-image': 'radial-gradient(120% 75% at 50% 34%, #f7ecd3 0%, #e6d6b6 55%, #d2bd97 100%)',
  '--ink': '#3a291c',
  '--ink-soft': '#554232',
  '--surface': '#fbf4e3',
  '--line': '#bfa880',
  '--front': '#74330f',
  '--side': '#2c456e',
  '--extra': '#8c1e0e',
  '--warn': '#6e3e00',
  '--star-fill': '#e0a63a',
  '--star-line': '#6a4410',
  '--on-strong': '#fff8ea',
  '--list-bg': '#fffaf0',
  '--overlay': 'rgb(58 41 28 / 58%)',
  '--font-body': SERIF,
  '--font-display': SERIF,
  '--radius-control': '7px',
  '--radius-card': '5px',
  '--radius-small': '4px',
  '--radius-pill': '999px',
  '--line-thin': '1px',
  '--line-strong': '2px',
  '--icon-stroke': '1.9',
  '--star-stroke': '1.6',
  '--card-border': '1px solid #c8b390',
  '--card-shadow': '0 12px 30px rgb(58 41 28 / 38%), 0 2px 4px rgb(58 41 28 / 22%)',
  '--panel-shadow': '0 2px 5px rgb(58 41 28 / 22%)',
  // A button is a small raised tile: a hard edge below it, which a press takes away.
  '--control-shadow': '0 2px 0 rgb(58 41 28 / 30%)',
  '--control-shadow-pressed': 'inset 0 2px 3px rgb(58 41 28 / 30%)',
};

// --- What is painted on a canvas: walls, panels, table and wood ---------------------

const PAINT = {
  /** A wall, and the Front and Side panels, which are painted by the same code. */
  wall: {
    paper: PAPER,
    edge: { color: 0xcdbb98, weight: 0.04 },
    /** Fibres scattered over the paper. */
    specks: { perCell: 26, dark: PENCIL, darkAlpha: 0.05, lightAlpha: 0.35 },
    /** The ruling over the whole sheet, and the slightly firmer one inside the target shape. */
    grid: { color: PENCIL, alpha: 0.07, insideAlpha: 0.22, weight: 0.012, minPx: 0.5 },
    /**
     * The inside of the target shape, washed faintly in its lamp's colour so
     * the regions that want shadow can be told from bare paper before any
     * block is placed. Far lighter than the shadow itself.
     */
    wash: { front: 0xb86a3a, side: 0x4a6fae, alpha: 0.17 },
    /** The cast shadow: one shape for all the cells that are lit, see-through, soft at the edge. */
    shadow: { front: WARM_SHADOW, side: COOL_SHADOW, alpha: 0.74, blur: 0.085 },
    /** The one dashed pencil line round the whole target shape. */
    outline: {
      color: PENCIL,
      alpha: 0.9,
      /** The same line where it runs over shadow, where pencil would not show. */
      overShadow: PAPER,
      overShadowAlpha: 0.5,
      weight: 0.036,
      minPx: 1.5,
      dash: 0.15,
      gap: 0.1,
      inset: 0.06,
    },
    /** Shadow where there should be none: tinted red, with pencil strokes through it. */
    extra: {
      tint: WRONG_RED,
      alpha: 0.62,
      blur: 0.07,
      stroke: { color: 0xfff3e2, alpha: 0.9, weight: 0.05, minPx: 1.5, gap: 0.2, inset: 0.1 },
    },
  },

  /** The table top. */
  table: {
    wood: 0x94683f,
    grain: { dark: 0x5f3f24, darkAlpha: 0.22, light: 0xffe2aa, lightAlpha: 0.12, perRow: 22 },
    /** Where each block may stand, marked lightly. */
    marks: { color: 0xffecc8, alpha: 0.26, weight: 0.015, minPx: 1 },
    /** The soft shadow each standing block casts, pushed away from the two lamps. */
    shadow: { color: 0x2a1608, alpha: 0.5, blur: 0.26, spread: 0.07, shift: 0.1, fade: 0.9 },
  },

  /** The wood drawn on each face of a block. The tone of the block is laid over this. */
  wood: {
    /** Pixels along one face. */
    size: 128,
    /** How many different pieces of each grain there are to choose from. */
    variants: 3,
    base: 0xffffff,
    /** Side faces: lines running up the block. */
    lines: { color: 0x6b4526, alpha: 0.2, count: 26, weight: 1.6, wander: 5 },
    /** Top faces: end grain, as rings. */
    rings: { color: 0x6b4526, alpha: 0.24, count: 9, weight: 1.8 },
    /** Fine flecks over both. */
    flecks: { color: 0x4a2c14, alpha: 0.1, count: 90 },
    /** A floating block: paler, with a dashed pencil line round each face. */
    floating: {
      wash: 0xfff6e4,
      washAlpha: 0.5,
      outline: PENCIL,
      outlineAlpha: 0.95,
      weight: 5,
      dash: 13,
      gap: 8,
      inset: 9,
    },
  },
} as const;

// --- The 3D board ----------------------------------------------------------------

const SCENE = {
  light: {
    ambient: { color: 0xfff1dc, intensity: 0.55 },
    hemisphere: { sky: 0xfff4de, ground: 0x7a5a3a, intensity: 1.5 },
    /** The two lamps. Each shines from `from` towards the middle of the board. */
    lamps: [
      { color: 0xffd9a3, intensity: 2.4, from: [0.9, 1.1, 0.5] },
      { color: 0xc6d6ff, intensity: 1.0, from: [-0.5, 0.7, 1] },
    ],
  },
  /** The table under the board: wider than it by `overhang`, `depth` thick. */
  table: { color: 0x6e4a2c, depth: 0.28, overhang: 0.22, roughness: 0.8 },
  /** Pixels per cell of the painted walls and table. */
  wallCellPx: 112,
  tableCellPx: 96,
  /**
   * How hard textures seen at a slant are sharpened, up to what the device
   * allows. The walls and table are large and steeply slanted; a block face is small.
   */
  sharpen: { sheets: 4, wood: 2 },
  blocks: {
    /** Corner radius, and size of the block inside its cell: below 1 leaves a groove between blocks. */
    radius: 0.075,
    scale: 0.975,
    roughness: 0.72,
    /** Each block takes one of these, always the same for the same cell. */
    tones: [0xe8c796, 0xdcb27c, 0xcd9c66, 0xbf8853],
    /**
     * The two lamps on the two pairs of side faces: the faces across the
     * front lamp's light lean warm, the others cool. `amount` is how far each
     * leans, from 0 (not at all) to 1.
     */
    lampTint: { warm: 0xffb066, cool: 0x9fb6e0, amount: 0.1 },
    /** Darkening where a block meets a neighbour or the table. */
    contact: { wall: 0.34, seam: 0.13, corner: 0.16, reach: 0.55 },
    /** A block with nothing under it: paler, smaller and lifted, so it hovers. */
    floating: { color: 0xf4e6c8, lift: 0.07, scale: 0.86 },
    /** The flash on a block whose tap was refused: the wood, stained red. */
    refused: { color: WRONG_RED, amount: 0.62 },
    /** The pencilled-in block shown under a mouse pointer. */
    ghost: { opacity: 0.55 },
  },
} as const;

// --- Motion ----------------------------------------------------------------------
// Quick and physical, like wooden blocks on a table. Times are milliseconds;
// distances are shares of one cell. A device that asks for reduced motion
// gets `reduced` instead: nothing travels, and what fades fades briefly.

const MOTION = {
  /** A block put down: it falls this far in `fallMs`, then settles with one small rebound. */
  drop: { height: 0.42, fallMs: 85, settleMs: 40, rebound: 0.035 },
  /** A block taken away: it rises this far while it fades out. */
  lift: { height: 0.3, ms: 100 },
  /** A sculpture swapped for another while viewing: blocks fade rather than fall. */
  swapMs: 160,
  /** Shadow arriving on or leaving a wall or panel. */
  shadowMs: 150,
  /** A block with nothing under it rides up and down very slightly. */
  bob: { height: 0.028, periodMs: 1700 },
  /** The moment a sculpture first becomes a valid solve: both shadows deepen, then ease back. */
  solve: { deepen: 1.24, holdMs: 260 },
  /** The floor tile a first-time player is pointed at. */
  pulse: { color: 0xfff1cf, low: 0.25, high: 0.8, periodMs: 1100 },
  reduced: { shadowMs: 90, swapMs: 90 },
} as const;

export const THEME = { fonts: FONTS, hud: HUD, paint: PAINT, scene: SCENE, motion: MOTION } as const;
export type Theme = typeof THEME;

/** Which of `count` choices a cell takes: the same every time, with no pattern across the board. */
export const pickFor = (key: string, count: number, salt = 0): number => {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % Math.max(count, 1);
};

let fontsLoading: Promise<void> | null = null;

/**
 * Loads the font files and resolves when they can be drawn with. A font that
 * fails to load is left to the fallback named in the font stack; it never rejects.
 */
export const loadFonts = (): Promise<void> => {
  if (typeof FontFace === 'undefined') return Promise.resolve();
  fontsLoading ??= Promise.all(
    THEME.fonts.map(async ({ family, weight, url }) => {
      try {
        const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, style: 'normal', display: 'swap' });
        document.fonts.add(face);
        await face.load();
      } catch (error) {
        console.warn(`Could not load the font ${family} ${weight}:`, error);
      }
    })
  ).then(() => undefined);
  return fontsLoading;
};

/**
 * Puts the HUD values on the page and starts the fonts loading. The build
 * has already written the same values into the stylesheet, so this changes
 * nothing that is visible; it is what makes theme.ts, not the stylesheet,
 * the place the page takes its values from.
 */
export const applyTheme = (root: HTMLElement = document.documentElement): void => {
  for (const name of HUD_VARIABLES) root.style.setProperty(name, THEME.hud[name]);
  void loadFonts();
};
