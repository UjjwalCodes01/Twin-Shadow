import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import type { PuzzleResponse } from '../../shared/api';
import { todayResponse } from '../core/puzzle';

// Mounted at /api in index.ts, so every route here starts with /api/.
export const api = new Hono();

api.get('/puzzle/today', (c) => c.json<PuzzleResponse>(todayResponse(context.subredditName)));
