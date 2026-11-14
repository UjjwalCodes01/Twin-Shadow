/**
 * TEMPORARY: the debug board states are offered only in a subreddit whose name
 * ends in "_dev", which is how `devvit playtest` names an app's test
 * subreddit. Players in any other subreddit never see them.
 * To remove: delete this file, the debug route in routes/api.ts and the
 * `debug` field of PuzzleResponse.
 */
export const isDevSubreddit = (subredditName: string | undefined): boolean =>
  subredditName !== undefined && subredditName.toLowerCase().endsWith('_dev');
