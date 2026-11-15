# Twin Shadows

A daily 3D puzzle that runs as an interactive post on Reddit. Build one sculpture out of blocks so that its two shadows match the two target silhouettes.

This is an early prototype. A new puzzle is posted each day from a generated queue, easier early in the week and harder towards the weekend, and each post keeps its own puzzle. You can submit one solution per puzzle. The result card then shows your stars, your rank among everyone who solved it, how common your exact sculpture is, and your streak, and from there you can look through what other players built.

## How to play

- The board is a small grid with a wall behind it on each side. Each wall shows a target silhouette as outlined cells.
- Tap a floor tile to place a block. Tap a face of a block to place another block against that face.
- Switch to **Remove** and tap a block to take it away.
- The sculpture casts a shadow on the walls. A cell is filled when the shadow matches the target, outlined when the shadow is missing there, and red when the shadow falls where it shouldn't.
- The **Front** and **Side** panels at the top show the same two shadows as flat grids, so you can read them when blocks are in the way.
- Use the rotate buttons to turn the board in quarter turns. **Undo** steps back one move and **Reset** clears the board.
- Every block must connect to the floor through other blocks, face to face. A floating block is tinted and stops the puzzle from counting as solved.
- The puzzle is solved when both shadows match exactly and nothing floats.
- Solving is only the start: the goal is to use as few blocks as you can. Par is shown next to your block count. Press **Submit** when you are happy; only your first submission for a puzzle counts.
- Stars: three at or under par, two within three blocks of par, one for any other solve.
- After you submit, a result card shows your rank (fewest blocks first, and equal counts share a rank), the leaderboard, and whether anyone else built exactly the same sculpture. **Results** in the top bar opens it again.
- **See other sculptures** on the result card lists every different sculpture players submitted, rarest or leanest first. Tap one to see it on the board; you can rotate it but not change it, and **Back to mine** returns your own board. The list only opens once you have submitted.
- Your streak counts daily puzzles solved in a row, each on the day it was the newest. Solving an older puzzle never changes it. A best streak of 3, 7 or 30 days earns a flair in the community.

## Development

Requires Node 24 or later.

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies |
| `npm run dev` | Starts a playtest in the app's test subreddit and re-uploads on every save |
| `npm test` | Runs the unit tests |
| `npm run test:types` | Type-checks the project |
| `npm run lint` | Lints the source |
| `npm run build` | Builds the client and server into `dist/` |
| `npm run generate` | Regenerates the puzzle queue |
| `npm run deploy` | Type-checks, lints and uploads a new version |

The game cannot load its puzzle outside Reddit, because the server only runs there. To try a local build, serve `dist/client` with any static file server and open `game.html?debug=1`.

## Layout

| Path | Contents |
| --- | --- |
| `src/shared/` | Puzzle types, game rules and response validation, used by both sides |
| `src/client/` | The three.js board, tap input and the HTML controls |
| `src/server/` | The Hono server: the puzzle, submit, result and gallery endpoints, post creation, the daily job, leaderboards, streaks and flair |
| `src/generator/` | The offline puzzle generator, run with `npm run generate` |
| `devvit.json` | App configuration: entry points, menu item, install trigger and the scheduled task |

Built with [Devvit Web](https://developers.reddit.com/), [three.js](https://threejs.org/), [Hono](https://hono.dev/), [Vite](https://vite.dev/) and TypeScript.
