// Every Redis key the app uses, in one place.

export const KEYS = {
  /**
   * String, a whole number: how many posts this installation has created.
   * The next post takes the puzzle after that, wrapping at the end of the queue.
   */
  postCounter: 'posts:created',

  /** String: the puzzle number tied to one post. A backup for the post's own post data. */
  postPuzzle: (postId: string): string => `post:${postId}:puzzle`,

  /**
   * Hash, UTC date (YYYY-MM-DD) -> post id: the post created on each date.
   * Holds 'pending' for a moment while the daily job is creating one.
   */
  postDates: 'posts:by-date',

  /** Hash, user id -> JSON: each player's one counted submission for a post. */
  submissions: (postId: string): string => `post:${postId}:submissions`,

  /** Hash, user id -> milliseconds: when each player first loaded a post's puzzle. */
  firstLoads: (postId: string): string => `post:${postId}:first-loads`,
} as const;
