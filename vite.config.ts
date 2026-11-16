import { defineConfig, type Plugin } from 'vite';
import { devvit } from '@devvit/start/vite';

// The theme file is plain TypeScript with nothing to run on import, so Node
// can load it as it stands. It is loaded by address, when the build starts,
// rather than with an import at the top of this file.
type ThemeModule = typeof import('./src/client/theme');
const THEME_FILE = new URL('./src/client/theme.ts', import.meta.url).href;

/**
 * Writes the theme's HUD values into game.css and splash.css as they are built. The values
 * still live only in src/client/theme.ts; this puts a copy where the browser
 * reads it before any script has run, so the page is never shown unstyled.
 */
const themeDefaults = (): Plugin => {
  let defaults = '';
  return {
    name: 'twin-shadows:theme-defaults',
    enforce: 'pre',
    async buildStart() {
      const theme: ThemeModule = await import(THEME_FILE);
      const values = theme.HUD_VARIABLES.map((name) => `  ${name}: ${theme.THEME.hud[name]};`);
      defaults = `:root {\n${values.join('\n')}\n}\n\n`;
    },
    transform(code, id) {
      // The two stylesheets themselves only: a test that reads one as text gets it as written.
      const file = id.split('?')[0] ?? '';
      const themed = file.endsWith('/src/client/game.css') || file.endsWith('/src/client/splash.css');
      if (id.includes('?raw') || !themed) return null;
      return { code: defaults + code, map: null };
    },
  };
};

/** The game's main file, with the 3D board: what game.ts fetches as soon as it runs. */
const PLAY_FILE = '/src/client/play.ts';

/**
 * Lets the browser fetch the game's main file, and the files that one needs,
 * while it is still reading game.html. The page's first script is small and
 * asks for the main file itself, but only once it has arrived and run: on a
 * slow connection that is one round trip later. With these lines in the page
 * the big download starts at once, and the first script finds it under way.
 */
const preloadGame = (): Plugin => ({
  name: 'twin-shadows:preload-game',
  transformIndexHtml: {
    order: 'post',
    handler(html, { filename, bundle }) {
      if (!filename.endsWith('/game.html') || !bundle) return html;
      const chunks = Object.values(bundle).flatMap((file) => (file.type === 'chunk' ? [file] : []));
      const play = chunks.find((chunk) => chunk.facadeModuleId?.endsWith(PLAY_FILE));
      if (!play) throw new Error(`No built file for ${PLAY_FILE}: game.html cannot preload the game`);
      // The main file and everything it imports, each once.
      const files = new Set<string>();
      const add = (fileName: string): void => {
        if (files.has(fileName)) return;
        files.add(fileName);
        chunks.find((chunk) => chunk.fileName === fileName)?.imports.forEach(add);
      };
      add(play.fileName);
      // Not the page's own script, which is already asked for, nor anything the page already lists.
      const entries = new Set(chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
      return [...files]
        .filter((fileName) => !entries.has(fileName) && !html.includes(`href="/${fileName}"`))
        .map((fileName) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `/${fileName}` },
          injectTo: 'head' as const,
        }));
    },
  },
});

export default defineConfig({
  plugins: [themeDefaults(), devvit(), preloadGame()],
});
