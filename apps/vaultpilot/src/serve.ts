/**
 * Tiny read-only JSON service for the UI: `pnpm agent:serve` (default port 8787).
 *
 *   GET /state   a fresh snapshot (read -> decide), DRY RUN always: this process holds no signing
 *                path at all, so nothing it serves can move money.
 *   GET /health  liveness.
 *
 * The Next.js route handler calls this when it is up and falls back to the snapshot file on disk
 * when it is not, so the one screen works either way.
 */
import {createServer} from 'node:http';
import {buildSnapshot, writeSnapshot} from './snapshot.js';
import {envNumber} from './env.js';

const port = envNumber('VAULTPILOT_SERVE_PORT', 8787);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/health') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({ok: true}));
    return;
  }
  if (url.pathname !== '/state') {
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'not found', routes: ['/state', '/health']}));
    return;
  }
  void buildSnapshot({dryRun: true})
    .then((snapshot) => {
      writeSnapshot(snapshot);
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify(snapshot));
    })
    .catch((e: Error) => {
      res.writeHead(500, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    });
});

server.listen(port, () => {
  console.log(`vaultpilot state service on http://127.0.0.1:${port}/state (read-only, dry run)`);
});
