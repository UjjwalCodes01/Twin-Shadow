// The wording of the inline view in the feed. No DOM, so it can be tested.

import type { SplashResponse } from '../shared/api';

/**
 * The creator credit shown under the button.
 * TODO(owner): confirm the exact text wanted here.
 */
export const CREATOR_CREDIT = 'by u/Significant_You460';

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

/** "Puzzle #12 · 30 November 2026". */
export const headingText = ({ number, date }: Pick<SplashResponse, 'number' | 'date'>): string =>
  `Puzzle #${number} · ${dateText(date)}`;

/** The line under the panels for a player who has solved the post: "9 blocks · par 7". */
export const playedText = ({ blocks, par }: { blocks: number; par: number }): string =>
  `${blocks} ${blocks === 1 ? 'block' : 'blocks'} · par ${par}`;

/** How many have solved the post. */
export const solversText = (solvers: number): string => {
  if (solvers <= 0) return 'Nobody has solved this yet';
  return solvers === 1 ? '1 player has solved this' : `${solvers} players have solved this`;
};

/** The streak, shown only when there is one: null for none, or when logged out. */
export const streakText = (streak: number | null): string | null => {
  if (streak === null || streak < 1) return null;
  return streak === 1 ? '1-day streak' : `${streak}-day streak`;
};

/** The one button: play before solving, results after. */
export const buttonText = (played: SplashResponse['played']): string => (played ? 'See results' : 'Play');
