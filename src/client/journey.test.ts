import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_PUZZLE, TEST_SOLUTION } from '../shared/puzzle';
import type { JourneyClient } from './journey';

// The package only exists inside Reddit's web view, so the tests stand in for it.
const packageClient = vi.hoisted(() => ({ created: [] as unknown[] }));
vi.mock('@devvit/analytics/client/reddit', () => ({
  createTelemetryClient: (options: unknown) => {
    packageClient.created.push(options);
    return {};
  },
}));
vi.mock('@devvit/web/client', () => ({ context: { postId: 't3_abc' } }));

const { createJourneys, NO_JOURNEY } = await import('./journey');
const { createStore } = await import('./store');

type Sent = [name: string, input?: unknown];

/** A telemetry client that records what it was asked to send. */
const recorder = () => {
  const sent: Sent[] = [];
  const client: JourneyClient = {
    appReady: async () => void sent.push(['appReady']),
    startJourney: async () => void sent.push(['startJourney']),
    progress: async (input) => void sent.push(['progress', input]),
    interaction: async (input) => void sent.push(['interaction', input]),
    endJourney: async (input) => void sent.push(['endJourney', input]),
  };
  return { sent, client };
};

const names = (sent: Sent[]): string[] => sent.map(([name]) => name);

/** A fresh game on the test puzzle, as a player who has not submitted. */
const fresh = (blocks: readonly string[] = [], submitted = false) => {
  const { sent, client } = recorder();
  const journeys = createJourneys(client);
  const store = createStore(TEST_PUZZLE.size, blocks);
  const tracker = journeys.track(store, TEST_PUZZLE, { submitted });
  return { sent, journeys, store, tracker };
};

const solve = (store: ReturnType<typeof createStore>): void => {
  for (const block of TEST_SOLUTION) store.add(block);
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the journey of one puzzle', () => {
  it('follows a whole play: ready, start, solved, end, then what the player looks at', () => {
    const { sent, journeys, store, tracker } = fresh();
    journeys.boardDrawn();
    solve(store);
    tracker.submitted(3);
    tracker.resultViewed();
    tracker.galleryOpened();
    tracker.resultShared();

    expect(sent).toEqual([
      ['appReady'],
      ['startJourney'],
      ['progress', { progress: 1, action: 'solved', actionDetails: '6 blocks' }],
      ['endJourney', { complete: true, game: { win: true, score: 3 } }],
      ['interaction', { action: 'result_viewed' }],
      ['interaction', { action: 'gallery_opened' }],
      ['interaction', { action: 'result_shared' }],
    ]);
  });

  it('sends nothing when a puzzle loads, with or without blocks on the board', () => {
    expect(fresh().sent).toEqual([]);
    expect(fresh(TEST_SOLUTION).sent).toEqual([]);
  });

  it('does not start on rotating or changing mode, only on the first block placed', () => {
    const { sent, store } = fresh();
    store.rotate(1);
    store.setMode('remove');
    store.setMode('add');
    expect(sent).toEqual([]);

    store.add('0,0,0');
    expect(names(sent)).toEqual(['startJourney']);
    store.add('1,0,0');
    store.remove('1,0,0');
    store.undo();
    expect(names(sent)).toEqual(['startJourney']);
  });

  it('does not start on a block that could not be placed', () => {
    const { sent, store } = fresh();
    expect(store.add('9,9,9')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('reports the solve once, however often the board becomes solved again', () => {
    const { sent, store } = fresh();
    solve(store);
    store.remove('0,0,0');
    store.add('0,0,0');
    store.reset();
    solve(store);
    expect(names(sent)).toEqual(['startJourney', 'progress']);
  });

  it('reports the app ready once per page, whatever puzzle is loaded next', () => {
    const { sent, journeys } = fresh();
    journeys.boardDrawn();
    journeys.boardDrawn();
    journeys.track(createStore(TEST_PUZZLE.size), TEST_PUZZLE, { submitted: false });
    journeys.boardDrawn();
    expect(names(sent)).toEqual(['appReady']);
  });

  it('ends once, and sends nothing more about play afterwards', () => {
    const { sent, store, tracker } = fresh();
    solve(store);
    tracker.submitted(2);
    tracker.submitted(2);
    store.reset();
    solve(store);
    expect(names(sent)).toEqual(['startJourney', 'progress', 'endJourney']);
  });

  it('sends each kind of interaction once', () => {
    const { sent, tracker } = fresh([], true);
    tracker.resultViewed();
    tracker.resultViewed();
    tracker.galleryOpened();
    tracker.galleryOpened();
    tracker.resultShared();
    tracker.resultShared();
    expect(sent).toEqual([
      ['interaction', { action: 'result_viewed' }],
      ['interaction', { action: 'gallery_opened' }],
      ['interaction', { action: 'result_shared' }],
    ]);
  });
});

describe('a puzzle the player has already submitted', () => {
  it('never starts, progresses or ends a journey, but still reports what is looked at', () => {
    const { sent, store, tracker } = fresh(TEST_SOLUTION, true);
    store.reset();
    solve(store);
    tracker.submitted(3);
    expect(sent).toEqual([]);

    tracker.resultViewed();
    expect(sent).toEqual([['interaction', { action: 'result_viewed' }]]);
  });
});

describe('gallery viewing mode', () => {
  it('sends nothing while another sculpture is on the board, and nothing for leaving it', () => {
    const { sent, store, tracker } = fresh(TEST_SOLUTION, true);
    store.view(['0,0,0', '1,0,0', '2,0,0']);
    tracker.resultViewed();
    tracker.galleryOpened();
    tracker.resultShared();
    store.rotate(1);
    store.view(TEST_SOLUTION);
    store.endView();
    expect(sent).toEqual([]);
  });

  it('does not take a viewed sculpture for the player placing blocks', () => {
    // Not a state the game reaches, since the gallery needs a submission, but
    // the tracker must not depend on that.
    const { sent, store } = fresh();
    store.view(TEST_SOLUTION);
    store.endView();
    expect(sent).toEqual([]);
  });
});

describe('a debug puzzle', () => {
  it('has a tracker that sends nothing', () => {
    const { sent } = fresh();
    NO_JOURNEY.submitted(3);
    NO_JOURNEY.resultViewed();
    NO_JOURNEY.galleryOpened();
    NO_JOURNEY.resultShared();
    NO_JOURNEY.stop();
    expect(sent).toEqual([]);
  });
});

describe('stopping', () => {
  it('sends nothing after the game has been replaced', () => {
    const { sent, store, tracker } = fresh();
    tracker.stop();
    solve(store);
    tracker.submitted(3);
    tracker.resultViewed();
    expect(sent).toEqual([]);
  });
});

describe('when telemetry fails', () => {
  const failing = (fail: () => Promise<unknown>): JourneyClient => ({
    appReady: fail,
    startJourney: fail,
    progress: fail,
    interaction: fail,
    endJourney: fail,
  });

  const playThrough = async (client: JourneyClient) => {
    const journeys = createJourneys(client);
    const store = createStore(TEST_PUZZLE.size);
    const tracker = journeys.track(store, TEST_PUZZLE, { submitted: false });
    journeys.boardDrawn();
    solve(store);
    tracker.submitted(3);
    tracker.resultViewed();
    tracker.galleryOpened();
    tracker.resultShared();
    // Lets any rejected promise surface before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return store;
  };

  it('keeps the game working when every call is refused later', async () => {
    const store = await playThrough(failing(() => Promise.reject(new Error('telemetry is down'))));
    expect([...store.getState().blocks].sort()).toEqual([...TEST_SOLUTION].sort());
    expect(store.remove('0,0,0')).toBe(true);
  });

  it('keeps the game working when every call throws at once', async () => {
    const store = await playThrough(
      failing(() => {
        throw new Error('telemetry is broken');
      })
    );
    expect([...store.getState().blocks].sort()).toEqual([...TEST_SOLUTION].sort());
    expect(store.add('1,2,1')).toBe(true);
  });

  it('prints nothing for the player or the console', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await playThrough(failing(() => Promise.reject(new Error('telemetry is down'))));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the page`s own journeys', () => {
  it('keeps a separate journey for each post', () => {
    expect(packageClient.created).toEqual([{ storageKey: 'devvit.telemetry.journeySession.t3_abc' }]);
  });
});
