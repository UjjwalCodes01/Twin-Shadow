// Every Redis key the app uses, in one place.

import type { Tier } from '../../shared/puzzle';

export const KEYS = {
  /**
   * String, a whole number: how many posts this installation has created.
   * It is the N in "Twin Shadows #N".
   */
  postCounter: 'posts:created',

  /**
   * String, a whole number: how many posts have been given a puzzle of this
   * tier. The next post of that tier takes the following one, wrapping at the
   * end of the tier.
   */
  tierCounter: (tier: Tier): string => `posts:tier:${tier}`,

  /**
   * String, a whole number: how many daily posts have been created. A daily
   * post stores the value it got here, and streaks count those values.
   */
  dailyCounter: 'posts:daily',

  /**
   * String, JSON: everything fixed about one post: its number, whether it is
   * a daily post, its date and its own copy of the puzzle. Routes read the
   * puzzle from here, never from the queue file.
   */
  post: (postId: string): string => `post:${postId}`,

  /**
   * Hash, UTC date (YYYY-MM-DD) -> the id of that date's daily post. Holds
   * 'pending:<milliseconds>' while a run is creating the post.
   */
  postDates: 'posts:by-date',

  /**
   * Hash, '<date>|<stale claim>' -> milliseconds: which run took over a claim
   * that was left pending. One field per stale claim, so only one run can.
   */
  takeovers: 'posts:takeovers',

  /** Hash, user id -> JSON: each player's one counted submission for a post. */
  submissions: (postId: string): string => `post:${postId}:submissions`,

  /**
   * Sorted set, member user id: a post's leaderboard. The score is the block
   * count with the submission time as tie-break, so fewer blocks come first
   * and, among equal counts, earlier submissions come first.
   */
  leaderboard: (postId: string): string => `post:${postId}:leaderboard`,

  /** Hash, block count -> how many players submitted that many blocks for a post. */
  blockCounts: (postId: string): string => `post:${postId}:block-counts`,

  /**
   * Hash, '<block count>:<short hash of a sculpture>' -> how many players
   * submitted exactly that sculpture. One read gives all the gallery sorts by.
   */
  sculptures: (postId: string): string => `post:${postId}:sculptures`,

  /**
   * Hash, short hash of a sculpture -> JSON: the sculpture itself and the
   * first player to submit it. Written once per distinct sculpture.
   */
  gallery: (postId: string): string => `post:${postId}:gallery`,

  /**
   * Hash, '<step>:<user id>' -> '1': which of a player's submission has
   * already been added to the leaderboard, the block-count tally and the
   * sculpture counts. Each step is claimed here first, so it happens once.
   */
  counted: (postId: string): string => `post:${postId}:counted`,

  /**
   * Hash, user id -> JSON: each player's current streak, best streak, last
   * daily post counted and the streak flair they have been given.
   */
  streaks: 'streaks',

  /**
   * Hash, user id -> the id of the comment that shared the player's result
   * for a post. Holds 'pending' while the comment is being posted. A player
   * with a field here has used their one share for that post.
   */
  shares: (postId: string): string => `post:${postId}:shares`,

  /**
   * Hash, user id -> 'joined' or 'dismissed': the player's answer to the
   * "Join the community" prompt. A player with an answer is never asked again.
   */
  joinPrompt: 'prompts:join',

  /**
   * Hash, user id -> JSON: what a first-time player has been through. Holds
   * how the warm-up ended ('finished' or 'skipped') and whether the
   * first-solve hint has been seen. A player with no field is brand new.
   */
  onboarding: 'onboarding',
} as const;
