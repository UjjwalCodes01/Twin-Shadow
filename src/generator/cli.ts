// Writes the puzzle queue to disk. Run with `npm run generate`.
//
//   src/server/data/puzzles.json     what players get: silhouettes and par
//   src/generator/data/solutions.json  seed sculptures and par solutions.
//                                    Never import this from client or server code.
//   src/generator/data/preview.txt   every puzzle as text, for reading through

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_OPTIONS,
  REJECTIONS,
  generateQueue,
  previewQueue,
  type GeneratedPuzzle,
  type Generation,
} from './generate';

export const PUZZLES_PATH = 'src/server/data/puzzles.json';
export const SOLUTIONS_PATH = 'src/generator/data/solutions.json';
export const PREVIEW_PATH = 'src/generator/data/preview.txt';

/** One entry per line keeps the files readable and their diffs small. */
const jsonLines = (items: readonly unknown[]): string =>
  `[\n${items.map((item) => `  ${JSON.stringify(item)}`).join(',\n')}\n]\n`;

export const puzzlesJson = (puzzles: readonly GeneratedPuzzle[]): string =>
  jsonLines(puzzles.map(({ puzzle }) => puzzle));

export const solutionsJson = (puzzles: readonly GeneratedPuzzle[]): string =>
  jsonLines(
    puzzles.map(({ puzzle, lowerBound, seed, parSolution }) => ({
      number: puzzle.number,
      lowerBound,
      seed,
      parSolution,
    }))
  );

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const summary = ({ puzzles, report }: Generation, seconds: number): string => {
  const lines = [`Generated ${puzzles.length} puzzles from seed ${DEFAULT_OPTIONS.seed} in ${seconds.toFixed(1)} s`];
  const optimal = puzzles.filter(({ puzzle }) => puzzle.parIsOptimal).length;
  lines.push(`Par is proven optimal for ${optimal} of ${puzzles.length}`);
  for (const tier of [1, 2, 3] as const) {
    const { accepted, candidates, rejected } = report[tier];
    lines.push(`Tier ${tier}: ${accepted} accepted from ${candidates} candidates`);
    for (const reason of REJECTIONS) {
      if (rejected[reason] > 0) lines.push(`  ${String(rejected[reason]).padStart(6)}  ${reason}`);
    }
  }
  return lines.join('\n');
};

export const main = (): void => {
  const started = performance.now();
  const generation = generateQueue();
  const seconds = (performance.now() - started) / 1000;
  write(PUZZLES_PATH, puzzlesJson(generation.puzzles));
  write(SOLUTIONS_PATH, solutionsJson(generation.puzzles));
  write(PREVIEW_PATH, previewQueue(generation.puzzles));
  console.log(summary(generation, seconds));
  console.log(`Wrote ${PUZZLES_PATH}, ${SOLUTIONS_PATH} and ${PREVIEW_PATH}`);
};
