import { describe, expect, it } from 'vitest';
import type { GalleryEntry } from '../shared/api';
import { entryText, mergeEntries, ownerText, playersText } from './gallery';

const entry = (id: string, changes: Partial<GalleryEntry> = {}): GalleryEntry => ({
  id,
  blocks: 9,
  builders: 1,
  first: 'ann',
  sculpture: ['0,0,0'],
  yours: false,
  ...changes,
});

describe('gallery wording', () => {
  it('counts players in the singular and plural', () => {
    expect(playersText(1)).toBe('1 player');
    expect(playersText(41)).toBe('41 players');
  });

  it('says how big a sculpture is and how many built it', () => {
    expect(entryText({ blocks: 9, builders: 3 })).toBe('9 blocks, built by 3 players');
    expect(entryText({ blocks: 1, builders: 1 })).toBe('1 block, built by 1 player');
  });

  it('names the first builder, or says the sculpture is the player`s own', () => {
    expect(ownerText({ yours: false, first: 'ann' })).toBe('First built by ann');
    expect(ownerText({ yours: true, first: 'ann' })).toBe('Your sculpture');
  });
});

describe('mergeEntries', () => {
  it('adds a new page after the entries already loaded', () => {
    const merged = mergeEntries([entry('a'), entry('b')], [entry('c'), entry('d')]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('skips a sculpture that is already in the list', () => {
    // Counts change between requests, so a sculpture can move onto the next page.
    const merged = mergeEntries([entry('a'), entry('b')], [entry('b', { builders: 2 }), entry('c')]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1]?.builders).toBe(1);
  });

  it('leaves the loaded entries untouched', () => {
    const loaded = [entry('a')];
    mergeEntries(loaded, [entry('b')]);
    expect(loaded).toHaveLength(1);
  });
});
