import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { community } from './routes/community';
import { menu } from './routes/menu';
import { scheduler } from './routes/scheduler';
import { telemetryRoutes } from './routes/telemetry';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);

app.route('/api', api);
app.route('/api/community', community);
// Journey telemetry. Removing it means deleting this line, the import and routes/telemetry.ts.
app.route('/api/telemetry', telemetryRoutes);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
