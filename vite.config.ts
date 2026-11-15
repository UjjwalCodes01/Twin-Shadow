import { defineConfig, type Plugin } from 'vite';
import { devvit } from '@devvit/start/vite';

// The theme file is plain TypeScript with nothing to run on import, so Node
// can load it as it stands. It is loaded by address, when the build starts,
// rather than with an import at the top of this file.
type ThemeModule = typeof import('./src/client/theme');
const THEME_FILE = new URL('./src/client/theme.ts', import.meta.url).href;

/**
 * Writes the default theme's values into game.css as it is built. The values
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
      const values = theme.HUD_VARIABLES.map((name) => `  ${name}: ${theme.DEFAULT_THEME.hud[name]};`);
      defaults = `:root {\n${values.join('\n')}\n}\n\n`;
    },
    transform(code, id) {
      if (!id.split('?')[0]?.endsWith('/src/client/game.css')) return null;
      return { code: defaults + code, map: null };
    },
  };
};

export default defineConfig({
  plugins: [themeDefaults(), devvit()],
});
