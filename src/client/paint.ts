// Everything that is painted on a 2D canvas, in code, with no image files: the
// paper walls with their shadows (and the Front and Side panels, which are
// the same painting, smaller), the table top, and the wood on a block's faces.
// What to paint is decided here; every colour and weight comes from theme.ts.

import { parseSilhouette, type CellState } from '../shared/logic';
import { fitDashes, insetLoop, loopLength, outlineLoops, type Loop } from './outline';
import { THEME } from './theme';

export type WallKind = 'front' | 'side';

/** One wall, or one panel, to paint. */
export type WallPaint = {
  kind: WallKind;
  columns: number;
  rows: number;
  /** Canvas pixels per cell. */
  cell: number;
  /** [row][column] in drawing order: top row first, columns left to right as seen. */
  states: CellState[][];
  /**
   * Canvas pixels per pixel of the smallest line worth drawing: 1 for a wall,
   * the screen's pixel ratio for a panel, so thin lines never vanish.
   */
  unit: number;
  /**
   * How much deeper than usual the shadow is: 1 as a rule, a little more for
   * the moment a sculpture first becomes a valid solve.
   */
  depth?: number;
};

/**
 * A canvas whose picture fades from the old one to the new one instead of
 * switching. Used for the walls and the panels, so shadow arrives and leaves
 * softly on both together.
 */
export type CrossFade = {
  /**
   * Paints a new picture. With `ms` above 0 it fades in over what is showing;
   * otherwise it is simply shown. The first picture is always simply shown.
   */
  show: (paint: (context: Context) => void, now: number, ms: number) => void;
  /** Brings the canvas up to date for the time `now`. Returns whether it changed. */
  step: (now: number) => boolean;
  /** True while a fade is under way. */
  fading: () => boolean;
};

export const createCrossFade = (display: Context): CrossFade => {
  const { width, height } = display.canvas;
  const layer = (): Context | null => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d');
  };
  // The picture being left and the picture being arrived at. Made only when first needed.
  let from: Context | null = null;
  let to: Context | null = null;
  let shown = false;
  let fade: { startedAt: number; ms: number } | null = null;

  return {
    show: (paint, now, ms) => {
      from ??= layer();
      to ??= layer();
      if (!shown || ms <= 0 || !from || !to) {
        shown = true;
        fade = null;
        paint(display);
        return;
      }
      // Whatever is showing now, even half way through an earlier fade, is what is left behind.
      from.clearRect(0, 0, width, height);
      from.drawImage(display.canvas, 0, 0);
      paint(to);
      fade = { startedAt: now, ms };
    },
    step: (now) => {
      if (!fade || !from || !to) return false;
      const progress = Math.min(Math.max((now - fade.startedAt) / fade.ms, 0), 1);
      display.clearRect(0, 0, width, height);
      display.drawImage(from.canvas, 0, 0);
      display.globalAlpha = progress;
      display.drawImage(to.canvas, 0, 0);
      display.globalAlpha = 1;
      if (progress >= 1) fade = null;
      return true;
    },
    fading: () => fade !== null,
  };
};

/** The table to paint, seen from above with the back row at the top. */
export type TablePaint = {
  columns: number;
  rows: number;
  /** Canvas pixels per tile. */
  cell: number;
  /** [row][column]: height of the lowest standing block above each tile, -1 where there is none. */
  lowest: number[][];
};

/** The wood on one face of a block. */
export type WoodPaint = {
  /** True for a top face, which shows end grain. */
  end: boolean;
  /** Which piece of wood: one of `THEME.paint.wood.variants`. */
  variant: number;
  /** True for a block with nothing under it. */
  floating: boolean;
};

type Context = CanvasRenderingContext2D;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const rgba = (color: number, alpha: number): string =>
  `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;

/**
 * A fixed scatter of numbers in [0, 1) for specks and grain: the same every
 * time, so nothing shimmers when it is painted again.
 */
const scatter = (seed: number): (() => number) => {
  let step = seed;
  return () => {
    step += 1;
    const value = Math.sin(step * 127.1 + seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
};

/** Adds every loop to the current path, scaled from cells to pixels. */
const tracePath = (context: Context, loops: Loop[], cell: number): void => {
  context.beginPath();
  for (const loop of loops) {
    loop.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x * cell, point.y * cell);
      else context.lineTo(point.x * cell, point.y * cell);
    });
    context.closePath();
  }
};

// Far enough that a shape drawn there is off any canvas, leaving only its shadow.
const OFFSTAGE = 20000;

/**
 * Fills a shape so that it is soft at the edge and the same strength all the
 * way across: the shape itself is drawn off the canvas and only the blurred
 * shadow it throws lands on it.
 */
const softFill = (context: Context, loops: Loop[], cell: number, color: string, blur: number): void => {
  if (loops.length === 0) return;
  context.save();
  context.shadowColor = color;
  context.shadowBlur = blur;
  context.shadowOffsetX = OFFSTAGE;
  context.translate(-OFFSTAGE, 0);
  context.fillStyle = '#000000';
  tracePath(context, loops, cell);
  context.fill();
  context.restore();
};

const is = (states: CellState[][], wanted: (state: CellState) => boolean): boolean[][] =>
  states.map((row) => row.map(wanted));

// The parts of a wall and of the table that never change (the paper with its
// fibres and ruling, the wood with its grain) are painted once and kept, so a
// change to the board only has to lay the shadows over them.
const kept = new Map<string, HTMLCanvasElement>();

/** A canvas painted once by `draw` and kept under `key`, or null where a canvas cannot be had. */
const paintedOnce = (
  key: string,
  width: number,
  height: number,
  draw: (context: Context) => void
): HTMLCanvasElement | null => {
  const found = kept.get(key);
  if (found) return found;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  draw(context);
  kept.set(key, canvas);
  return canvas;
};

/** Paints the bare sheet of a wall: paper, fibres and a very faint ruling. */
const paintPaper = (context: Context, { cell, columns, rows, kind, unit }: Omit<WallPaint, 'states'>): void => {
  const look = THEME.paint.wall;
  const width = columns * cell;
  const height = rows * cell;
  context.fillStyle = hex(look.paper);
  context.fillRect(0, 0, width, height);
  // A speckle of fibres, so the paper is not a flat fill.
  const random = scatter(kind === 'front' ? 11 : 23);
  const specks = Math.round(columns * rows * look.specks.perCell * Math.min(1, (cell / 112) ** 2));
  for (let speck = 0; speck < specks; speck++) {
    const dark = random() < 0.5;
    context.fillStyle = dark ? rgba(look.specks.dark, look.specks.darkAlpha) : `rgba(255, 255, 255, ${look.specks.lightAlpha})`;
    context.fillRect(random() * width, random() * height, 1 + random() * 2.5, 1);
  }
  context.lineWidth = Math.max(look.grid.weight * cell, look.grid.minPx * unit);
  context.strokeStyle = rgba(look.grid.color, look.grid.alpha);
  ruleCells(context, columns, rows, cell);
};

/** Strokes the lines between the cells of a sheet. */
const ruleCells = (context: Context, columns: number, rows: number, cell: number): void => {
  context.beginPath();
  for (let column = 1; column < columns; column++) {
    context.moveTo(column * cell, 0);
    context.lineTo(column * cell, rows * cell);
  }
  for (let row = 1; row < rows; row++) {
    context.moveTo(0, row * cell);
    context.lineTo(columns * cell, row * cell);
  }
  context.stroke();
};

/** Paints a wall: paper, the outline of the shape wanted, and the shadow the blocks throw. */
export const paintWall = (context: Context, paint: WallPaint): void => {
  const { cell, columns, rows, kind, states, unit } = paint;
  const look = THEME.paint.wall;
  const width = columns * cell;
  const height = rows * cell;
  const weight = (share: number, minPx: number): number => Math.max(share * cell, minPx * unit);

  // The three shapes everything is drawn from. Each is a few closed loops,
  // never a cell at a time, so nothing shows where two cells meet.
  const target = outlineLoops(is(states, (state) => state === 'match' || state === 'missing'));
  const lit = outlineLoops(is(states, (state) => state === 'match' || state === 'extra'));
  const extra = outlineLoops(is(states, (state) => state === 'extra'));

  // The bare sheet, painted once for each wall and reused.
  const paper = paintedOnce(`paper:${kind}:${columns}:${rows}:${cell}:${unit}`, width, height, (sheet) =>
    paintPaper(sheet, paint)
  );
  context.clearRect(0, 0, width, height);
  if (paper) context.drawImage(paper, 0, 0);
  else paintPaper(context, paint);

  // The inside of the wanted shape: a faint wash of its lamp's colour, and
  // the ruling a little firmer, so its cells can still be counted.
  if (target.length > 0) {
    context.save();
    tracePath(context, target, cell);
    context.clip();
    context.fillStyle = rgba(kind === 'front' ? look.wash.front : look.wash.side, look.wash.alpha);
    context.fillRect(0, 0, width, height);
    context.lineWidth = weight(look.grid.weight, look.grid.minPx);
    context.strokeStyle = rgba(look.grid.color, look.grid.insideAlpha);
    ruleCells(context, columns, rows, cell);
    context.restore();
  }

  // The cast shadow: every lit cell as one soft, see-through shape.
  const shadow = kind === 'front' ? look.shadow.front : look.shadow.side;
  const depth = Math.min(look.shadow.alpha * (paint.depth ?? 1), 0.96);
  softFill(context, lit, cell, rgba(shadow, depth), look.shadow.blur * cell);

  // Shadow that falls where it should not: tinted red, and struck through
  // with pencil so it reads as wrong without its colour.
  if (extra.length > 0) {
    softFill(context, extra, cell, rgba(look.extra.tint, look.extra.alpha), look.extra.blur * cell);
    const { stroke } = look.extra;
    context.save();
    tracePath(
      context,
      extra.map((loop) => insetLoop(loop, stroke.inset)),
      cell
    );
    context.clip();
    context.strokeStyle = rgba(stroke.color, stroke.alpha);
    context.lineWidth = weight(stroke.weight, stroke.minPx);
    context.lineCap = 'round';
    context.beginPath();
    const gap = Math.max(stroke.gap * cell, 3.5 * unit);
    for (let offset = -height; offset < width; offset += gap) {
      context.moveTo(offset, height);
      context.lineTo(offset + height, 0);
    }
    context.stroke();
    context.restore();
  }

  // One dashed pencil line round the whole wanted shape, holes included. Each
  // loop is a single path, so the dashes run on round its corners, and they
  // are fitted to its length, so they meet cleanly where it closes.
  const { outline } = look;
  const strokeOutline = (color: string): void => {
    context.strokeStyle = color;
    context.lineWidth = weight(outline.weight, outline.minPx);
    context.lineJoin = 'round';
    context.lineCap = 'butt';
    for (const loop of target) {
      const inset = insetLoop(loop, outline.inset);
      const { dash, gap } = fitDashes(
        loopLength(inset) * cell,
        Math.max(outline.dash * cell, 3.2 * unit),
        Math.max(outline.gap * cell, 2.2 * unit)
      );
      context.setLineDash([dash, gap]);
      // Half a dash back, so a dash sits centred on the first corner.
      context.lineDashOffset = dash / 2;
      tracePath(context, [inset], cell);
      context.stroke();
    }
    context.setLineDash([]);
    context.lineDashOffset = 0;
  };
  strokeOutline(rgba(outline.color, outline.alpha));
  if (lit.length > 0) {
    // Pencil does not show on shadow, so there the same line is drawn light.
    context.save();
    tracePath(context, lit, cell);
    context.clip();
    strokeOutline(rgba(outline.overShadow, outline.overShadowAlpha));
    context.restore();
  }

  // The edge of the sheet.
  context.strokeStyle = hex(look.edge.color);
  context.lineWidth = weight(look.edge.weight, 1);
  context.strokeRect(0, 0, width, height);
};

/** Paints the bare table top: wood with its grain, and the marks where blocks may stand. */
const paintTableWood = (context: Context, columns: number, rows: number, cell: number): void => {
  const look = THEME.paint.table;
  const width = columns * cell;
  const height = rows * cell;
  context.fillStyle = hex(look.wood);
  context.fillRect(0, 0, width, height);

  // Grain: long strokes along the boards, wavering slightly.
  const random = scatter(7);
  for (let stroke = 0; stroke < rows * look.grain.perRow; stroke++) {
    const y = random() * height;
    const start = random() * width * 0.6 - width * 0.1;
    const length = width * (0.3 + random() * 0.7);
    context.strokeStyle =
      random() < 0.6 ? rgba(look.grain.dark, look.grain.darkAlpha) : rgba(look.grain.light, look.grain.lightAlpha);
    context.lineWidth = 1 + random() * 1.5;
    context.beginPath();
    context.moveTo(start, y);
    context.bezierCurveTo(start + length * 0.3, y + 3, start + length * 0.6, y - 3, start + length, y + 1);
    context.stroke();
  }

  context.strokeStyle = rgba(look.marks.color, look.marks.alpha);
  context.lineWidth = Math.max(look.marks.minPx, cell * look.marks.weight);
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

/** Paints the table top: the wood, and over it the shadows of the blocks standing on it. */
export const paintTable = (context: Context, paint: TablePaint): void => {
  const { cell, columns, rows, lowest } = paint;
  const look = THEME.paint.table;
  const width = columns * cell;
  const height = rows * cell;

  // The wood and the marks, painted once and reused.
  const wood = paintedOnce(`table:${columns}:${rows}:${cell}`, width, height, (sheet) =>
    paintTableWood(sheet, columns, rows, cell)
  );
  context.clearRect(0, 0, width, height);
  if (wood) context.drawImage(wood, 0, 0);
  else paintTableWood(context, columns, rows, cell);

  // Each standing block throws a soft shadow, pushed towards the back and the
  // left, away from the two lamps. A block higher up throws a fainter one.
  // Blurring is the costly part, so all the blocks at one height are blurred
  // together as a single shape.
  const { shadow } = look;
  const heights = [...new Set(lowest.flat().filter((heightAbove) => heightAbove >= 0))];
  context.save();
  context.shadowBlur = cell * shadow.blur;
  context.shadowOffsetX = OFFSTAGE;
  context.fillStyle = '#000000';
  for (const heightAbove of heights) {
    context.shadowColor = rgba(shadow.color, shadow.alpha / (1 + heightAbove * shadow.fade));
    const spread = cell * (shadow.spread + Math.min(heightAbove, 3) * 0.05);
    const shift = cell * shadow.shift;
    context.beginPath();
    lowest.forEach((row, rowIndex) => {
      row.forEach((value, column) => {
        if (value !== heightAbove) return;
        context.rect(
          column * cell - spread - shift - OFFSTAGE,
          rowIndex * cell - spread - shift,
          cell + 2 * spread,
          cell + 2 * spread
        );
      });
    });
    // Squares that overlap must not cancel each other out.
    context.fill('nonzero');
  }
  context.restore();
};

/**
 * Paints the wood of one face of a block, in near-white: the block's own tone
 * is laid over it, so the same painting serves every tone.
 */
export const paintWood = (context: Context, { end, variant, floating }: WoodPaint): void => {
  const look = THEME.paint.wood;
  const { size } = look;
  const random = scatter(101 + variant * 17 + (end ? 53 : 0));
  context.clearRect(0, 0, size, size);
  context.fillStyle = hex(look.base);
  context.fillRect(0, 0, size, size);
  context.lineCap = 'round';

  if (end) {
    // End grain: growth rings round a heart that lies off the face.
    const { rings } = look;
    const heartX = size * (random() < 0.5 ? -0.25 - random() * 0.3 : 1.25 + random() * 0.3);
    const heartY = size * (-0.2 + random() * 1.4);
    const reach = Math.hypot(Math.max(heartX, size - heartX), Math.max(heartY, size - heartY));
    const step = reach / (rings.count * 2.2);
    for (let radius = step; radius < reach; radius += step * (0.7 + random() * 0.6)) {
      context.strokeStyle = rgba(rings.color, rings.alpha * (0.45 + random() * 0.55));
      context.lineWidth = rings.weight * (0.6 + random() * 0.9);
      context.beginPath();
      context.ellipse(heartX, heartY, radius, radius * (0.92 + random() * 0.12), 0, 0, Math.PI * 2);
      context.stroke();
    }
  } else {
    // Long grain: lines running up the face, never quite straight.
    const { lines } = look;
    for (let line = 0; line < lines.count; line++) {
      const x = random() * size;
      const wander = (random() - 0.5) * 2 * lines.wander;
      context.strokeStyle = rgba(lines.color, lines.alpha * (0.35 + random() * 0.65));
      context.lineWidth = lines.weight * (0.5 + random());
      context.beginPath();
      context.moveTo(x, -2);
      context.bezierCurveTo(x + wander, size * 0.33, x - wander, size * 0.66, x + wander * 0.5, size + 2);
      context.stroke();
    }
  }

  const { flecks } = look;
  context.strokeStyle = rgba(flecks.color, flecks.alpha);
  context.lineWidth = 1;
  context.beginPath();
  for (let fleck = 0; fleck < flecks.count; fleck++) {
    const x = random() * size;
    const y = random() * size;
    const length = 2 + random() * 5;
    context.moveTo(x, y);
    // Along the grain on a side face, any way round on end grain.
    context.lineTo(end ? x + (random() - 0.5) * length : x, end ? y + (random() - 0.5) * length : y + length);
  }
  context.stroke();

  if (floating) {
    // Paler, and outlined in dashed pencil like a part not yet fixed in place.
    const { floating: hover } = look;
    context.fillStyle = rgba(hover.wash, hover.washAlpha);
    context.fillRect(0, 0, size, size);
    const side = size - 2 * hover.inset;
    const { dash, gap } = fitDashes(side * 4, hover.dash, hover.gap);
    context.strokeStyle = rgba(hover.outline, hover.outlineAlpha);
    context.lineWidth = hover.weight;
    context.lineCap = 'butt';
    context.lineJoin = 'round';
    context.setLineDash([dash, gap]);
    context.lineDashOffset = dash / 2;
    context.strokeRect(hover.inset, hover.inset, side, side);
    context.setLineDash([]);
    context.lineDashOffset = 0;
  }
};

/** Panels are drawn no finer than this many canvas pixels per CSS pixel. */
const MAX_PANEL_RATIO = 3;

/**
 * Paints one silhouette of a puzzle on a small canvas, as a sheet of the same
 * paper as the walls: the shape wanted, or with `filled` the shape full of
 * shadow. `rows` are the silhouette as a puzzle stores it, top row first, and
 * `panelPx` is the longest side of the panel in CSS pixels.
 */
export const paintSilhouette = (
  canvas: HTMLCanvasElement,
  kind: WallKind,
  rows: readonly string[],
  filled: boolean,
  panelPx: number
): void => {
  // Top row first, as the silhouette is written and as the painter wants it.
  const grid = [...parseSilhouette(rows)].reverse();
  const columns = grid[0]?.length ?? 0;
  const context = canvas.getContext('2d');
  if (columns === 0 || !context) return;
  const cellPx = Math.floor(panelPx / Math.max(columns, grid.length));
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PANEL_RATIO);
  canvas.width = Math.round(columns * cellPx * ratio);
  canvas.height = Math.round(grid.length * cellPx * ratio);
  canvas.style.width = `${columns * cellPx}px`;
  canvas.style.height = `${grid.length * cellPx}px`;
  const lit: CellState = filled ? 'match' : 'missing';
  paintWall(context, {
    kind,
    columns,
    rows: grid.length,
    cell: cellPx * ratio,
    states: grid.map((row) => row.map((wanted): CellState => (wanted ? lit : 'empty'))),
    unit: ratio,
  });
};
