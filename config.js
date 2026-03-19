/**
 * Grue — Centralized configuration.
 * All values can be overridden via environment variables.
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  /** TCP server port */
  TCP_PORT: parseInt(process.env.TCP_PORT, 10) || 8080,

  /** WebSocket server port */
  WS_PORT: parseInt(process.env.WS_PORT, 10) || 8081,

  /** Directory containing .ulx / .gblorb game files */
  GAMES_DIR: process.env.GAMES_DIR || path.join(__dirname, 'games'),

  /** Directory for session replay logs */
  REPLAYS_DIR: process.env.REPLAYS_DIR || path.join(__dirname, 'replays'),

  /** Directory for auto-saved game states */
  SAVES_DIR: process.env.SAVES_DIR || path.join(__dirname, 'saves'),

  /** Directory containing Nunjucks templates for Easy Mode */
  TEMPLATES_DIR: process.env.TEMPLATES_DIR || path.join(__dirname, 'templates'),

  /** Idle timeout in milliseconds before auto-save & kill (default: 5 min) */
  IDLE_TIMEOUT_MS: parseInt(process.env.IDLE_TIMEOUT_MS, 10) || 300_000,

  /** Command to spawn the interpreter */
  INTERPRETER_CMD: process.platform === 'win32' ? 'npx.cmd' : 'npx',
  INTERPRETER_ARGS: ['emglken'],

  /** Default difficulty mode: 'hard' or 'easy' */
  DEFAULT_MODE: process.env.DEFAULT_MODE || 'hard',

  /** Regex pattern used to detect the interpreter's input prompt */
  PROMPT_PATTERN: />\s*$/,

  /** Debounce time (ms) — wait for output to settle before flushing */
  OUTPUT_DEBOUNCE_MS: parseInt(process.env.OUTPUT_DEBOUNCE_MS, 10) || 200,

  /** Metrics logging interval (ms) */
  METRICS_INTERVAL_MS: parseInt(process.env.METRICS_INTERVAL_MS, 10) || 60_000,

  /** Max command length before flagging as invalid/hallucination */
  MAX_COMMAND_LENGTH: parseInt(process.env.MAX_COMMAND_LENGTH, 10) || 100,
};

export default config;
