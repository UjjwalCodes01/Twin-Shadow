// Whether a player gets the warm-up and the first-solve hint, and remembering
// when they have had them. The server remembers a logged-in player; this
// device also remembers, which covers a logged-out visitor and a request
// that failed.

import { parseOnboardingResponse, type Onboarding, type OnboardingEvent } from '../shared/api';

const STORAGE_KEY = 'twin-shadows.onboarding';
const ONBOARDING_URL = '/api/onboarding';

/** What this device remembers a player has already had. */
export type Remembered = { warmup: boolean; solveHint: boolean };

export const NOTHING_REMEMBERED: Remembered = { warmup: false, solveHint: false };

/**
 * Whether to start with the warm-up: only for a player neither the server nor
 * this device has seen finish or skip it, and never for one who has already
 * submitted this puzzle, who plainly knows how to play.
 */
export const needsWarmup = (server: Onboarding, device: Remembered, alreadySubmitted: boolean): boolean =>
  server.warmup && !device.warmup && !alreadySubmitted;

/** Whether the first-solve hint is still to be shown on a real puzzle. */
export const needsSolveHint = (server: Onboarding, device: Remembered, alreadySubmitted: boolean): boolean =>
  server.solveHint && !device.solveHint && !alreadySubmitted;

/** What the device remembers after one more thing has happened. */
export const afterEvent = (device: Remembered, event: OnboardingEvent): Remembered =>
  event === 'solve-hint-seen' ? { ...device, solveHint: true } : { ...device, warmup: true };

/** Reads what this device remembers. Storage can be unavailable; that counts as nothing. */
export const readRemembered = (): Remembered => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return NOTHING_REMEMBERED;
    return {
      warmup: 'warmup' in value && value.warmup === true,
      solveHint: 'solveHint' in value && value.solveHint === true,
    };
  } catch {
    return NOTHING_REMEMBERED;
  }
};

/**
 * Remembers one thing a first-time player has done or seen: on this device at
 * once, and on the server in the background. Never throws, and nothing waits
 * for it: forgetting would only mean a hint is offered once more.
 */
export const remember = (event: OnboardingEvent): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(afterEvent(readRemembered(), event)));
  } catch {
    // Storage is unavailable; the server may still remember.
  }
  void fetch(ONBOARDING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
    .then(async (response) => {
      const body: unknown = await response.json();
      const parsed = parseOnboardingResponse(body);
      // A logged-out visitor is refused, which is expected: the device remembers for them.
      if (parsed?.status !== 'ok' && response.status !== 401) throw new Error(`HTTP ${response.status}`);
    })
    .catch((error: unknown) => {
      console.error(`Could not record ${event} at ${ONBOARDING_URL}:`, error);
    });
};
