// Stand-ins for the parts of '@devvit/web/server' the app uses, for tests.
// The real ones only exist inside Reddit.

type Hashes = Map<string, Map<string, string>>;

export type FakeContext = {
  postId: string | undefined;
  postData: Record<string, unknown> | undefined;
  userId: string | undefined;
  username: string | undefined;
  subredditName: string;
};

export type FakePost = { id: string; title: string; postData: Record<string, unknown> | undefined };

/** A comment as the fake Reddit holds it. `authorName` is who Reddit says wrote it. */
export type FakeComment = {
  id: string;
  postId: string;
  text: string;
  authorName: string;
  runAs: 'USER' | 'APP';
  /** True once the comment has been distinguished and stuck to the top. */
  pinned: boolean;
};

/** The name the fake Reddit gives the app's own account. */
export const APP_ACCOUNT = 'the-app';

export const createFakeDevvit = () => {
  const strings = new Map<string, string>();
  const hashes: Hashes = new Map();
  const sortedSets = new Map<string, Map<string, number>>();
  const posts: FakePost[] = [];
  const moderators = new Set<string>();
  const userFlairs = new Map<string, string>();
  let userFlairsEnabled = true;
  let failFlair = false;
  let failNextPost = false;
  const comments: FakeComment[] = [];
  const subscribers = new Set<string>();
  let failComments = false;
  let failCommentEdits = false;
  let commentsAsApp = false;
  let failSubscribing = false;
  let failPinning = false;

  const sortedSet = (key: string): Map<string, number> => {
    let found = sortedSets.get(key);
    if (!found) {
      found = new Map();
      sortedSets.set(key, found);
    }
    return found;
  };

  const hash = (key: string): Map<string, string> => {
    let found = hashes.get(key);
    if (!found) {
      found = new Map();
      hashes.set(key, found);
    }
    return found;
  };

  const context: FakeContext = {
    postId: undefined,
    postData: undefined,
    userId: undefined,
    username: undefined,
    subredditName: 'some_game',
  };

  // Same behaviour as the real client for the calls the app makes.
  const redis = {
    get: async (key: string): Promise<string | undefined> => strings.get(key),
    set: async (key: string, value: string): Promise<string> => {
      strings.set(key, value);
      return 'OK';
    },
    incrBy: async (key: string, value: number): Promise<number> => {
      const next = Number(strings.get(key) ?? 0) + value;
      strings.set(key, String(next));
      return next;
    },
    hGet: async (key: string, field: string): Promise<string | undefined> => hash(key).get(field),
    hSet: async (key: string, fieldValues: Record<string, string>): Promise<number> => {
      let added = 0;
      for (const [field, value] of Object.entries(fieldValues)) {
        if (!hash(key).has(field)) added += 1;
        hash(key).set(field, value);
      }
      return added;
    },
    hSetNX: async (key: string, field: string, value: string): Promise<number> => {
      if (hash(key).has(field)) return 0;
      hash(key).set(field, value);
      return 1;
    },
    hDel: async (key: string, fields: string[]): Promise<number> => {
      let removed = 0;
      for (const field of fields) {
        if (hash(key).delete(field)) removed += 1;
      }
      return removed;
    },
    hGetAll: async (key: string): Promise<Record<string, string>> => Object.fromEntries(hash(key)),
    hLen: async (key: string): Promise<number> => hash(key).size,
    hMGet: async (key: string, fields: string[]): Promise<(string | null)[]> =>
      fields.map((field) => hash(key).get(field) ?? null),
    hIncrBy: async (key: string, field: string, value: number): Promise<number> => {
      const next = Number(hash(key).get(field) ?? 0) + value;
      hash(key).set(field, String(next));
      return next;
    },
    zAdd: async (key: string, ...members: { member: string; score: number }[]): Promise<number> => {
      let added = 0;
      for (const { member, score } of members) {
        if (!sortedSet(key).has(member)) added += 1;
        sortedSet(key).set(member, score);
      }
      return added;
    },
    zRem: async (key: string, members: string[]): Promise<number> => {
      let removed = 0;
      for (const member of members) {
        if (sortedSet(key).delete(member)) removed += 1;
      }
      return removed;
    },
    zCard: async (key: string): Promise<number> => sortedSet(key).size,
    // Only `by: 'rank'` is needed: lowest score first, equal scores by member name.
    zRange: async (
      key: string,
      start: number,
      stop: number,
      options: { by: 'rank' }
    ): Promise<{ member: string; score: number }[]> => {
      if (options.by !== 'rank') throw new Error('The fake zRange only supports by: rank');
      return [...sortedSet(key)]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1))
        .slice(start, stop + 1);
    },
  };

  const reddit = {
    submitCustomPost: async (options: {
      title: string;
      postData?: Record<string, unknown>;
    }): Promise<{ id: string }> => {
      if (failNextPost) {
        failNextPost = false;
        throw new Error('Reddit is down');
      }
      const post = { id: `t3_post${posts.length + 1}`, title: options.title, postData: options.postData };
      posts.push(post);
      return { id: post.id };
    },
    // Like the real one, the comment comes back with its author and a way to
    // edit it. With `commentsAsApp` on, a comment asked for "as the user" is
    // written by the app's account instead, as Reddit may do.
    submitComment: async (options: {
      id: string;
      text: string;
      runAs?: 'USER' | 'APP';
    }): Promise<{
      id: string;
      authorName: string;
      edit: (edit: { text: string }) => Promise<void>;
      distinguish: (makeSticky?: boolean) => Promise<void>;
    }> => {
      if (failComments) throw new Error('Comments are unavailable');
      const runAs = options.runAs ?? 'APP';
      const comment: FakeComment = {
        id: `t1_comment${comments.length + 1}`,
        postId: options.id,
        text: options.text,
        authorName: runAs === 'USER' && !commentsAsApp ? (context.username ?? 'unknown') : APP_ACCOUNT,
        runAs,
        pinned: false,
      };
      comments.push(comment);
      return {
        id: comment.id,
        authorName: comment.authorName,
        edit: async (edit: { text: string }): Promise<void> => {
          if (failCommentEdits) throw new Error('Editing is unavailable');
          comment.text = edit.text;
        },
        distinguish: async (makeSticky?: boolean): Promise<void> => {
          if (failPinning) throw new Error('Pinning is unavailable');
          comment.pinned = makeSticky === true;
        },
      };
    },
    subscribeToCurrentSubreddit: async (): Promise<void> => {
      if (failSubscribing) throw new Error('Subscribing is unavailable');
      if (context.username !== undefined) subscribers.add(context.username);
    },
    getCurrentUsername: async (): Promise<string | undefined> => context.username,
    getCurrentSubreddit: async (): Promise<{ name: string; userFlairsEnabled: boolean }> => ({
      name: context.subredditName,
      userFlairsEnabled,
    }),
    setUserFlair: async (options: { subredditName: string; username: string; text?: string }): Promise<void> => {
      if (failFlair) throw new Error('Flair is unavailable');
      userFlairs.set(options.username, options.text ?? '');
    },
    getModerators: (options: { subredditName: string; username?: string }) => ({
      all: async (): Promise<{ username: string }[]> =>
        [...moderators]
          .filter((username) => options.username === undefined || options.username === username)
          .map((username) => ({ username })),
    }),
  };

  return {
    context,
    redis,
    reddit,
    /** Every post created so far, oldest first. */
    posts,
    /** Everything stored in a hash, as a plain object. */
    hashContents: (key: string): Record<string, string> => Object.fromEntries(hash(key)),
    stringValue: (key: string): string | undefined => strings.get(key),
    /** A sorted set's members, lowest score first. */
    sortedSetMembers: (key: string): string[] =>
      [...sortedSet(key)].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([member]) => member),
    /** The flair text each username has been given. */
    userFlairs: (): Record<string, string> => Object.fromEntries(userFlairs),
    /** Turns user flair in the subreddit on or off. */
    setUserFlairsEnabled: (enabled: boolean): void => {
      userFlairsEnabled = enabled;
    },
    /** Makes every setUserFlair call throw, or work again. */
    setFlairFailing: (failing: boolean): void => {
      failFlair = failing;
    },
    /** Makes a username a moderator of the subreddit. */
    addModerator: (username: string): void => {
      moderators.add(username);
    },
    /** Every comment posted so far, oldest first. */
    comments,
    /** The usernames subscribed to the subreddit through the app. */
    subscribers: (): string[] => [...subscribers],
    /** Makes every submitComment call throw, or work again. */
    setCommentsFailing: (failing: boolean): void => {
      failComments = failing;
    },
    /** Makes every edit of a comment throw, or work again. */
    setCommentEditsFailing: (failing: boolean): void => {
      failCommentEdits = failing;
    },
    /** Makes Reddit write "as the user" comments from the app's account, or stop. */
    setCommentsAsApp: (asApp: boolean): void => {
      commentsAsApp = asApp;
    },
    /** Makes pinning a comment throw, or work again. */
    setPinningFailing: (failing: boolean): void => {
      failPinning = failing;
    },
    /** Makes every subscribeToCurrentSubreddit call throw, or work again. */
    setSubscribingFailing: (failing: boolean): void => {
      failSubscribing = failing;
    },
    /** Makes the next submitCustomPost call throw. */
    failNextPost: (): void => {
      failNextPost = true;
    },
    /**
     * Puts the request context inside a post, as a given user (or logged out).
     * The username is the user id without its "t2_" prefix.
     */
    enterPost: (post: FakePost, userId: string | undefined): void => {
      context.postId = post.id;
      context.postData = post.postData;
      context.userId = userId;
      context.username = userId?.replace(/^t2_/, '');
    },
    reset: (): void => {
      strings.clear();
      hashes.clear();
      sortedSets.clear();
      posts.length = 0;
      moderators.clear();
      userFlairs.clear();
      userFlairsEnabled = true;
      failFlair = false;
      failNextPost = false;
      comments.length = 0;
      subscribers.clear();
      failComments = false;
      failCommentEdits = false;
      commentsAsApp = false;
      failSubscribing = false;
      failPinning = false;
      context.postId = undefined;
      context.postData = undefined;
      context.userId = undefined;
      context.username = undefined;
      context.subredditName = 'some_game';
    },
  };
};
