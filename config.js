/**
 * Grue -- centralized configuration.
 * Every value can be overridden with an environment variable (or a .env file in
 * the project root). startServer(options) can override any of them again.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the project root if present (Node >= 20.12). Real env vars win.
try {
  const envFile = path.join(ROOT, '.env');
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
} catch { /* a malformed .env must not stop the server */ }

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

const apiKeys = str('GRUE_API_KEYS', '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

const config = {
  /** Bind address for all listeners. */
  HOST: str('HOST', '0.0.0.0'),

  /** HTTP port: REST API, dashboard, WebSocket JSON (/ws/v1) and legacy WS. WS_PORT is the old name. */
  HTTP_PORT: int('HTTP_PORT', int('WS_PORT', 8081)),

  /** Legacy raw-text TCP port (use `nc`). */
  TCP_PORT: int('TCP_PORT', 8080),

  /** Serve the legacy text interface (TCP + WS on paths other than /ws/v1). Off by default when API keys are set. */
  LEGACY_ENABLED: str('LEGACY_ENABLED', apiKeys.length ? 'false' : 'true') !== 'false',

  /** Bearer keys for /api/* and /ws/v1. Empty = no auth. */
  API_KEYS: apiKeys,

  /** Directories. */
  GAMES_DIR: str('GAMES_DIR', path.join(ROOT, 'games')),
  REPLAYS_DIR: str('REPLAYS_DIR', path.join(ROOT, 'replays')),
  RESULTS_DIR: str('RESULTS_DIR', path.join(ROOT, 'results')),
  PUBLIC_DIR: path.join(ROOT, 'public'),

  /** Max concurrent sessions; beyond this POST /api/sessions returns 429. */
  MAX_SESSIONS: int('MAX_SESSIONS', 16),

  /** End a session (ending "timeout") after this long with no command. */
  IDLE_TIMEOUT_MS: int('IDLE_TIMEOUT_MS', 600_000),

  /** How long to wait for the game to ask for input again after a command. */
  COMMAND_TIMEOUT_MS: int('COMMAND_TIMEOUT_MS', 10_000),

  /** How long to wait for the interpreter to print its first screen. */
  START_TIMEOUT_MS: int('START_TIMEOUT_MS', 20_000),

  /** Turn limit when neither the request nor the catalog gives one. */
  DEFAULT_MAX_TURNS: int('DEFAULT_MAX_TURNS', 1000),

  /** Longest command accepted (characters). */
  MAX_COMMAND_LENGTH: int('MAX_COMMAND_LENGTH', 256),

  /** Quiet logging (tests). */
  QUIET: str('GRUE_QUIET', 'false') === 'true',
};

export default config;
