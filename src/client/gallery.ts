// The solver gallery: a list of the distinct sculptures players submitted
// for this post, and a read-only viewing mode that shows one on the main
// board. The server only sends it to a player who has already submitted.

import type { Gallery, GalleryEntry, GallerySort } from '../shared/api';
import { blockText } from './count';
import type { Store } from './store';

// --- Wording (no DOM, so it can be tested) ---------------------------------------

export const playersText = (count: number): string => `${count} ${count === 1 ? 'player' : 'players'}`;

/** Whose sculpture an entry is. */
export const ownerText = ({ yours, first }: Pick<GalleryEntry, 'yours' | 'first'>): string =>
  yours ? 'Your sculpture' : `First built by ${first}`;

/** "9 blocks, built by 3 players". */
export const entryText = ({ blocks, builders }: Pick<GalleryEntry, 'blocks' | 'builders'>): string =>
  `${blockText(blocks)}, built by ${playersText(builders)}`;

/** Adds a page to the entries already loaded, skipping any that are there already. */
export const mergeEntries = (loaded: readonly GalleryEntry[], page: readonly GalleryEntry[]): GalleryEntry[] => {
  const known = new Set(loaded.map((entry) => entry.id));
  return [...loaded, ...page.filter((entry) => !known.has(entry.id))];
};

// --- The gallery -----------------------------------------------------------------

export type GalleryHandle = {
  /** Shows the list, loaded fresh. */
  open: () => void;
  /** Leaves viewing mode, closes the list and removes the listeners. */
  dispose: () => void;
};

export type GalleryOptions = {
  /** Fetches one page. Resolves to null when it cannot be had; never throws. */
  load: (sort: GallerySort, page: number) => Promise<Gallery | null>;
  /** Called when the player goes back from the list to the result card. */
  backToResult: () => void;
};

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

const button = (id: string): HTMLButtonElement => {
  const found = element(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return found;
};

const line = (className: string, text: string): HTMLSpanElement => {
  const span = document.createElement('span');
  span.className = className;
  // textContent, never innerHTML: usernames come from other players.
  span.textContent = text;
  return span;
};

export const createGallery = (store: Store, options: GalleryOptions): GalleryHandle => {
  const layer = element('gallery-layer');
  const status = element('gallery-status');
  const retry = button('gallery-retry');
  const list = element('gallery-list');
  const sortButtons: Record<GallerySort, HTMLButtonElement> = {
    rarest: button('gallery-rarest'),
    leanest: button('gallery-leanest'),
  };
  const bar = element('viewing');
  const owner = element('viewing-owner');
  const detail = element('viewing-detail');
  const previous = button('viewing-prev');
  const next = button('viewing-next');

  const listeners = new AbortController();
  const onClick = (target: HTMLElement, action: () => void): void =>
    target.addEventListener('click', action, { signal: listeners.signal });

  let sort: GallerySort = 'rarest';
  let entries: GalleryEntry[] = [];
  /** Pages loaded so far, and how many there are. */
  let page = 0;
  let pages = 1;
  let total = 0;
  /** Index in `entries` of the sculpture on the board, or null when not viewing. */
  let viewed: number | null = null;
  let loading = false;
  // Counts loads, so a reply for an earlier sort or opening is dropped.
  let latest = 0;

  const hasMore = (): boolean => page < pages;

  /** Loads the next page and adds it to the entries. Resolves to whether it worked. */
  const loadNext = async (): Promise<boolean> => {
    const request = ++latest;
    loading = true;
    const gallery = await options.load(sort, page + 1);
    if (request !== latest || listeners.signal.aborted) return false;
    loading = false;
    if (!gallery) return false;
    entries = mergeEntries(entries, gallery.entries);
    page = gallery.page;
    pages = gallery.pages;
    total = gallery.total;
    return true;
  };

  // --- Viewing one sculpture on the board ---

  const renderBar = (): void => {
    const entry = viewed === null ? undefined : entries[viewed];
    bar.hidden = entry === undefined;
    if (viewed === null || !entry) return;
    owner.textContent = ownerText(entry);
    detail.textContent = `${entryText(entry)} · ${viewed + 1} of ${total}`;
    previous.disabled = loading || viewed === 0;
    next.disabled = loading || (viewed === entries.length - 1 && !hasMore());
  };

  const view = (index: number): void => {
    const entry = entries[index];
    if (!entry) return;
    viewed = index;
    layer.hidden = true;
    store.view(entry.sculpture);
    renderBar();
  };

  const stopViewing = (): void => {
    viewed = null;
    store.endView();
    renderBar();
  };

  const step = async (by: 1 | -1): Promise<void> => {
    if (viewed === null || loading) return;
    const target = viewed + by;
    // Stepping past the last loaded sculpture fetches the next page first.
    if (target >= entries.length && hasMore()) {
      loading = true;
      renderBar();
      await loadNext();
      loading = false;
      if (listeners.signal.aborted || viewed === null) return;
    }
    if (target >= 0 && target < entries.length) view(target);
    else renderBar();
  };

  // --- The list ---

  const rowItem = (entry: GalleryEntry, index: number): HTMLLIElement => {
    const item = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = entry.yours ? 'gallery-row yours' : 'gallery-row';
    row.append(line('gallery-row-main', entryText(entry)), line('gallery-row-sub', ownerText(entry)));
    onClick(row, () => view(index));
    item.append(row);
    return item;
  };

  const renderList = (): void => {
    list.replaceChildren(...entries.map(rowItem));
    if (hasMore()) {
      const item = document.createElement('li');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'gallery-more';
      more.textContent = 'Show more';
      onClick(more, () => {
        more.disabled = true;
        more.textContent = 'Loading…';
        void loadNext().then((loaded) => {
          if (listeners.signal.aborted) return;
          if (loaded) renderList();
          else {
            more.disabled = false;
            more.textContent = "Couldn't load more. Try again";
          }
        });
      });
      item.append(more);
      list.append(item);
    }
  };

  /** Starts the list again from the first page, in the current order. */
  const reload = (): void => {
    entries = [];
    page = 0;
    pages = 1;
    total = 0;
    for (const [name, sortButton] of Object.entries(sortButtons)) {
      sortButton.setAttribute('aria-pressed', String(name === sort));
    }
    list.replaceChildren();
    list.hidden = true;
    retry.hidden = true;
    status.textContent = 'Loading sculptures…';
    status.hidden = false;
    void loadNext().then((loaded) => {
      if (listeners.signal.aborted || layer.hidden) return;
      if (!loaded) {
        status.textContent = "Couldn't load the sculptures.";
        retry.hidden = false;
        return;
      }
      status.hidden = true;
      list.hidden = false;
      renderList();
      list.scrollTop = 0;
    });
  };

  const setSort = (chosen: GallerySort): void => {
    if (chosen === sort) return;
    sort = chosen;
    reload();
  };

  onClick(sortButtons.rarest, () => setSort('rarest'));
  onClick(sortButtons.leanest, () => setSort('leanest'));
  onClick(retry, reload);
  onClick(button('gallery-close'), () => {
    layer.hidden = true;
    options.backToResult();
  });
  onClick(previous, () => void step(-1));
  onClick(next, () => void step(1));
  onClick(button('viewing-back'), stopViewing);

  return {
    open: () => {
      // Opening the list always starts from the player's own board.
      stopViewing();
      layer.hidden = false;
      reload();
    },
    dispose: () => {
      latest += 1;
      stopViewing();
      layer.hidden = true;
      listeners.abort();
    },
  };
};
