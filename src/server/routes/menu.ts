import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { approvedCount } from '../core/community';
import { isDevSubreddit } from '../core/dev';
import { callerIsModerator } from '../core/moderators';
import { createNextPost } from '../core/posts';

export const menu = new Hono();

// "Create a new post" in the subreddit menu, moderators only: makes an extra
// post straight away. It does not replace or count as the day's daily post.
menu.post('/post-create', async (c) => {
  try {
    if (!(await callerIsModerator())) {
      // Logged, so a moderator who is wrongly refused shows up in `devvit logs`.
      console.warn(`Post creation refused: ${context.username ?? 'a logged-out caller'} is not a moderator`);
      return c.json<UiResponse>({ showToast: 'Only moderators can create posts' }, 403);
    }
    const { postId, number, puzzle } = await createNextPost('manual');
    console.log(`Menu post created: Twin Shadows #${number} (${postId}) with puzzle ${puzzle.id}`);
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

// TEMPORARY: "Create a community puzzle post now", for testing the Sunday
// path without waiting for a Sunday. It makes a post from the approved
// community puzzle that has waited longest, exactly as the Sunday job would:
// the maker's credit, the pinned comment. It is an extra post, so it never
// counts as a daily post or towards a streak. It works only in a subreddit
// whose name ends in "_dev" and does nothing anywhere else.
// To remove: delete this route, its item in devvit.json's menu, and the
// `communityNow` parameter of createNextPost.
menu.post('/community-post', async (c) => {
  try {
    if (!isDevSubreddit(context.subredditName)) {
      return c.json<UiResponse>({ showToast: 'This is only for the test subreddit' }, 403);
    }
    if (!(await callerIsModerator())) {
      console.warn(`Community post refused: ${context.username ?? 'a logged-out caller'} is not a moderator`);
      return c.json<UiResponse>({ showToast: 'Only moderators can create posts' }, 403);
    }
    if ((await approvedCount()) === 0) {
      return c.json<UiResponse>({ showToast: 'No approved community puzzle is waiting. Approve one first.' }, 200);
    }
    const { postId, number, puzzle, maker } = await createNextPost('manual', new Date(), true);
    console.log(
      `Community test post created: Twin Shadows #${number} (${postId}) with puzzle ${puzzle.id} by ${maker?.username ?? 'nobody: the generated puzzle was used'}`
    );
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` },
      200
    );
  } catch (error) {
    console.error(`Error creating community post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
