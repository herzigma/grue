/**
 * Grue -- interactive fiction server for AI agents.
 *
 *   node index.js            run the server (config from env / .env, see config.js)
 *   import { startServer }   embed it (the test suite does this on ephemeral ports)
 */

import http from 'http';
import net from 'net';
import { pathToFileURL } from 'url';
import { WebSocketServer } from 'ws';

import defaults from './config.js';
import { GameLibrary } from './lib/gameLibrary.js';
import { SessionManager, ResultStore } from './lib/sessionManager.js';
import { Metrics } from './lib/metrics.js';
import { createHttpHandler, authenticate, VERSION } from './lib/httpApi.js';
import { handleWsJson } from './lib/wsJson.js';
import { createLegacyConnection } from './lib/legacy.js';

const MAX_TCP_LINE = 8192;
const KEEP_ALIVE_TIMEOUT_MS = 65_000;

const LOOPBACK_HOST = /^(?:localhost|::1|\[::1\]|127(?:\.\d{1,3}){3})$/i;

/** Startup warning when the server is reachable beyond this machine without API keys; else null. */
export function exposureWarning(cfg) {
  if (LOOPBACK_HOST.test(cfg.HOST) || cfg.API_KEYS.length) return null;
  return `[Grue] WARNING: listening on ${cfg.HOST} with no GRUE_API_KEYS: anyone who can reach this `
    + 'machine can start sessions and read results. Set GRUE_API_KEYS (comma-separated) before exposing '
    + 'it, or bind HOST=127.0.0.1.';
}

/**
 * Start Grue. Any key of config.js can be overridden in `options`; pass `HTTP_PORT: 0` /
 * `TCP_PORT: 0` for ephemeral ports (`TCP_PORT: null` disables the TCP listener).
 * @returns {Promise<{httpPort: number, tcpPort: number|null, manager: SessionManager, httpServer: http.Server, close: () => Promise<void>}>}
 */
export async function startServer(options = {}) {
  const cfg = { ...defaults, ...options };
  const log = cfg.QUIET ? () => {} : (...a) => console.log(...a);

  const library = new GameLibrary(cfg.GAMES_DIR);
  const metrics = new Metrics();
  const results = new ResultStore(cfg);
  const manager = new SessionManager({ cfg, library, metrics, results });
  const ctx = { cfg, library, manager, metrics, results };

  // -- HTTP + WebSocket ------------------------------------------------------

  const httpServer = http.createServer(createHttpHandler(ctx));
  // Keep idle connections open longer than a client's think time between commands (Node's default
  // of 5 s closes them mid-request for agents that wait ~5 s), and keep headersTimeout above it.
  httpServer.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  httpServer.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 5_000;
  const wsOptions = { noServer: true, maxPayload: 64 * 1024 };
  const wssJson = new WebSocketServer(wsOptions);
  const wssLegacy = new WebSocketServer(wsOptions);

  wssJson.on('connection', (ws, req) => handleWsJson(ws, ctx, req.grueOwner ?? null));
  wssLegacy.on('connection', (ws) => {
    const conn = createLegacyConnection(
      ctx,
      { write: (t) => ws.readyState === ws.OPEN && ws.send(t), close: () => ws.close() },
      'ws',
    );
    ws.on('message', (data) => conn.onLine(data.toString('utf8').replace(/\r?\n$/, '')));
    ws.on('close', () => conn.onClose());
    ws.on('error', () => {});
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reject(400, 'Bad Request'); }
    const p = url.pathname.replace(/\/+$/, '');
    if (p === '/ws/v1') {
      const token = url.searchParams.get('api_key');
      const auth = authenticate(cfg, req.headers, token);
      if (!auth.ok) return reject(401, 'Unauthorized');
      req.grueOwner = auth.owner;
      return wssJson.handleUpgrade(req, socket, head, (ws) => wssJson.emit('connection', ws, req));
    }
    if (cfg.LEGACY_ENABLED) {
      return wssLegacy.handleUpgrade(req, socket, head, (ws) => wssLegacy.emit('connection', ws, req));
    }
    return reject(404, 'Not Found');
  });

  // -- Legacy TCP ------------------------------------------------------------

  const tcpSockets = new Set();
  let tcpServer = null;
  if (cfg.LEGACY_ENABLED && cfg.TCP_PORT !== null) {
    tcpServer = net.createServer((socket) => {
      tcpSockets.add(socket);
      socket.setEncoding('utf8');
      socket.setNoDelay(true);
      const conn = createLegacyConnection(
        ctx,
        { write: (t) => { if (!socket.destroyed) socket.write(t); }, close: () => socket.end() },
        'tcp',
      );
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          conn.onLine(buf.slice(0, nl).replace(/\r$/, ''));
          buf = buf.slice(nl + 1);
        }
        if (buf.length > MAX_TCP_LINE) buf = ''; // runaway line without newline: drop it
      });
      socket.on('error', () => {});
      socket.on('close', () => { tcpSockets.delete(socket); conn.onClose(); });
    });
  }

  const listen = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, cfg.HOST, () => { server.off('error', reject); resolve(server.address().port); });
  });

  const httpPort = await listen(httpServer, cfg.HTTP_PORT);
  let tcpPort = null;
  try {
    if (tcpServer) tcpPort = await listen(tcpServer, cfg.TCP_PORT);
  } catch (err) {
    httpServer.close();
    throw err;
  }

  const warning = exposureWarning(cfg);
  if (warning && !cfg.QUIET) console.warn(warning);

  const games = library.list();
  log(`[Grue] v${VERSION} -- ${games.filter((g) => g.available).length}/${games.length} game(s) available`);
  log(`[Grue] HTTP/WS  http://localhost:${httpPort}  (dashboard, /api, /ws/v1)`);
  if (tcpPort !== null) log(`[Grue] Text     nc localhost ${tcpPort}`);
  if (cfg.API_KEYS.length) log(`[Grue] API auth enabled (${cfg.API_KEYS.length} key(s)); legacy text ${cfg.LEGACY_ENABLED ? 'ENABLED (unauthenticated)' : 'disabled'}`);

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      manager.endAll('aborted'); // kills every interpreter and writes the results
      for (const ws of [...wssJson.clients, ...wssLegacy.clients]) ws.terminate();
      for (const s of tcpSockets) s.destroy();
      await Promise.all([
        new Promise((r) => (tcpServer ? tcpServer.close(() => r()) : r())),
        new Promise((r) => { httpServer.close(() => r()); httpServer.closeAllConnections(); }),
      ]);
    })();
    return closing;
  }

  return { httpPort, tcpPort, manager, ctx, httpServer, close };
}

// -- Run directly --------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer().then((server) => {
    const shutdown = (signal) => {
      console.log(`\n[Grue] ${signal}: ending ${server.manager.active.size} session(s) and shutting down...`);
      server.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }).catch((err) => {
    console.error(`[Grue] Failed to start: ${err.message}`);
    process.exit(1);
  });
}
