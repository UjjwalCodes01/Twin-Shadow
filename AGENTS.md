# Twin Shadows

A daily 3D puzzle that runs as an interactive post on Reddit (Devvit Web). The player builds a sculpture of unit cubes whose two shadows must match two target silhouettes. See `README.md` for how the game plays.

## Tech stack

- **Client**: plain TypeScript and three.js, built by Vite. No React or other UI framework; the HUD is plain HTML and CSS.
- **Server**: Hono on Devvit's Node serverless runtime, started in `src/server/index.ts`.
- **Client to server**: `fetch` against `/api/...` routes that return JSON. No tRPC.
- **Tests**: Vitest.
- Node 24 or later.

## Layout

- `src/shared/`: code used by both sides. `puzzle.ts` (types, the weekday-to-tier table and the test puzzle), `logic.ts` (the game rules), `score.ts` (stars and the canonical sculpture form), `api.ts` (request and response types and validation), `random.ts` (seeded random numbers).
- `src/client/`: runs in an iframe on reddit.com.
  - `splash.html` / `splash.ts`: the inline view shown in the feed. Keep it light; no three.js here.
  - `game.html` / `game.ts`: the expanded view. Loads the puzzle and wires the parts together.
  - `store.ts`: the one game state store (blocks, rotation, mode, undo stack, read-only viewing mode). No DOM.
  - `scene.ts`: the three.js board. Reads the store, never writes game state.
  - `input.ts`: tap handling. `hud.ts`: the HTML panels and controls. `result.ts`: the result card and its wording. `gallery.ts`: the list of other players' sculptures and the banner shown while viewing one.
  - `debug.ts`: temporary debug board states.
- `src/server/`: `routes/api.ts` (public `/api` routes: `GET /api/puzzle`, `POST /api/submit`, `GET /api/result`, `GET /api/gallery`), `routes/menu.ts`, `routes/triggers.ts` and `routes/scheduler.ts` (the three ways a post is made), `core/posts.ts` (post creation, each post's saved record and the daily job), `core/submissions.ts` (the one stored submission per player per post), `core/scores.ts` (leaderboard, rarity, gallery, streaks and the result), `core/flair.ts` (streak flair), `core/keys.ts` (every Redis key, documented), `core/queue.ts`, `data/puzzles.json` (generated puzzle queue), `testing/` (stand-ins for Redis, Reddit and context, and known solutions, for tests only).
- `src/generator/`: the offline puzzle generator. Runs on a developer machine with `npm run generate`, never on the server. `data/solutions.json` holds seed sculptures and par solutions.
- `tools/`: TypeScript project configs and `generate.mjs`, the generator runner.
- `devvit.json`: app config: entry points, the menu item, the install trigger, the hourly `daily-post` task.

## Rules

- **Game rules live in `src/shared/logic.ts`** as pure functions with no DOM and no three.js imports, because the server reuses them to validate play. Do not reimplement a rule elsewhere; call these.
- **Never import `src/generator/data/solutions.json`** from client or server code. It must not reach players.
- **Validate before trusting**: anything fetched from the server goes through the `parse...` functions in `src/shared/api.ts` before use, and the server does the same with request bodies.
- **The server decides scores.** A submission is a list of blocks; the server runs `isSolved` on it and counts the blocks itself. Never accept a solved flag, block count or star rating from the client.
- **`parIsOptimal` never leaves the server.** Players get `Puzzle`; `QueuedPuzzle` is for the generator and the server's queue only.
- **Posts are made in one place**: `createNextPost` in `src/server/core/posts.ts`. Titles count posts ("Twin Shadows #N"); the puzzle comes from the tier for the UTC weekday, set in `WEEKDAY_TIERS` in `src/shared/puzzle.ts`.
- **Each post keeps its own copy of its puzzle**, saved in Redis when the post is created. Routes read that copy with `loadPost`, never the queue file, so regenerating the queue cannot change an existing post.
- **Daily posts and extra posts**: the scheduled job and the install trigger make the one `daily` post per UTC date, through `createDailyPost`. The moderator menu makes `manual` extras. Only daily posts count towards streaks.
- **Scores change once per player per post.** Submissions go through `acceptSubmission` in `src/server/core/scores.ts`. The streak changes only for the request that won the first-submission write, and each counting step (leaderboard, block-count tally, sculpture count) is claimed in Redis before it runs, so a repair can finish a half-counted submission without counting twice.
- **Results and the gallery are for players who have submitted.** `GET /api/result` and `GET /api/gallery` refuse everyone else. Other players' sculptures are answers: only the gallery sends them, and only after the caller has submitted for that post.
- **Viewing is read-only.** Another player's sculpture goes on the board through `store.view`, which blocks every edit and sets the player's own board aside until `store.endView`.
- **Flair is a bonus.** `setStreakFlair` never throws, so a flair failure cannot fail a submission.
- **New Redis keys go in `src/server/core/keys.ts`** with a comment saying what they hold.
- Every server route the client calls must start with `/api/`. Menu and trigger routes are under `/internal/` and must be registered in `devvit.json`.
- Coordinates: x runs left to right, y runs up from the floor, z runs front to back, all from 0. A sculpture is a `Set<string>` of `"x,y,z"` keys. Silhouettes are string arrays, top row first, `#` lit and `.` empty.
- Code marked `TEMPORARY` is debug-only and is removed before release. Keep new debug code behind the same dev-subreddit check and mark it the same way.
- The game itself has no Reddit theming: no Snoo, karma or subreddit references.
- Add no dependencies without asking.

## TypeScript style

The compiler is strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`).

- Never cast types (`as Foo`). Narrow with checks or type guards instead. `as const` is fine.
- Prefer type aliases over interfaces.
- Prefer named exports over default exports.
- Import siblings without a file extension (`'./logic'`).

## Devvit specifics

- Use Devvit Web only. Do not use blocks or `@devvit/public-api`.
- Server-side Reddit access (`context`, `reddit`, `redis`) comes from `@devvit/web/server`.
- In the client, use `navigateTo` from `@devvit/web/client` instead of `window.location`, and `showToast` or `showForm` instead of `window.alert`.
- No inline `<script>` in HTML files; use a separate `.ts` file.
- Geolocation, camera, microphone and notification web APIs are not available.
- Docs: https://developers.reddit.com/docs/llms.txt

## Commands

- `npm test`: run all unit tests. `npm test -- logic` runs the files matching a name.
- `npm run test:types`: type-check every project.
- `npm run lint`: lint `src/`.
- `npm run build`: build client and server into `dist/`.
- `npm run generate`: regenerate the puzzle queue (takes under a minute). Commit the three files it writes.
- `npm run dev`: start a playtest in the app's test subreddit. Needs a Reddit login, so the developer runs this.

Run the tests, the type-check and the linter before calling a change done.
