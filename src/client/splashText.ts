// The wording of the inline view in the feed. No DOM, so it can be tested.

import type { SplashResponse } from '../shared/api';

/** Who made the game, shown under the button. A puzzle's maker is credited in the heading instead. */
export const CREATOR_CREDIT = 'Game by u/Significant_You460';

export const DESCRIPTION = 'Build one sculpture that casts both shadows.';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11-30" as "30 November 2026". Posts are dated in UTC, so no time zone comes into it. */
export const dateText = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const name = MONTHS[(month ?? 0) - 1];
  return name && year && day ? `${day} ${name} ${year}` : date;
};

/**
 * The heading under the name, as lines of phrases. A phrase is never broken
 * across lines: the puzzle's number, its maker and its date each stay whole.
 *
 * A generated puzzle has one line, "Puzzle #12" "· 30 November 2026". A
 * puzzle a player made has two: "Puzzle #12" "by u/maker", then the date on
 * a line of its own, so a long username never squeezes it.
 */
export const headingLines = ({ number, date, maker }: Pick<SplashResponse, 'number' | 'date' | 'maker'>): string[][] =>
  maker === null
    ? [[`Puzzle #${number}`, `· ${dateText(date)}`]]
    : [[`Puzzle #${number}`, `by u/${maker}`], [dateText(date)]];

/** The line under the panels for a player who has solved the post: "9 blocks · par 7". */
export const playedText = ({ blocks, par }: { blocks: number; par: number }): string =>
  `${blocks} ${blocks === 1 ? 'block' : 'blocks'} · par ${par}`;

/** How many have solved the post. */
export const solversText = (solvers: number): string => {
  if (solvers <= 0) return 'Be the first to solve it';
  return solvers === 1 ? '1 player has solved this' : `${solvers} players have solved this`;
};

/** The streak, shown only when there is one: null for none, or when logged out. */
export const streakText = (streak: number | null): string | null => {
  if (streak === null || streak < 1) return null;
  return streak === 1 ? '1-day streak' : `${streak}-day streak`;
};

/** The one button: play before solving, results after. */
export const buttonText = (played: SplashResponse['played']): string => (played ? 'See results' : 'Play');
