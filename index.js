/**
 * Grue — Interactive Fiction Server for AI Agents
 *
 * Entry point. Loads config, scans the game library, and starts
 * both TCP and WebSocket servers.
 */

import net from 'net';
import http from 'http';
import { WebSocketServer } from 'ws';

import config from './config.js';
import { scanGameLibrary, formatGameList } from './lib/gameLibrary.js';
import { SessionManager } from './lib/sessionManager.js';
import { Metrics } from './lib/metrics.js';
import { handleTcpConnection } from './lib/tcpHandler.js';
import { handleWsConnection } from './lib/wsHandler.js';
import { initTemplates } from './lib/easyMode.js';

// ── Startup ──

console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║          G R U E   S E R V E R       ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');

// Initialize template engine
initTemplates();

// Scan game library
const games = scanGameLibrary(config.GAMES_DIR);
if (games.length === 0) {
  console.warn('[Startup] No games found. Add .ulx or .gblorb files to the games/ directory.');
}
console.log(formatGameList(games));

// Create shared services
const metrics = new Metrics();
const sessionManager = new SessionManager(metrics);
const ctx = { games, sessionManager, metrics };

// ── TCP Server ──

const tcpServer = net.createServer((socket) => {
  handleTcpConnection(socket, ctx);
});

tcpServer.listen(config.TCP_PORT, () => {
  console.log(`[TCP] Listening on port ${config.TCP_PORT}`);
  console.log(`[TCP] Connect with: nc localhost ${config.TCP_PORT}`);
});

// ── WebSocket Server ──

const httpServer = http.createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeSessions: metrics.activeSessions }));
    return;
  }

  // Metrics endpoint
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics.getReport());
    return;
  }

  res.writeHead(404);
  res.end('Not found. Connect via WebSocket or use /health or /metrics.');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  handleWsConnection(ws, ctx);
});

httpServer.listen(config.WS_PORT, () => {
  console.log(`[WS]  Listening on port ${config.WS_PORT}`);
  console.log(`[WS]  Health check: http://localhost:${config.WS_PORT}/health`);
  console.log(`[WS]  Metrics:      http://localhost:${config.WS_PORT}/metrics`);
});

// ── Metrics logging ──

setInterval(() => {
  if (metrics.activeSessions > 0) {
    console.log(metrics.getReport());
  }
}, config.METRICS_INTERVAL_MS);

// ── Graceful shutdown ──

function shutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}. Cleaning up...`);
  sessionManager.destroyAll();
  tcpServer.close();
  httpServer.close();
  wss.close();
  console.log('[Shutdown] Done.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('');
console.log('[Startup] Grue is ready. Waiting for connections...');
console.log(`[Startup] Interpreter: ${config.INTERPRETER_BIN}`);
console.log(`[Startup] Idle timeout: ${config.IDLE_TIMEOUT_MS / 1000}s`);
console.log(`[Startup] Default mode: ${config.DEFAULT_MODE}`);
console.log('');
