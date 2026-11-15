import { describe, expect, it } from 'vitest';
import frauncesLicence from './fonts/fraunces/OFL.txt?raw';
import stylesheet from './game.css?raw';
import { HUD_VARIABLES, pickFor, THEME } from './theme';

/** The licence text kept beside each bundled font, by the font's folder. */
const LICENCES: Record<string, string> = { fraunces: frauncesLicence };

const { hud } = THEME;

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

// The page is the page colour under a gradient of lamplight. Text that sits
// straight on the page can be over any part of it, so it is checked against
// every colour the gradient passes through.
const pageColours = [hud['--page'], ...(hud['--page-image'].match(/#[0-9a-f]{6}/gi) ?? [])];

describe('the HUD values', () => {
  it('give every variable the stylesheet reads a value', () => {
    for (const name of HUD_VARIABLES) expect(hud[name], name).toMatch(/\S/);
    expect(Object.keys(hud).sort()).toEqual([...HUD_VARIABLES].sort());
  });

  it('are the only place the stylesheet takes a colour from', () => {
    const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
    // No colour written out: not as #hex (three to eight hex digits, which no
    // id in the stylesheet is), not as rgb() or hsl().
    expect(css.match(/#[0-9a-f]{3,8}(?![\w-])/gi) ?? []).toEqual([]);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    // Every variable it reads is one the theme gives, apart from the ones a rule sets for itself.
    const read = new Set([...css.matchAll(/var\((--[a-z-]+)/g)].map((found) => found[1]));
    const local = new Set(['--accent']);
    for (const name of read) {
      if (name === undefined || local.has(name)) continue;
      expect(HUD_VARIABLES, name).toContain(name);
    }
  });
});

describe('text contrast', () => {
  // Every pairing of lettering and background the stylesheet makes, each at
  // least 4.5 to 1.
  const onPage = ['--ink', '--ink-soft', '--front', '--side', '--warn', '--extra'] as const;
  const pairs: [text: string, background: string, where: string][] = [
    ...pageColours.flatMap((page) =>
      onPage.map((name): [string, string, string] => [hud[name], page, `${name} on the page (${page})`])
    ),
    [hud['--ink'], hud['--surface'], 'ink on a card'],
    [hud['--ink-soft'], hud['--surface'], 'soft ink on a card'],
    [hud['--front'], hud['--surface'], 'the Front label on a solved panel'],
    [hud['--side'], hud['--surface'], 'the Side label on a solved panel'],
    [hud['--extra'], hud['--surface'], 'an error on a card'],
    [hud['--ink'], hud['--list-bg'], 'ink in a list'],
    [hud['--ink-soft'], hud['--list-bg'], 'soft ink in a list'],
    [hud['--surface'], hud['--ink'], 'a filled button'],
    [hud['--on-strong'], hud['--front'], 'the Under par mark'],
    [hud['--on-strong'], hud['--extra'], 'the armed Reset button'],
    [hud['--ink'], hud['--line'], 'the chosen mode while viewing'],
  ];

  it('is at least 4.5 to 1 for all lettering', () => {
    for (const [text, background, where] of pairs) {
      expect(contrast(text, background), where).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is at least 3 to 1 for the star shapes, which are not lettering', () => {
    for (const background of [...pageColours, hud['--surface']]) {
      expect(contrast(hud['--star-line'], background), `star outline on ${background}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(hud['--surface'], hud['--ink']), 'star outline on a filled button').toBeGreaterThanOrEqual(3);
  });
});

describe('the fonts', () => {
  it('are bundled files, never another site`s', () => {
    expect(THEME.fonts.length).toBeGreaterThan(0);
    for (const font of THEME.fonts) {
      expect(font.url, font.family).toMatch(/\/fonts\/[a-z-]+\/[a-z0-9-]+\.woff2$/);
      expect(font.url).not.toMatch(/^https?:/);
      expect(hud['--font-body'] + hud['--font-display']).toContain(font.family);
    }
  });

  it('each have their licence beside them', () => {
    for (const font of THEME.fonts) {
      const folder = /\/fonts\/([a-z-]+)\//.exec(font.url)?.[1] ?? '';
      expect(LICENCES[folder], font.family).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});

describe('the board', () => {
  const { blocks } = THEME.scene;

  it('has several tones of wood, and keeps the lamp tint subtle', () => {
    expect(blocks.tones.length).toBeGreaterThan(1);
    expect(blocks.lampTint.amount).toBeGreaterThan(0);
    expect(blocks.lampTint.amount).toBeLessThanOrEqual(0.15);
  });

  it('shows a floating block by more than its colour: smaller and lifted', () => {
    expect(blocks.floating.scale).toBeLessThan(blocks.scale);
    expect(blocks.floating.lift).toBeGreaterThan(0);
  });

  it('marks extra shadow with strokes, and the target with a dashed outline', () => {
    const { wall } = THEME.paint;
    expect(wall.extra.stroke.weight).toBeGreaterThan(0);
    expect(wall.outline.dash).toBeGreaterThan(0);
    expect(wall.outline.gap).toBeGreaterThan(0);
  });

  it('lets the paper show through a shadow', () => {
    expect(THEME.paint.wall.shadow.alpha).toBeLessThan(1);
    expect(THEME.paint.wall.shadow.alpha).toBeGreaterThan(0.5);
  });
});

describe('pickFor', () => {
  it('always gives the same choice to the same cell', () => {
    expect(pickFor('1,2,3', 4)).toBe(pickFor('1,2,3', 4));
  });

  it('stays inside the choices there are, and uses all of them', () => {
    const used = new Set<number>();
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        for (let z = 0; z < 5; z++) {
          const index = pickFor(`${x},${y},${z}`, 4);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(4);
          used.add(index);
        }
      }
    }
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
    expect(pickFor('0,0,0', 1)).toBe(0);
  });

  it('gives a different spread with a different salt', () => {
    const cells = Array.from({ length: 40 }, (_, index) => `${index % 5},${index % 3},${index % 4}`);
    expect(cells.map((cell) => pickFor(cell, 3))).not.toEqual(cells.map((cell) => pickFor(cell, 3, 7)));
  });
});
