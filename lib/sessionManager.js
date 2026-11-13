/**
 * SessionManager -- registry of live GameSessions (limits, lookup, shutdown) and
 * ResultStore -- reader for persisted results and replays.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GameSession, GrueError } from './gameSession.js';
import { readReplay } from './replayLogger.js';

export { GrueError };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_META_BYTES = 4096;
const MAX_FINISHED_KEPT = 200;

export function isSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

export class SessionManager {
  /**
   * @param {{cfg: object, library: import('./gameLibrary.js').GameLibrary, metrics: import('./metrics.js').Metrics, results: ResultStore}} deps
   */
  constructor({ cfg, library, metrics, results }) {
    this.cfg = cfg;
    this.library = library;
    this.metrics = metrics;
    this.results = results;
    /** @type {Map<string, GameSession>} */
    this.active = new Map();
    /** @type {Map<string, GameSession>} recently finished, so late commands get 409 not 404 */
    this.finished = new Map();
  }

  /**
   * Start a new session.
   * @param {{game: string, max_turns?: number, meta?: object}} req
   * @param {string|null} [owner] id of the API key that creates it; only that key can see or touch it
   *   (null when auth is off)
   * @returns {Promise<{session: GameSession, observation: object}>}
   */
  async create(req, owner = null) {
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      throw new GrueError('bad_request', 'Request body must be a JSON object.');
    }
    if (typeof req.game !== 'string' || !req.game) {
      throw new GrueError('bad_request', '"game" (a game id from /api/games) is required.');
    }
    let meta = {};
    if (req.meta !== undefined && req.meta !== null) {
      if (typeof req.meta !== 'object' || Array.isArray(req.meta)) {
        throw new GrueError('bad_request', '"meta" must be a JSON object.');
      }
      if (Buffer.byteLength(JSON.stringify(req.meta)) > MAX_META_BYTES) {
        throw new GrueError('bad_request', `"meta" must be at most ${MAX_META_BYTES} bytes.`);
      }
      meta = req.meta;
    }
    if (req.max_turns !== undefined && req.max_turns !== null
      && (!Number.isInteger(req.max_turns) || req.max_turns < 1 || req.max_turns > 1_000_000)) {
      throw new GrueError('bad_request', '"max_turns" must be a positive integer.');
    }

    const found = this.library.find(req.game);
    if (!found) throw new GrueError('unknown_game', `Unknown game "${req.game}".`, 404);
    if (!found.path) {
      throw new GrueError('game_unavailable', `Game "${req.game}" is in the catalog but its file is not installed (run "npm run setup").`, 409);
    }
    if (this.active.size >= this.cfg.MAX_SESSIONS) {
      throw new GrueError('too_many_sessions', `The server is at its limit of ${this.cfg.MAX_SESSIONS} concurrent sessions.`, 429);
    }

    const id = crypto.randomUUID();
    const session = new GameSession({
      id,
      game: found.game,
      gamePath: found.path,
      meta,
      maxTurns: req.max_turns ?? found.game.suggested_turn_limit ?? this.cfg.DEFAULT_MAX_TURNS,
      cfg: this.cfg,
      metrics: this.metrics,
      onEnd: (result) => this._onEnd(session, result),
    });
    session.owner = owner;
    this.active.set(id, session); // reserve the slot before the (async) interpreter start
    this.metrics.sessionStarted();

    let observation;
    try {
      observation = await session.start();
    } catch (err) {
      this.active.delete(id);
      this.metrics.sessionEnded('crashed');
      throw new GrueError('internal', err.message, 500);
    }
    return { session, observation };
  }

  _onEnd(session, result) {
    this.active.delete(session.id);
    this.finished.set(session.id, session);
    if (this.finished.size > MAX_FINISHED_KEPT) {
      this.finished.delete(this.finished.keys().next().value);
    }
    this.metrics.sessionEnded(result.ending);
    this.results.add(result);
  }

  /**
   * Active or recently finished session. With `owner` set (API keys in use) a session created by a
   * different key is treated as unknown.
   */
  get(id, owner = null) {
    const s = this.active.get(id) || this.finished.get(id) || null;
    return s && (owner === null || s.owner === owner) ? s : null;
  }

  /**
   * Look up a session for a command: 404 if never heard of, 409 if finished.
   * @returns {GameSession}
   */
  getActive(id, owner = null) {
    const s = this.active.get(id);
    if (s && (owner === null || s.owner === owner)) return s;
    if (!s && (this.get(id, owner) || (!this.finished.has(id) && isSessionId(id) && this.results.get(id)))) {
      throw new GrueError('game_over', 'The game has ended; start a new session.', 409);
    }
    throw new GrueError('unknown_session', `Unknown session "${id}".`, 404);
  }

  list(owner = null) {
    return [...this.active.values()]
      .filter((s) => owner === null || s.owner === owner)
      .map((s) => s.summary());
  }

  /** End a session (default: aborted) and return its Result. Idempotent for finished sessions. */
  end(id, owner = null, ending = 'aborted') {
    const s = this.get(id, owner);
    if (s) return s.end(ending);
    const r = !this.active.has(id) && !this.finished.has(id) && isSessionId(id) ? this.results.get(id) : null;
    if (r) return r;
    throw new GrueError('unknown_session', `Unknown session "${id}".`, 404);
  }

  /** Abort everything (server shutdown). */
  endAll(ending = 'aborted') {
    for (const s of [...this.active.values()]) s.end(ending);
  }
}

export class ResultStore {
  /**
   * @param {{RESULTS_DIR: string, REPLAYS_DIR: string}} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.cache = new Map(); // filename -> Result
    this._lastScan = 0;
    // Results from this process arrive via add(); a directory rescan on a miss only matters for files
    // dropped in by someone else, so unknown ids may trigger at most one scan per interval.
    this._missRescanMs = cfg.RESULTS_RESCAN_MS ?? 2000;
  }

  add(result) {
    this.cache.set(`${result.session_id}.json`, result);
  }

  _refresh() {
    this._lastScan = Date.now();
    let names;
    try {
      names = fs.readdirSync(this.cfg.RESULTS_DIR).filter((n) => n.endsWith('.json'));
    } catch { return; }
    const present = new Set(names);
    for (const n of names) {
      if (this.cache.has(n)) continue;
      try {
        this.cache.set(n, JSON.parse(fs.readFileSync(path.join(this.cfg.RESULTS_DIR, n), 'utf8')));
      } catch { /* half-written or foreign file */ }
    }
    for (const n of [...this.cache.keys()]) if (!present.has(n)) this.cache.delete(n);
  }

  /** Newest first. */
  list({ game, limit } = {}) {
    this._refresh();
    let out = [...this.cache.values()];
    if (game) out = out.filter((r) => r.game_id === game);
    out.sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)));
    if (limit) out = out.slice(0, limit);
    return out;
  }

  get(id) {
    if (!isSessionId(id)) return null;
    const name = `${id}.json`;
    if (!this.cache.has(name) && Date.now() - this._lastScan >= this._missRescanMs) this._refresh();
    return this.cache.get(name) || null;
  }

  transcript(id) {
    const result = this.get(id);
    if (!result || !result.transcript) return null;
    const file = path.join(this.cfg.REPLAYS_DIR, path.basename(result.transcript));
    try { return readReplay(file); } catch { return null; }
  }
}
