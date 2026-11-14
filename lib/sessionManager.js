/**
 * SessionManager -- registry of live GameSessions (limits, lookup, shutdown) and
 * ResultStore -- reader for persisted results and replays.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GameSession, GrueError } from './gameSession.js';
import { readReplay } from './replayLogger.js';
import { UrlGames } from './urlGames.js';

export { GrueError };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_META_BYTES = 4096;
const MAX_FINISHED_KEPT = 200;
const MAX_REPORT_BYTES = 4096;
const MAX_REPORT_STRING = 200;

export function isSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** The body of POST /api/sessions/:id/report: at most 4096 bytes, a flat object of scalars. */
export function validateClientReport(body) {
  const bad = (m) => new GrueError('bad_request', m);
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_REPORT_BYTES) {
    throw bad(`The request body must be at most ${MAX_REPORT_BYTES} bytes.`);
  }
  const report = body?.client_report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw bad('"client_report" (a JSON object) is required.');
  }
  for (const [k, v] of Object.entries(report)) {
    const ok = v === null || typeof v === 'boolean' || typeof v === 'number'
      || (typeof v === 'string' && v.length <= MAX_REPORT_STRING);
    if (!ok) {
      throw bad(`"client_report.${k}" must be a number, boolean, null or a string of at most ${MAX_REPORT_STRING} characters.`);
    }
  }
  return report;
}

export class SessionManager {
  /**
   * @param {{cfg: object, library: import('./gameLibrary.js').GameLibrary, metrics: import('./metrics.js').Metrics, results: ResultStore}} deps
   */
  constructor({ cfg, library, metrics, results, urlGames = new UrlGames(cfg) }) {
    this.cfg = cfg;
    this.library = library;
    this.urlGames = urlGames;
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
    const byUrl = req.game_url !== undefined && req.game_url !== null;
    if (byUrl === (req.game !== undefined && req.game !== null)) {
      throw new GrueError('bad_request', 'Send either "game" (a game id from /api/games) or "game_url" (a story file URL).');
    }
    if (!byUrl && (typeof req.game !== 'string' || !req.game)) {
      throw new GrueError('bad_request', '"game" (a game id from /api/games) is required.');
    }
    if (!byUrl && req.sha256 !== undefined) {
      throw new GrueError('bad_request', '"sha256" goes with "game_url".');
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

    const full = () => new GrueError('too_many_sessions', `The server is at its limit of ${this.cfg.MAX_SESSIONS} concurrent sessions.`, 429);
    let found;
    if (byUrl) {
      if (this.active.size >= this.cfg.MAX_SESSIONS) throw full(); // before downloading anything
      found = await this.urlGames.prepare(req.game_url, req.sha256);
    } else {
      found = this.library.find(req.game);
      if (!found) throw new GrueError('unknown_game', `Unknown game "${req.game}".`, 404);
      if (!found.path) {
        throw new GrueError('game_unavailable', `Game "${req.game}" is in the catalog but its file is not installed (run "npm run setup").`, 409);
      }
      if (!found.game.available) {
        throw new GrueError('game_unavailable', `Game "${req.game}" is a sealed held-out game and this server has no GRUE_GAMES_KEY.`, 409);
      }
    }
    if (this.active.size >= this.cfg.MAX_SESSIONS) {
      found.cleanup?.();
      throw full();
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
      onEnd: (result) => { found.cleanup?.(); this._onEnd(session, result); },
    });
    session.owner = owner;
    session.workDir = found.dir ?? null; // URL games: the throwaway directory the story runs in
    this.active.set(id, session); // reserve the slot before the (async) interpreter start
    this.metrics.sessionStarted();

    let observation;
    try {
      observation = await session.start();
    } catch (err) {
      this.active.delete(id);
      found.cleanup?.();
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

  /**
   * Attach the client's own run statistics to a finished session's Result (POST /api/sessions/:id/report).
   * The Result is found through the in-memory finished sessions, so the usual owner scoping applies
   * (another key's session is "unknown"). A session that has dropped out of memory (after a restart, or
   * beyond the last 200 finished) is also unknown. Featured results are read-only.
   * @param {object} body  the request body: {"client_report": {...}}
   * @returns {object} the updated Result
   */
  report(id, owner, body) {
    if (this.results.featured.has(id)) {
      throw new GrueError('read_only', 'Featured results are read-only.', 409);
    }
    const s = this.get(id, owner);
    if (!s) throw new GrueError('unknown_session', `Unknown session "${id}".`, 404);
    if (!s.gameOver) throw new GrueError('session_active', 'The session has not finished; report after it ends.', 409);
    if (s.result.client_report !== undefined) {
      throw new GrueError('already_reported', 'This session already has a client report.', 409);
    }
    return this.results.attachReport(s.result, validateClientReport(body));
  }

  /** Abort everything (server shutdown). */
  endAll(ending = 'aborted') {
    for (const s of [...this.active.values()]) s.end(ending);
  }
}

/**
 * Load bundled, read-only result collections: <dir>/<collection>/results/*.json and replays/*.jsonl.
 * Each result is tagged with `collection` (the folder name) so clients can badge or filter it.
 */
function loadFeatured(dir) {
  const out = new Map();
  if (!dir) return out;
  let collections;
  try { collections = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const c of collections) {
    const resultsDir = path.join(dir, c.name, 'results');
    let names;
    try { names = fs.readdirSync(resultsDir).filter((n) => n.endsWith('.json')); } catch { continue; }
    for (const n of names) {
      try {
        const result = JSON.parse(fs.readFileSync(path.join(resultsDir, n), 'utf8'));
        if (!isSessionId(result.session_id)) continue;
        result.collection = c.name;
        out.set(result.session_id, { result, replaysDir: path.join(dir, c.name, 'replays') });
      } catch { /* skip unreadable file */ }
    }
  }
  return out;
}

/**
 * True for sessions that exercised the harness rather than a model: Brass Lantern's mock: (scripted
 * walkthrough) and human: providers, and ad-hoc probes. They stay fetchable by id but are not listed.
 */
export function isHarnessRun(result) {
  const meta = result?.meta || {};
  const model = typeof meta.model === 'string' ? meta.model : '';
  return model.startsWith('mock:') || model.startsWith('human:') || meta.agent === 'probe';
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
    this.featured = loadFeatured(cfg.FEATURED_DIR); // session_id -> {result, replaysDir}; read-only
  }

  add(result) {
    this.cache.set(`${result.session_id}.json`, result);
  }

  /**
   * Add a client report to a finished Result and persist it (tmp + rename, like GameSession). The Result
   * object is updated in place, so the session, the cache and the file agree; on a write error nothing changes.
   */
  attachReport(result, clientReport) {
    const patch = { client_report: clientReport, client_report_at: new Date().toISOString() };
    try {
      fs.mkdirSync(this.cfg.RESULTS_DIR, { recursive: true });
      const file = path.join(this.cfg.RESULTS_DIR, `${result.session_id}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...result, ...patch }, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`[Session ${result.session_id}] Cannot write client report: ${err.message}`);
      throw new GrueError('internal', 'Could not store the report.', 500);
    }
    Object.assign(result, patch);
    this.add(result);
    return result;
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

  /**
   * Newest first. Harness test runs (see isHarnessRun) are left out unless includeTests is set, and unranked
   * runs (games loaded from a URL) unless includeUnranked is set.
   */
  list({ game, limit, includeTests = false, includeUnranked = false } = {}) {
    this._refresh();
    const ids = new Set();
    let out = [];
    for (const r of this.cache.values()) { ids.add(r.session_id); out.push(r); }
    for (const { result } of this.featured.values()) if (!ids.has(result.session_id)) out.push(result);
    if (!includeTests) out = out.filter((r) => !isHarnessRun(r));
    if (!includeUnranked) out = out.filter((r) => !r.unranked);
    if (game) out = out.filter((r) => r.game_id === game);
    out.sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)));
    if (limit) out = out.slice(0, limit);
    return out;
  }

  get(id) {
    if (!isSessionId(id)) return null;
    if (this.featured.has(id)) return this.featured.get(id).result;
    const name = `${id}.json`;
    if (!this.cache.has(name) && Date.now() - this._lastScan >= this._missRescanMs) this._refresh();
    return this.cache.get(name) || null;
  }

  transcript(id) {
    const result = this.get(id);
    if (!result || !result.transcript) return null;
    const dir = this.featured.get(id)?.replaysDir ?? this.cfg.REPLAYS_DIR;
    const file = path.join(dir, path.basename(result.transcript));
    try { return readReplay(file); } catch { return null; }
  }
}
