# Twin Shadows

A daily 3D puzzle that runs as an interactive post on Reddit (Devvit Web). The player builds a sculpture of unit cubes whose two shadows must match two target silhouettes. See `README.md` for how the game plays.

## Tech stack

- **Client**: plain TypeScript and three.js, built by Vite. No React or other UI framework; the HUD is plain HTML and CSS.
- **Server**: Hono on Devvit's Node serverless runtime, started in `src/server/index.ts`.
- **Client to server**: `fetch` against `/api/...` routes that return JSON. No tRPC.
- **Tests**: Vitest.
- Node 24 or later.

## Layout

- `src/shared/`: code used by both sides. `puzzle.ts` (types, the weekday-to-tier table and the test puzzle), `logic.ts` (the game rules), `score.ts` (stars and the canonical sculpture form), `analysis.ts` (measurements of a silhouette), `par.ts` (the par search), `community.ts` (the rules a puzzle made by a player must meet), `api.ts` (request and response types and validation), `share.ts` (the wording of a shared result), `random.ts` (seeded random numbers).
- `src/client/`: runs in an iframe on reddit.com.
  - `splash.html` / `splash.ts`: the inline view shown in the feed, which is also the start screen: the day's two silhouettes on paper, the player's own state and one button. No three.js here. `splashText.ts`: its wording.
  - `game.html` / `game.ts`: the expanded view. `game.ts` is the page's first script and is kept small: it asks for the post's puzzle and fetches `play.ts` at the same moment. `loadState.ts`: the loading, error and missing notices, shared by the two.
  - `play.ts`: the game. Takes the puzzle and wires the parts together.
  - `later.ts`: what is not needed to draw the board, fetched in the background once it is drawn and waited for by the first tap that wants it: the result card, the gallery, sharing and joining, and the cards for making and reviewing puzzles.
  - `store.ts`: the one game state store (blocks, rotation, mode, undo stack, read-only viewing mode). No DOM.
  - `scene.ts`: the three.js board. Reads the store, never writes game state.
  - `theme.ts`: the look, "Lamp and paper": every colour, material setting, line weight, font and corner radius, for the HUD and the board. Values only. `fonts/`: the bundled font and its licence.
  - `paint.ts`: what is painted on a canvas in code: the paper walls and their shadows, the Front and Side panels (the same painting, smaller), the table top and the wood grain. `outline.ts`: turns a set of cells into clean closed outlines. `shade.ts`: contact shading between blocks. `blockGeometry.ts`: the shape of a block. `stars.ts`: stars drawn as shapes.
  - `maker.ts`: the checklist for a puzzle being made, and the wording of what became of a maker's last puzzle. `communityBar.ts`: the line under the readout with the maker's credit and a moderator's review count. `communityUi.ts`: making, sending and reviewing puzzles on screen (part of `later.ts`). `sound.ts`: the three sounds, made in code. `count.ts`: small shared wordings.
  - `motion.ts`: the timing of everything that moves on the board. `hints.ts`: which warm-up hint is due. `warmup.ts`: whether a player gets the warm-up, and remembering that they have. `hintBar.ts`: the strip the hints are shown in.
  - `input.ts`: tap handling. `hud.ts`: the HTML panels and controls. `result.ts`: the result card and its wording. `gallery.ts`: the list of other players' sculptures and the banner shown while viewing one. `journey.ts`: journey telemetry.
  - `debug.ts`: temporary debug board states.
- `src/server/`: `routes/api.ts` (public `/api` routes: `GET /api/puzzle`, `POST /api/submit`, `GET /api/result`, `GET /api/gallery`, `GET /api/splash`, `POST /api/share`, `POST /api/join`, `POST /api/onboarding`, `POST /api/prefs`, `POST /api/sound`), `routes/community.ts` (`POST /api/community/puzzles`, `GET` and `POST /api/community/review`), `routes/menu.ts`, `routes/triggers.ts` and `routes/scheduler.ts` (the three ways a post is made), `routes/telemetry.ts` (journey telemetry routes), `core/posts.ts` (post creation, each post's saved record and the daily job), `core/submissions.ts` (the one stored submission per player per post), `core/scores.ts` (leaderboard, rarity, gallery, streaks and the result), `core/flair.ts` (streak flair), `core/share.ts` (sharing a result as a comment, and the join prompt), `core/onboarding.ts` (what a first-time player has been shown), `core/community.ts` (puzzles made by players: sending, review and the community queue), `core/moderators.ts` (who is a moderator), `core/prefs.ts` (a player's settings), `core/keys.ts` (every Redis key, documented), `core/queue.ts`, `data/puzzles.json` (generated puzzle queue), `testing/` (stand-ins for Redis, Reddit and context, and known solutions, for tests only).
- `src/generator/`: the offline puzzle generator. Its quality checks and par search live in `src/shared/` (`analysis.ts`, `par.ts`), because the server runs the same ones on a player's puzzle. Runs on a developer machine with `npm run generate`, never on the server. `data/solutions.json` holds seed sculptures and par solutions.
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
- **Nothing is done as the player without their tap.** Sharing a result and joining the community act as the player (`runAs: 'USER'`, `subscribeToCurrentSubreddit`). The client calls those routes only from the player's own tap, after `canRunAsUser` has said yes; anything but a clear yes means nothing is sent. The scopes are listed in `permissions.reddit.asUser` in `devvit.json`.
- **A shared result is spoiler-free and posted once.** The text comes from `shareText` in `src/shared/share.ts`: numbers only, never the sculpture. `shareResult` claims the share in Redis before posting, releases the claim if the comment fails, and names the player in the comment when Reddit posts it from the app's account.
- **The join prompt is asked until answered, then never again.** `Result.joinPrompt` is true while the player has no answer stored; joining or dismissing stores one. Reddit only lets an approved app version join for a player. When it refuses ("permission not granted"), the server answers `unavailable`, and the prompt's button becomes "Open": it opens the community's own page with `navigateTo`, where the player joins for themselves, and that is stored as their answer. It never says "try again" for something that cannot work.
- **Journey telemetry lives in two files**: `src/client/journey.ts` and `src/server/routes/telemetry.ts`. Nothing else imports `@devvit/analytics`. Telemetry must never affect play: every call is fire-and-forget, failures and refusals are swallowed on the client and logged once per reason on the server, and nothing is sent for a debug puzzle or while viewing another player's sculpture.
- **The splash gives nothing away.** `GET /api/splash` sends the two silhouettes, which every player sees anyway, the post's number and date, the solver count, and the caller's own result and streak. No sculpture, no par before the caller has solved it, and nothing of any other player's.
- **The warm-up is never scored.** A first-time player gets the small test puzzle with hints before the day's puzzle. It cannot be submitted, sends no journey events for play, and can be skipped. The server (`core/onboarding.ts`) and the device both remember it has been had; "How to play" replays it and puts the day's board back as it was.
- **Hints never take a tap.** They are one line in their own row under the board, one at a time, each gone when the player has done what it says and none shown twice. The order and triggers live in `hints.ts`.
- **Animation never holds the game back.** A block is in the store the moment it is placed; `motion.ts` only says where to draw it. Rendering stays on demand: frames keep coming only while something is moving. A device that asks for reduced motion gets no travel, only brief fades. Times and distances live in the theme's `motion` part.
- **A player's puzzle is checked on the server, from the sculpture.** The client sends only a block list. `sendPuzzle` in `core/community.ts` re-runs every rule in `src/shared/community.ts`, works out both silhouettes and par itself (the par search has a time limit, `SERVER_PAR_LIMIT_MS`), and refuses a lookalike of any generated, pending, approved or used puzzle. The maker's own sculpture is stored as a private solution and never sent to any client. Makers give no free text: the only credit is their username.
- **Changing the generator's checks or par search must not change the queue.** They are shared code now. Run `npm run generate` after touching `analysis.ts` or `par.ts`: the three data files must come out unchanged, and the determinism test checks it.
- **Review is for moderators, checked on the server.** Both review routes call `callerIsModerator` themselves. Approving moves a puzzle to the community queue; rejecting removes it; either frees the maker's one waiting slot. A moderator can step along the line of waiting puzzles (`?at=2`, shown as "2 of 5"); stepping decides nothing.
- **Sunday's daily post is a community puzzle when one is approved** (`COMMUNITY_WEEKDAY` in `src/shared/puzzle.ts`); otherwise it is the generated puzzle as usual. Only the daily job draws from the community queue, never an extra post from the menu.
- **A maker is never ranked on their own puzzle.** They cannot submit it, and see its results and gallery without a place of their own. Their streak is carried across that day rather than broken. The submit route refuses them, and so does `storeSubmission` itself, before anything is written: no record of a maker's may exist for the leaderboard, the counts or the gallery to pick up.
- **The maker's checklist is about shape only.** Par plays no part in whether "Send for review" is on: only the server's search settles it. A puzzle refused over par is told which way it is out (`par-low` needs more blocks to solve, `par-high` fewer), and the maker goes on building.
- **A maker is told what became of their last puzzle, never why.** `communityLast` holds its status: waiting, approved, used on a date, or not picked. News of an older puzzle never replaces the status of a newer one.
- **The first script stays small.** `game.ts` imports only `theme.ts` and `loadState.ts`. `vite.config.ts` lists `play.js` and what it needs in `game.html`, so the browser fetches the game while the puzzle is asked for. Anything not needed to draw the board belongs in `later.ts`; a module used on both sides of that line is pulled into the first load, so keep shared helpers in small files of their own (`count.ts`).
- **Sound is made in code and starts only after a tap.** No audio files. On by default. The mute setting is remembered on the device and, for a logged-in player, on the server. The first sound of a session leaves one line in the server log (`POST /api/sound`), and stores nothing.
- **Flair is a bonus.** `setStreakFlair` never throws, so a flair failure cannot fail a submission.
- **New Redis keys go in `src/server/core/keys.ts`** with a comment saying what they hold.
- Every server route the client calls must start with `/api/`. Menu and trigger routes are under `/internal/` and must be registered in `devvit.json`.
- Coordinates: x runs left to right, y runs up from the floor, z runs front to back, all from 0. A sculpture is a `Set<string>` of `"x,y,z"` keys. Silhouettes are string arrays, top row first, `#` lit and `.` empty.
- **The look lives in `src/client/theme.ts`**, and there is one look. `game.css` is layout and sizes only and names no colour, font, radius, line weight or shadow: it reads the CSS variables listed in `HUD_VARIABLES`. `paint.ts` and `scene.ts` take every colour and weight from the theme's `paint` and `scene` parts. A new value means a new entry in the theme, never a literal elsewhere. `vite.config.ts` writes the HUD variables into the built stylesheet, so keep `theme.ts` free of imports and of anything that runs on import.
- **Walls and panels are one painting.** `paintWall` in `paint.ts` draws both, so a change to how matched, missing or extra looks is made once. Matched cells are one continuous soft shadow; the target is one dashed outline round the whole shape; extra is red-tinted shadow with strokes through it. Each of the three, and a floating block, must read without colour.
- **All text is at least 4.5 to 1 against its background.** `theme.test.ts` checks every pairing the stylesheet makes; add a pairing there when a new one is used.
- **Fonts are bundled, never fetched from another site**, and each sits in `src/client/fonts/` beside its licence. No image files or outside artwork: everything on the board is drawn in code.
- Code marked `TEMPORARY` is debug-only and is removed before release. Keep new debug code behind the same dev-subreddit check and mark it the same way. The moderator menu item "Create a community puzzle post now" is one of these: it works only in a subreddit whose name ends in `_dev`, makes an extra post that never counts towards streaks, and goes with its entry in `devvit.json` and the `communityNow` parameter of `createNextPost`.
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
