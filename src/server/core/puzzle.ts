import type { PuzzleResponse } from '../../shared/api';
import { TEST_PUZZLE } from '../../shared/puzzle';

/**
 * TEMPORARY: the debug board states are offered only in a subreddit whose name
 * ends in "_dev", which is how `devvit playtest` names an app's test
 * subreddit. Players in any other subreddit never see them.
 * To remove: delete this function and the `debug` field of PuzzleResponse.
 */
export const isDevSubreddit = (subredditName: string | undefined): boolean =>
  subredditName !== undefined && subredditName.toLowerCase().endsWith('_dev');

/** The body of GET /api/puzzle/today. One fixed puzzle until the generator exists. */
export const todayResponse = (subredditName: string | undefined): PuzzleResponse => ({
  puzzle: TEST_PUZZLE,
  debug: isDevSubreddit(subredditName),
});
