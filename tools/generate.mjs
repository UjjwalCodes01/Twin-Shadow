// Runs the puzzle generator (src/generator/cli.ts). Vite is already a
// dependency, so it does the TypeScript loading: no extra runner is needed.
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { main } = await server.ssrLoadModule('/src/generator/cli.ts');
  main();
} finally {
  await server.close();
}
