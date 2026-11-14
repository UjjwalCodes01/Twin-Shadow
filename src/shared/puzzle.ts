export type Size = { w: number; d: number; h: number };

export type Puzzle = {
  id: string;
  size: Size;
  /** Target for the back wall. Rows top to bottom, each `w` characters, indexed by x. */
  front: string[];
  /** Target for the left wall. Rows top to bottom, each `d` characters, indexed by z. */
  side: string[];
  par: number;
};

export const TEST_PUZZLE: Puzzle = {
  id: 'proto-1',
  size: { w: 3, d: 3, h: 3 },
  front: ['...', '###', '#.#'],
  side: ['...', '#..', '###'],
  par: 6,
};

export const TEST_SOLUTION = ['0,0,0', '0,0,1', '2,0,2', '0,1,0', '1,1,0', '2,1,0'];
