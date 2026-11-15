// Journey telemetry: the routes the client's telemetry calls post to, which
// pass each event on to Reddit.
//
// This is the one server file that touches @devvit/analytics. To remove
// Journeys: delete this file and its route in index.ts, delete
// src/client/journey.ts and its uses in game.ts, uninstall the package and
// take `journeys` out of permissions in devvit.json.
//
// Telemetry is never allowed to matter to play. Every route answers with JSON
// whatever happens, and a refused or failed event is only logged.

import { Hono } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';

// Mounted at /api/telemetry in index.ts. The paths below are the ones the
// package's browser client posts to.
export const telemetryRoutes = new Hono();

type Receipt = { status: string; message: string };

const ACCEPTED = 'JOURNEY_RECEIPT_VALID';
const NOT_SENT: Receipt = { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: 'Not sent: the telemetry call failed.' };
const INVALID: Receipt = { status: 'JOURNEY_RECEIPT_INVALID', message: 'Invalid: Event payload was not recorded.' };

// What has been logged already, so each outcome is logged once for as long as
// this server instance lives rather than once per event.
const logged = new Set<string>();
const once = (key: string, log: () => void): void => {
  if (logged.has(key)) return;
  logged.add(key);
  log();
};

/** Logs each kind of receipt once: every reason an event was refused, and the first acceptance. */
const noteReceipt = (event: string, { status, message }: Receipt): void =>
  once(`receipt:${status}`, () => {
    if (status === ACCEPTED) console.log(`Journey events are being accepted (first: ${event})`);
    else console.warn(`Journey event refused (first: ${event}): ${status}: ${message}`);
  });

/** Sends one event. A telemetry call that throws becomes an ordinary answer, logged once per event. */
const send = async <T extends { receipt: Receipt }>(
  event: string,
  call: () => Promise<T>
): Promise<{ ok: true; response: T } | { ok: false }> => {
  try {
    const response = await call();
    noteReceipt(event, response.receipt);
    return { ok: true, response };
  } catch (error) {
    once(`error:${event}`, () => console.error(`Journey event failed (${event}): ${error}`));
    return { ok: false };
  }
};

const FAILED = { error: 'Telemetry failed', receipt: NOT_SENT } as const;
const badRequest = (error: string) => ({ error, receipt: INVALID });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

telemetryRoutes.post('/journey/app-ready', async (c) => {
  const sent = await send('app ready', () => telemetry.appReady());
  return sent.ok ? c.json(sent.response) : c.json(FAILED, 500);
});

telemetryRoutes.post('/journey/start', async (c) => {
  // A refused start comes back with no journey id and the reason in its receipt.
  const sent = await send('journey start', () => telemetry.startJourney());
  return sent.ok ? c.json(sent.response) : c.json(FAILED, 500);
});

telemetryRoutes.post('/journey/progress', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body)) return c.json(badRequest('The body must be an object.'), 400);
  const { journeyId, progress, action, actionDetails } = body;
  if (!isText(journeyId)) return c.json(badRequest('journeyId is required.'), 400);
  if (typeof progress !== 'number' || !(progress >= 0 && progress <= 1)) {
    return c.json(badRequest('progress must be a number from 0 to 1.'), 400);
  }
  if (!isOptionalString(action) || !isOptionalString(actionDetails)) {
    return c.json(badRequest('action and actionDetails must be strings.'), 400);
  }
  const sent = await send('journey progress', () =>
    telemetry.journeyProgress({ journeyId, progress, action: action ?? '', actionDetails: actionDetails ?? '' })
  );
  return sent.ok ? c.json(sent.response) : c.json(FAILED, 500);
});

telemetryRoutes.post('/journey/interaction', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body)) return c.json(badRequest('The body must be an object.'), 400);
  const { journeyId, action, actionDetails } = body;
  if (!isText(action)) return c.json(badRequest('action is required.'), 400);
  if (!isOptionalString(journeyId) || !isOptionalString(actionDetails)) {
    return c.json(badRequest('journeyId and actionDetails must be strings.'), 400);
  }
  // An interaction may come after its journey has ended, with no journey id.
  const sent = await send(`interaction ${action}`, () =>
    telemetry.journeyInteraction({ journeyId: journeyId ?? '', action, actionDetails: actionDetails ?? '' })
  );
  return sent.ok ? c.json(sent.response) : c.json(FAILED, 500);
});

telemetryRoutes.post('/journey/end', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body)) return c.json(badRequest('The body must be an object.'), 400);
  const { journeyId, complete, game } = body;
  if (!isText(journeyId)) return c.json(badRequest('journeyId is required.'), 400);
  if (complete !== undefined && typeof complete !== 'boolean') {
    return c.json(badRequest('complete must be true or false.'), 400);
  }
  let result: { win: boolean; score: number } | undefined;
  if (game !== undefined) {
    if (!isRecord(game) || typeof game.win !== 'boolean' || typeof game.score !== 'number' || !Number.isFinite(game.score)) {
      return c.json(badRequest('game must have a win flag and a score.'), 400);
    }
    result = { win: game.win, score: game.score };
  }
  const sent = await send('journey end', () =>
    telemetry.endJourney({ journeyId, complete: complete ?? false, ...(result ? { game: result } : {}) })
  );
  return sent.ok ? c.json(sent.response) : c.json(FAILED, 500);
});

/** For tests: forgets what has been logged, so each test sees the first log again. */
export const forgetLoggedReceipts = (): void => logged.clear();
