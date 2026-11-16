// Sharing a result as a comment on the post, and the "Join the community" prompt.

import { reddit, redis } from '@devvit/web/server';
import type { JoinChoice } from '../../shared/api';
import { namedShareText, shareText } from '../../shared/share';
import { KEYS } from './keys';
import type { PostRecord } from './posts';
import { buildResult } from './scores';
import type { StoredSubmission } from './submissions';

export type ShareOutcome = 'shared' | 'already-shared' | 'failed';

/** Marks a share that has been claimed and whose comment is not recorded yet. */
const PENDING = 'pending';

const isPostId = (id: string): id is `t3_${string}` => id.startsWith('t3_');

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Posts the player's result as a comment on the post, once per player per
 * post. Only call it for a player's own tap on Share, and with their own
 * stored record.
 *
 * The share is claimed in Redis first, so two requests at once post one
 * comment. If the comment cannot be posted the claim is released and the
 * player may try again. Once it is posted the claim stays, whatever else fails.
 */
export const shareResult = async (
  postId: string,
  post: PostRecord,
  stored: StoredSubmission
): Promise<ShareOutcome> => {
  const { userId, username } = stored;
  // hSetNX writes only when the field is new: of two requests at once, one gets 1.
  if ((await redis.hSetNX(KEYS.shares(postId), userId, PENDING)) !== 1) return 'already-shared';

  let text: string;
  let comment: Awaited<ReturnType<typeof reddit.submitComment>>;
  try {
    if (!isPostId(postId)) throw new Error(`${postId} is not a post id`);
    const { blocks, par, stars, rarity } = await buildResult(post, stored);
    // Numbers only. The sculpture is an answer and never goes in a comment.
    text = shareText({ number: post.number, blocks, par, stars, rarity });
    comment = await reddit.submitComment({ id: postId, text, runAs: 'USER' });
  } catch (error) {
    console.error(`Could not share the result of ${username} on ${postId}: ${error}`);
    await redis.hDel(KEYS.shares(postId), [userId]);
    return 'failed';
  }

  // Reddit can post a comment made "as the user" from the app's account
  // instead, for example before the app is approved. The comment then would
  // not say whose result it is, so the player's name is put in front.
  if (!sameName(comment.authorName, username)) {
    console.warn(`Share comment ${comment.id} was posted as ${comment.authorName}, not ${username}: naming the player`);
    try {
      await comment.edit({ text: namedShareText(username, text) });
    } catch (error) {
      console.error(`Could not name ${username} in share comment ${comment.id}: ${error}`);
    }
  }
  await redis.hSet(KEYS.shares(postId), { [userId]: comment.id });
  return 'shared';
};

export type JoinOutcome = 'ok' | 'unavailable' | 'failed';

/** What Reddit says when the app may not act for this player: an app version not yet approved, or no consent. */
const NOT_PERMITTED = 'permission not granted';

/**
 * Records a player's answer to the "Join the community" prompt. 'join'
 * subscribes the player to this subreddit first. A failed subscription
 * records nothing, so the prompt stays. When Reddit refuses because the app
 * is not permitted to join for the player, the outcome is 'unavailable':
 * trying again cannot help, and the game offers the community's page instead.
 * 'visit' is that offer taken up, and like 'dismiss' it only records the answer.
 */
export const answerJoinPrompt = async (userId: string, choice: JoinChoice): Promise<JoinOutcome> => {
  if (choice === 'join') {
    try {
      await reddit.subscribeToCurrentSubreddit();
    } catch (error) {
      if (String(error).includes(NOT_PERMITTED)) {
        console.warn(`Reddit does not let the app subscribe ${userId}: ${error}`);
        return 'unavailable';
      }
      console.error(`Could not subscribe ${userId}: ${error}`);
      return 'failed';
    }
  }
  const answer = choice === 'join' ? 'joined' : choice === 'visit' ? 'visited' : 'dismissed';
  await redis.hSet(KEYS.joinPrompt, { [userId]: answer });
  return 'ok';
};
