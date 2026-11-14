// Stand-ins for the parts of '@devvit/web/server' the app uses, for tests.
// The real ones only exist inside Reddit.

type Hashes = Map<string, Map<string, string>>;

export type FakeContext = {
  postId: string | undefined;
  postData: Record<string, unknown> | undefined;
  userId: string | undefined;
  subredditName: string;
};

export type FakePost = { id: string; title: string; postData: Record<string, unknown> | undefined };

export const createFakeDevvit = () => {
  const strings = new Map<string, string>();
  const hashes: Hashes = new Map();
  const posts: FakePost[] = [];
  let failNextPost = false;

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
    /** Makes the next submitCustomPost call throw. */
    failNextPost: (): void => {
      failNextPost = true;
    },
    /** Puts the request context inside a post, as a given user (or logged out). */
    enterPost: (post: FakePost, userId: string | undefined): void => {
      context.postId = post.id;
      context.postData = post.postData;
      context.userId = userId;
    },
    reset: (): void => {
      strings.clear();
      hashes.clear();
      posts.length = 0;
      failNextPost = false;
      context.postId = undefined;
      context.postData = undefined;
      context.userId = undefined;
      context.subredditName = 'some_game';
    },
  };
};
