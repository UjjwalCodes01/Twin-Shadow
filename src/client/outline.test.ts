import { describe, expect, it } from 'vitest';
import { fitDashes, insetLoop, loopLength, outlineLoops, type Loop } from './outline';

/** Rows of '#' and '.' into a grid of booleans. */
const grid = (rows: string[]): boolean[][] => rows.map((row) => [...row].map((cell) => cell === '#'));

/** Area inside a loop by the shoelace rule: positive for a clockwise loop on a page whose y runs down. */
const signedArea = (loop: Loop): number =>
  loop.reduce((total, point, index) => {
    const next = loop[(index + 1) % loop.length];
    return next ? total + (point.x * next.y - next.x * point.y) / 2 : total;
  }, 0);

const cellCount = (rows: string[]): number => rows.join('').split('#').length - 1;

/** Every unit side of every loop, as "x1,y1>x2,y2". */
const unitSides = (loops: Loop[]): string[] =>
  loops.flatMap((loop) =>
    loop.flatMap((point, index) => {
      const next = loop[(index + 1) % loop.length];
      if (!next) return [];
      const steps = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
      const dx = Math.sign(next.x - point.x);
      const dy = Math.sign(next.y - point.y);
      return Array.from(
        { length: steps },
        (_, step) => `${point.x + dx * step},${point.y + dy * step}>${point.x + dx * (step + 1)},${point.y + dy * (step + 1)}`
      );
    })
  );

describe('outlineLoops', () => {
  it('gives nothing for an empty grid', () => {
    expect(outlineLoops(grid(['...', '...']))).toEqual([]);
    expect(outlineLoops([])).toEqual([]);
  });

  it('outlines one cell as a square, clockwise', () => {
    expect(outlineLoops(grid(['#']))).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    ]);
  });

  it('outlines a row of cells as one rectangle, with no line between them', () => {
    const loops = outlineLoops(grid(['###']));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(loopLength(loops[0] ?? [])).toBe(8);
  });

  it('follows an L shape with six corners', () => {
    const loops = outlineLoops(grid(['#.', '##']));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    expect(signedArea(loops[0] ?? [])).toBe(3);
  });

  it('gives a hole its own loop, running the other way', () => {
    const loops = outlineLoops(grid(['###', '#.#', '###']));
    expect(loops).toHaveLength(2);
    const areas = loops.map(signedArea).sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]);
  });

  it('keeps cells that touch only at a corner in separate loops', () => {
    const loops = outlineLoops(grid(['#.', '.#']));
    expect(loops).toHaveLength(2);
    for (const loop of loops) {
      expect(loop).toHaveLength(4);
      expect(signedArea(loop)).toBe(1);
    }
  });

  it('gives separate shapes separate loops', () => {
    expect(outlineLoops(grid(['#.#', '...', '#.#']))).toHaveLength(4);
  });

  it('stays clean on a complicated 5x5 target', () => {
    const rows = ['#...#', '###.#', '#.#.#', '#####', '##.##'];
    const loops = outlineLoops(grid(rows));
    // The loops' areas add up to the cells: outer edges count for, holes against.
    expect(loops.reduce((total, loop) => total + signedArea(loop), 0)).toBe(cellCount(rows));

    // Every side lies between a filled cell and an empty one, and is drawn once.
    const sides = unitSides(loops);
    expect(new Set(sides).size).toBe(sides.length);
    const filled = grid(rows);
    const at = (column: number, row: number): boolean => filled[row]?.[column] === true;
    let expected = 0;
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 5; column++) {
        if (!at(column, row)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!at(column + dx, row + dy)) expected += 1;
        }
      }
    }
    expect(sides).toHaveLength(expected);

    // Only real corners are kept: every point turns.
    for (const loop of loops) {
      loop.forEach((point, index) => {
        const before = loop[(index - 1 + loop.length) % loop.length];
        const after = loop[(index + 1) % loop.length];
        if (!before || !after) throw new Error('A loop lost a point');
        const straight = (point.x - before.x) * (after.y - point.y) === (point.y - before.y) * (after.x - point.x);
        expect(straight).toBe(false);
      });
    }
  });

  it('closes every loop on every 3x3 pattern', () => {
    for (let pattern = 1; pattern < 512; pattern++) {
      const rows = [0, 1, 2].map((row) =>
        [0, 1, 2].map((column) => ((pattern >> (row * 3 + column)) & 1 ? '#' : '.')).join('')
      );
      const loops = outlineLoops(grid(rows));
      expect(loops.reduce((total, loop) => total + signedArea(loop), 0), rows.join('/')).toBe(cellCount(rows));
      const sides = unitSides(loops);
      expect(new Set(sides).size, rows.join('/')).toBe(sides.length);
    }
  });
});

describe('insetLoop', () => {
  it('shrinks a square evenly', () => {
    const [square] = outlineLoops(grid(['#']));
    expect(insetLoop(square ?? [], 0.1)).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]);
  });

  it('moves a hole`s outline outwards from the hole, into the shape', () => {
    const loops = outlineLoops(grid(['###', '#.#', '###']));
    const hole = loops.find((loop) => signedArea(loop) < 0);
    const inset = insetLoop(hole ?? [], 0.1);
    expect(Math.abs(signedArea(inset))).toBeCloseTo(1.44);
  });

  it('moves the inner corner of an L into the shape too', () => {
    const [loop] = outlineLoops(grid(['#.', '##']));
    const inset = insetLoop(loop ?? [], 0.1);
    expect(inset).toContainEqual({ x: 0.9, y: 1.1 });
    expect(signedArea(inset)).toBeLessThan(3);
  });
});

describe('fitDashes', () => {
  it('fits a whole number of dashes and gaps round the line', () => {
    for (const length of [4, 7.3, 12, 31.5]) {
      const { dash, gap } = fitDashes(length, 0.3, 0.2);
      const repeats = length / (dash + gap);
      expect(repeats).toBeCloseTo(Math.round(repeats));
      expect(dash / gap).toBeCloseTo(1.5);
    }
  });

  it('stays close to the dash asked for', () => {
    const { dash } = fitDashes(20, 0.3, 0.2);
    expect(dash).toBeGreaterThan(0.28);
    expect(dash).toBeLessThan(0.32);
  });

  it('leaves the dash alone when there is no line to fit', () => {
    expect(fitDashes(0, 0.3, 0.2)).toEqual({ dash: 0.3, gap: 0.2 });
  });
});
