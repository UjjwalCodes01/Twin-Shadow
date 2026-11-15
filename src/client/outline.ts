// Turns a set of grid cells into the closed outlines of the shape they make.
// One outline per outer edge and one per hole, each a single loop, so a dashed
// line can run round the whole shape without breaking at every cell. No DOM.

export type Point = { x: number; y: number };

/** One closed outline: corners in order, in cell units. The last joins the first. */
export type Loop = Point[];

const pointKey = (x: number, y: number): string => `${x},${y}`;

/**
 * The outlines of the cells where `filled[row][column]` is true. Rows run
 * down the page. Each loop keeps the shape on its right as it goes, so outer
 * edges run clockwise and holes anticlockwise, and only real corners are kept.
 * Cells that touch only at a corner get separate loops.
 */
export const outlineLoops = (filled: readonly (readonly boolean[])[]): Loop[] => {
  const at = (column: number, row: number): boolean => filled[row]?.[column] === true;

  // Every cell side that has the shape on one side and nothing on the other,
  // as a step from one grid corner to the next with the shape on its right.
  type Step = { from: Point; to: Point; used: boolean };
  const steps: Step[] = [];
  const leaving = new Map<string, Step[]>();
  const add = (fromX: number, fromY: number, toX: number, toY: number): void => {
    const step: Step = { from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, used: false };
    steps.push(step);
    const key = pointKey(fromX, fromY);
    leaving.set(key, [...(leaving.get(key) ?? []), step]);
  };
  filled.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      if (!cell) return;
      if (!at(column, row - 1)) add(column, row, column + 1, row); // top, going right
      if (!at(column + 1, row)) add(column + 1, row, column + 1, row + 1); // right, going down
      if (!at(column, row + 1)) add(column + 1, row + 1, column, row + 1); // bottom, going left
      if (!at(column - 1, row)) add(column, row + 1, column, row); // left, going up
    });
  });

  const loops: Loop[] = [];
  for (const first of steps) {
    if (first.used) continue;
    const corners: Point[] = [];
    let step = first;
    for (;;) {
      step.used = true;
      corners.push(step.from);
      const choices = (leaving.get(pointKey(step.to.x, step.to.y)) ?? []).filter((next) => !next.used);
      if (choices.length === 0) break;
      // Where two cells meet at a corner there are two ways on. Turning
      // right, towards the shape, keeps each cell in its own loop.
      const dx = step.to.x - step.from.x;
      const dy = step.to.y - step.from.y;
      const turn = (next: Step): number => dx * (next.to.y - next.from.y) - dy * (next.to.x - next.from.x);
      step = choices.reduce((best, next) => (turn(next) > turn(best) ? next : best));
      if (step === first) break;
    }

    // Drop the points that lie along a straight run, keeping the corners.
    const loop = corners.filter((point, index) => {
      const before = corners[(index - 1 + corners.length) % corners.length];
      const after = corners[(index + 1) % corners.length];
      if (!before || !after) return true;
      return (point.x - before.x) * (after.y - point.y) !== (point.y - before.y) * (after.x - point.x);
    });
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
};

/** The length of a loop, in cell units. */
export const loopLength = (loop: Loop): number =>
  loop.reduce((total, point, index) => {
    const next = loop[(index + 1) % loop.length];
    return next ? total + Math.abs(next.x - point.x) + Math.abs(next.y - point.y) : total;
  }, 0);

/**
 * Moves a loop's corners into the shape by `distance`, so a line drawn along
 * it sits just inside the cells' edges. Works for inner and outer corners and
 * for holes, because the shape is always on the loop's right.
 */
export const insetLoop = (loop: Loop, distance: number): Loop =>
  loop.map((point, index) => {
    const before = loop[(index - 1 + loop.length) % loop.length];
    const after = loop[(index + 1) % loop.length];
    if (!before || !after) return point;
    // The inward side of a step going (dx, dy) is (-dy, dx), with y running down the page.
    const inX = Math.sign(point.x - before.x);
    const inY = Math.sign(point.y - before.y);
    const outX = Math.sign(after.x - point.x);
    const outY = Math.sign(after.y - point.y);
    return { x: point.x + distance * (-inY - outY), y: point.y + distance * (inX + outX) };
  });

/**
 * A dash and gap that fit a whole number of times round a line of `length`,
 * as close as possible to the dash and gap asked for, so the pattern meets
 * itself cleanly where the loop closes.
 */
export const fitDashes = (length: number, dash: number, gap: number): { dash: number; gap: number } => {
  const period = dash + gap;
  if (!(length > 0) || !(period > 0)) return { dash, gap };
  const repeats = Math.max(Math.round(length / period), 2);
  const scale = length / (repeats * period);
  return { dash: dash * scale, gap: gap * scale };
};
