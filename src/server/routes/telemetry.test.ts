import { beforeEach, describe, expect, it, vi } from 'vitest';

type Receipt = { status: string; message: string };
const VALID: Receipt = { status: 'JOURNEY_RECEIPT_VALID', message: 'Recorded.' };
const PLAYTEST: Receipt = { status: 'JOURNEY_RECEIPT_DENIED_PLAYTEST', message: 'Playtest versions are not recorded.' };
const RATE_LIMITED: Receipt = { status: 'JOURNEY_RECEIPT_DENIED_RATE_LIMITED', message: 'Too many events.' };

// The package's server client, replaced by one that records its calls.
const fake = vi.hoisted(() => {
  const state = {
    calls: [] as [name: string, request?: unknown][],
    receipt: { status: 'JOURNEY_RECEIPT_VALID', message: 'Recorded.' },
    journeyId: 'journey-1',
    failing: false,
  };
  const answer = async <T>(name: string, request: unknown, body: T): Promise<T> => {
    state.calls.push(request === undefined ? [name] : [name, request]);
    if (state.failing) throw new Error('The telemetry plugin is unavailable');
    return body;
  };
  const telemetry = {
    appReady: () => answer('appReady', undefined, { receipt: state.receipt }),
    startJourney: () => answer('startJourney', undefined, { journeyId: state.journeyId, receipt: state.receipt }),
    journeyProgress: (request: unknown) => answer('journeyProgress', request, { receipt: state.receipt }),
    journeyInteraction: (request: unknown) => answer('journeyInteraction', request, { receipt: state.receipt }),
    endJourney: (request: unknown) => answer('endJourney', request, { receipt: state.receipt }),
  };
  return { state, telemetry };
});
vi.mock('@devvit/analytics/server/reddit', () => ({ telemetry: fake.telemetry }));

const { telemetryRoutes, forgetLoggedReceipts } = await import('./telemetry');

const post = async (path: string, body?: unknown) => {
  const response = await telemetryRoutes.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = await response.json();
  return { status: response.status, body: parsed };
};

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  forgetLoggedReceipts();
  fake.state.calls.length = 0;
  fake.state.receipt = VALID;
  fake.state.journeyId = 'journey-1';
  fake.state.failing = false;
});

describe('the journey routes', () => {
  it('pass each event on and answer with its receipt', async () => {
    expect(await post('/journey/app-ready')).toEqual({ status: 200, body: { receipt: VALID } });
    expect(await post('/journey/start')).toEqual({ status: 200, body: { journeyId: 'journey-1', receipt: VALID } });
    expect(
      await post('/journey/progress', { journeyId: 'journey-1', progress: 1, action: 'solved', actionDetails: '9 blocks' })
    ).toEqual({ status: 200, body: { receipt: VALID } });
    expect(await post('/journey/interaction', { journeyId: 'journey-1', action: 'result_viewed' })).toEqual({
      status: 200,
      body: { receipt: VALID },
    });
    expect(
      await post('/journey/end', { journeyId: 'journey-1', complete: true, game: { win: true, score: 3 } })
    ).toEqual({ status: 200, body: { receipt: VALID } });

    expect(fake.state.calls).toEqual([
      ['appReady'],
      ['startJourney'],
      ['journeyProgress', { journeyId: 'journey-1', progress: 1, action: 'solved', actionDetails: '9 blocks' }],
      ['journeyInteraction', { journeyId: 'journey-1', action: 'result_viewed', actionDetails: '' }],
      ['endJourney', { journeyId: 'journey-1', complete: true, game: { win: true, score: 3 } }],
    ]);
  });

  it('accept an interaction after the journey has ended, with no journey id', async () => {
    expect((await post('/journey/interaction', { action: 'gallery_opened' })).status).toBe(200);
    expect(fake.state.calls).toEqual([
      ['journeyInteraction', { journeyId: '', action: 'gallery_opened', actionDetails: '' }],
    ]);
  });

  it('refuse a body they cannot read, without sending anything', async () => {
    const bad: [path: string, body: unknown][] = [
      ['/journey/progress', null],
      ['/journey/progress', { progress: 1 }],
      ['/journey/progress', { journeyId: 'journey-1', progress: 2 }],
      ['/journey/progress', { journeyId: 'journey-1', progress: 'half' }],
      ['/journey/progress', { journeyId: 'journey-1', progress: 1, action: 7 }],
      ['/journey/interaction', {}],
      ['/journey/interaction', { action: '' }],
      ['/journey/interaction', { action: 'x', journeyId: 7 }],
      ['/journey/end', { complete: true }],
      ['/journey/end', { journeyId: 'journey-1', complete: 'yes' }],
      ['/journey/end', { journeyId: 'journey-1', game: { win: true } }],
      ['/journey/end', { journeyId: 'journey-1', game: { win: 'yes', score: 3 } }],
    ];
    for (const [path, body] of bad) {
      const answer = await post(path, body);
      expect(answer.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(answer.body).toMatchObject({ receipt: { status: 'JOURNEY_RECEIPT_INVALID' } });
    }
    expect(fake.state.calls).toEqual([]);
  });
});

describe('a refused event', () => {
  it('is answered normally, with the reason in its receipt', async () => {
    fake.state.receipt = PLAYTEST;
    fake.state.journeyId = '';
    expect(await post('/journey/start')).toEqual({ status: 200, body: { journeyId: '', receipt: PLAYTEST } });
    expect(await post('/journey/app-ready')).toEqual({ status: 200, body: { receipt: PLAYTEST } });
  });

  it('is logged once per reason, with the reason', async () => {
    fake.state.receipt = PLAYTEST;
    await post('/journey/app-ready');
    await post('/journey/start');
    await post('/journey/interaction', { action: 'result_viewed' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Journey event refused (first: app ready): JOURNEY_RECEIPT_DENIED_PLAYTEST: Playtest versions are not recorded.'
    );

    fake.state.receipt = RATE_LIMITED;
    await post('/journey/interaction', { action: 'gallery_opened' });
    await post('/journey/interaction', { action: 'result_shared' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      'Journey event refused (first: interaction gallery_opened): JOURNEY_RECEIPT_DENIED_RATE_LIMITED: Too many events.'
    );
  });

  it('is not logged when events are accepted, beyond one line saying so', async () => {
    await post('/journey/app-ready');
    await post('/journey/start');
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Journey events are being accepted (first: app ready)');
  });
});

describe('a telemetry call that throws', () => {
  it('still gets a JSON answer from every route', async () => {
    fake.state.failing = true;
    const answers = [
      await post('/journey/app-ready'),
      await post('/journey/start'),
      await post('/journey/progress', { journeyId: 'journey-1', progress: 1 }),
      await post('/journey/interaction', { action: 'result_viewed' }),
      await post('/journey/end', { journeyId: 'journey-1', complete: true }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(500);
      expect(answer.body).toEqual({
        error: 'Telemetry failed',
        receipt: { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: 'Not sent: the telemetry call failed.' },
      });
    }
  });

  it('is logged once per event', async () => {
    fake.state.failing = true;
    await post('/journey/start');
    await post('/journey/start');
    await post('/journey/app-ready');
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      'Journey event failed (journey start): Error: The telemetry plugin is unavailable'
    );
  });
});
