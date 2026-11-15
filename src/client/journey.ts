// Journey telemetry: tells Reddit how a play session went (board ready,
// started, solved, submitted, and a few things looked at afterwards).
//
// This is the one client file that touches @devvit/analytics. To remove
// Journeys: delete this file and its uses in game.ts, delete
// src/server/routes/telemetry.ts and its route in index.ts, uninstall the
// package and take `journeys` out of permissions in devvit.json.
//
// Telemetry is never allowed to matter to play: every call here is
// fire-and-forget, and a failure or a refused event is swallowed.

import { createTelemetryClient } from '@devvit/analytics/client/reddit';
import { context } from '@devvit/web/client';
import { isSolved } from '../shared/logic';
import type { Puzzle } from '../shared/puzzle';
import type { Store } from './store';

/** The telemetry calls the tracker makes. The package's browser client fits this. */
export type JourneyClient = {
  appReady: () => Promise<unknown>;
  startJourney: () => Promise<unknown>;
  progress: (input: { progress: number; action: string; actionDetails: string }) => Promise<unknown>;
  interaction: (input: { action: string }) => Promise<unknown>;
  endJourney: (input: { complete: boolean; game: { win: boolean; score: number } }) => Promise<unknown>;
};

/** What the game reports about one puzzle. Every method is safe to call at any time, any number of times. */
export type JourneyTracker = {
  /** The player's solution was accepted. */
  submitted: (stars: number) => void;
  resultViewed: () => void;
  galleryOpened: () => void;
  resultShared: () => void;
  /** Stops watching the board. Nothing is sent afterwards. */
  stop: () => void;
};

export type Journeys = {
  /** The board has been drawn. Only the first call on a page sends anything. */
  boardDrawn: () => void;
  /**
   * Watches one post's puzzle. `submitted` says whether the player had
   * already submitted when it loaded: a journey only starts on a puzzle
   * they have not.
   */
  track: (store: Store, puzzle: Puzzle, options: { submitted: boolean }) => JourneyTracker;
};

/** For a debug puzzle: reports nothing. */
export const NO_JOURNEY: JourneyTracker = {
  submitted: () => {},
  resultViewed: () => {},
  galleryOpened: () => {},
  resultShared: () => {},
  stop: () => {},
};

export const INTERACTIONS = ['result_viewed', 'gallery_opened', 'result_shared'] as const;
type Interaction = (typeof INTERACTIONS)[number];

export const createJourneys = (client: JourneyClient): Journeys => {
  /** Fire and forget: nothing a telemetry call does may reach the game. */
  const send = (call: () => Promise<unknown>): void => {
    try {
      call().catch(() => {});
    } catch {
      // A call that throws straight away matters no more than one that fails later.
    }
  };

  let appReadySent = false;

  return {
    boardDrawn: () => {
      if (appReadySent) return;
      appReadySent = true;
      send(() => client.appReady());
    },

    track: (store, puzzle, { submitted }) => {
      let stopped = false;
      // The journey is the play itself, so only a puzzle not yet submitted has one.
      let finished = submitted;
      let started = false;
      let solved = false;
      const interactionsSent = new Set<Interaction>();
      let count = store.getState().blocks.size;

      const unsubscribe = store.subscribe((state) => {
        // Another player's sculpture on the board is not this player's play.
        if (stopped || state.viewing) return;
        const placed = state.blocks.size > count;
        count = state.blocks.size;
        if (finished) return;
        // The first block the player places starts the journey. Loading never does.
        if (!started && placed) {
          started = true;
          send(() => client.startJourney());
        }
        // Once, when the sculpture first casts both shadows.
        if (started && !solved && isSolved(state.blocks, puzzle)) {
          solved = true;
          send(() => client.progress({ progress: 1, action: 'solved', actionDetails: `${count} blocks` }));
        }
      });

      /** Each kind of interaction is sent once per puzzle loaded, to keep the number of events small. */
      const interaction = (action: Interaction): void => {
        if (stopped || store.getState().viewing || interactionsSent.has(action)) return;
        interactionsSent.add(action);
        send(() => client.interaction({ action }));
      };

      return {
        submitted: (stars) => {
          if (stopped || finished) return;
          finished = true;
          // The end event has room for one number, so it carries the stars.
          if (started) send(() => client.endJourney({ complete: true, game: { win: true, score: stars } }));
        },
        resultViewed: () => interaction('result_viewed'),
        galleryOpened: () => interaction('gallery_opened'),
        resultShared: () => interaction('result_shared'),
        stop: () => {
          stopped = true;
          unsubscribe();
        },
      };
    },
  };
};

// Each post keeps its own journey, so leaving one puzzle unfinished and
// playing another is two journeys, not one.
const STORAGE_KEY = `devvit.telemetry.journeySession.${context?.postId ?? 'no-post'}`;

/** The journeys of this page, sent through the package's client. */
export const journeys: Journeys = createJourneys(createTelemetryClient({ storageKey: STORAGE_KEY }));
