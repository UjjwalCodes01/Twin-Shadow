import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, HUD_VARIABLES, isThemeId, THEME_IDS, THEMES, toneIndex, type Theme } from './theme';

const themes: Theme[] = THEME_IDS.map((id) => THEMES[id]);
// The three art directions. "plain" is the look the game already had, kept as it was.
const directions = themes.filter((theme) => theme.id !== 'plain');

/** Relative luminance of a #rrggbb colour, as WCAG defines it. */
const luminance = (colour: string): number => {
  const match = /^#([0-9a-f]{6})$/i.exec(colour);
  if (!match?.[1]) throw new Error(`${colour} is not a #rrggbb colour`);
  const value = parseInt(match[1], 16);
  const channel = (shift: number): number => {
    const part = ((value >> shift) & 255) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
};

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

describe('every theme', () => {
  it('is listed under its own id', () => {
    for (const id of THEME_IDS) expect(THEMES[id].id).toBe(id);
    expect(DEFAULT_THEME.id).toBe('plain');
  });

  it('gives every HUD variable a value', () => {
    for (const theme of themes) {
      for (const name of HUD_VARIABLES) {
        expect(theme.hud[name], `${theme.id} ${name}`).toMatch(/\S/);
      }
      expect(Object.keys(theme.hud).sort(), theme.id).toEqual([...HUD_VARIABLES].sort());
    }
  });

  it('has at least one tone for its blocks', () => {
    for (const theme of themes) expect(theme.scene.blocks.tones.length, theme.id).toBeGreaterThan(0);
  });

  it('only names fonts it bundles', () => {
    for (const theme of themes) {
      for (const font of theme.fonts) {
        expect(font.url, `${theme.id} ${font.family}`).toMatch(/\/fonts\/[a-z-]+\/[a-z0-9-]+\.woff2$/);
        expect(font.url).not.toMatch(/^https?:/);
        expect(theme.hud['--font-body'] + theme.hud['--font-display']).toContain(font.family);
      }
    }
  });
});

describe('the plain theme', () => {
  it('keeps the colours the game has always had', () => {
    const { hud, scene } = THEMES.plain;
    expect(hud['--page']).toBe('#e9e6df');
    expect(hud['--front']).toBe('#1f7a6d');
    expect(hud['--side']).toBe('#7a4fb0');
    expect(scene.background).toBe(0xe9e6df);
    expect(scene.blocks.tones).toEqual([0x7aa2c8]);
    expect(THEMES.plain.fonts).toEqual([]);
  });
});

describe('the three art directions', () => {
  it('keep text readable against the page and against cards', () => {
    for (const { id, hud } of directions) {
      for (const background of [hud['--page'], hud['--surface']]) {
        expect(contrast(hud['--ink'], background), `${id} ink on ${background}`).toBeGreaterThanOrEqual(7);
        expect(contrast(hud['--ink-soft'], background), `${id} soft ink on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      // Buttons are filled with the ink colour and lettered in the surface colour.
      expect(contrast(hud['--surface'], hud['--ink']), `${id} button`).toBeGreaterThanOrEqual(7);
      // The panel labels, the star line and warnings are lettered in these.
      for (const name of ['--front', '--side', '--floating', '--extra'] as const) {
        expect(contrast(hud[name], hud['--page']), `${id} ${name} on the page`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('tell matched, missing and extra cells apart by more than colour', () => {
    for (const { id, hud } of directions) {
      for (const side of ['front', 'side'] as const) {
        const match = hud[`--${side}-match-bg`];
        const missing = hud[`--${side}-missing-bg`];
        // Missing is an empty outline; matched is filled in.
        expect(missing, `${id} ${side} missing`).toBe('transparent');
        expect(match, `${id} ${side} match`).not.toBe('transparent');
        // Extra carries a pattern (stripes, hatching or a cross), which matched does not share.
        expect(hud['--extra-bg'], `${id} extra`).toMatch(/gradient\(/);
        expect(hud['--extra-bg']).not.toBe(match);
      }
    }
  });

  it('paint their walls and floors in code', () => {
    for (const { id, scene } of directions) {
      expect(scene.walls.style, id).toBe('drawn');
      expect(scene.floor.style, id).toBe('drawn');
    }
  });
});

describe('isThemeId', () => {
  it('accepts the known ids and nothing else', () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true);
    for (const other of ['', 'Plain', 'dark', null, undefined, 3]) expect(isThemeId(other), String(other)).toBe(false);
  });
});

describe('toneIndex', () => {
  it('always gives the same tone to the same cell', () => {
    expect(toneIndex('1,2,3', 4)).toBe(toneIndex('1,2,3', 4));
  });

  it('stays inside the tones there are, and uses all of them', () => {
    const used = new Set<number>();
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        for (let z = 0; z < 5; z++) {
          const index = toneIndex(`${x},${y},${z}`, 4);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(4);
          used.add(index);
        }
      }
    }
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
    expect(toneIndex('0,0,0', 1)).toBe(0);
  });
});
