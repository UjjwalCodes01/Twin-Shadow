// A small seeded random number generator (mulberry32). The same seed always
// gives the same sequence, which keeps generated puzzles reproducible.

export type Random = {
  /** A float in [0, 1). */
  next: () => number;
  /** A whole number in [0, count). */
  int: (count: number) => number;
  /** A whole number in [min, max], both included. */
  between: (min: number, max: number) => number;
  /** A shuffled copy. */
  shuffle: <T>(items: readonly T[]) => T[];
};

export const createRandom = (seed: number): Random => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (count: number): number => Math.floor(next() * count);
  return {
    next,
    int,
    between: (min, max) => min + int(max - min + 1),
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const a = copy[i];
        const b = copy[j];
        if (a !== undefined && b !== undefined) {
          copy[i] = b;
          copy[j] = a;
        }
      }
      return copy;
    },
  };
};
