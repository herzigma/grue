/**
 * GameSession -- one client playing one game.
 *
 * Wraps an InterpreterSession and adds everything the protocol promises on top of raw
 * interpreter output: Observations, parsed score/location, invalid-command and unique-location
 * tracking, ending detection, turn limit, idle timeout, replay log and the final Result.
 */

import fs from 'fs';
import path from 'path';
import { InterpreterSession } from './interpreterSession.js';
import { NativeSession } from './nativeSession.js';
import { ReplayLogger } from './replayLogger.js';
import {
  parseStatusLine, parseScoreFromText, detectEndingBanner, findBanner,
  classifyBanner, isInvalidCommandResponse, isQuitCommand,
} from './parse.js';

export class GrueError extends Error {
  /**
   * @param {string} code    machine-readable error code (PROTOCOL.md section 4)
   * @param {string} message human text
   * @param {number} status  HTTP status
   */
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class GameSession {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {object} o.game        catalog object
   * @param {string} o.gamePath
   * @param {object} o.meta
   * @param {number} o.maxTurns
   * @param {object} o.cfg
   * @param {import('./metrics.js').Metrics} o.metrics
   * @param {(result: object) => void} o.onEnd  called once, after the Result is persisted
   * @param {object} [o.interpreter]  replacement for the real interpreter (tests)
   */
  constructor({ id, game, gamePath, meta, maxTurns, cfg, metrics, onEnd, interpreter }) {
    this.id = id;
    this.game = game;
    this.meta = meta;
    this.maxTurns = maxTurns;
    this.cfg = cfg;
    this.metrics = metrics;
    this.onEnd = onEnd;

    this.interpreter = interpreter ?? (game.format === 'native'
      ? new NativeSession(gamePath)
      : new InterpreterSession(gamePath, {
        commandTimeoutMs: cfg.COMMAND_TIMEOUT_MS,
        startTimeoutMs: cfg.START_TIMEOUT_MS,
      }));
    this.replay = null;

    this.startedAt = new Date();
    this.endedAt = null;
    this.turn = 0;
    this.score = null;
    this.maxScoreReached = null;
    this.parsedMaxScore = null;
    this.location = null;
    this.moves = null;
    this.invalidCommands = 0;
    this.locations = new Set();
    this.ending = null;
    this.result = null;
    this.lastObservation = null;
    this._recentCommands = [];
    this._queue = Promise.resolve();
    this._idleTimer = null;
    this._endListeners = [];
  }

  /** Register a callback fired once when the session ends for any reason. */
  onEnded(fn) {
    if (this.gameOver) fn(this.result);
    else this._endListeners.push(fn);
  }

  get gameOver() {
    return this.ending !== null;
  }

  get maxScore() {
    return this.game.max_score ?? this.parsedMaxScore;
  }

  /** Spawn the interpreter and return the turn-0 Observation. */
  async start() {
    this.replay = new ReplayLogger(this.cfg.REPLAYS_DIR, this.game.id, this.id, this.meta);
    let turn;
    try {
      turn = await this.interpreter.start();
    } catch (err) {
      this.interpreter.kill();
      this._cancelIdle();
      this.replay.logEnd("crashed", null, 0);
      throw err;
    }
    this._resetIdle();
    return this._observe(turn, null);
  }

  /**
   * Run one command. Commands on the same session are processed strictly in order.
   * @returns {Promise<object>} Observation
   */
  command(command) {
    const run = () => this._command(command);
    const p = this._queue.then(run, run);
    this._queue = p.catch(() => {});
    return p;
  }

  async _command(command) {
    if (this.gameOver) throw new GrueError('game_over', 'The game has ended; start a new session.', 409);
    this._resetIdle();
    const sent = String(command ?? '');
    this.replay.logCommand(this.turn + 1, sent);
    const turn = await this.interpreter.send(sent);
    if (this.gameOver) return this.lastObservation; // ended (abort/timeout) while we were waiting
    this._resetIdle();
    if (turn.commandSent) {
      this.turn++;
      this._recentCommands.push(sent);
      if (this._recentCommands.length > 2) this._recentCommands.shift();
    }
    return this._observe(turn, turn.commandSent ? sent : null);
  }

  /** Turn an interpreter Turn into an Observation, updating session state. */
  _observe(turn, command) {
    let own = turn.text; // this command's output; `late` is output of an earlier command that timed out
    const late = turn.lateText || '';
    const char = turn.inputType === 'char';
    if (char && turn.gridText && turn.gridText.split('\n').length >= 2) {
      own = own ? `${own}\n\n${turn.gridText}` : turn.gridText; // menus drawn in the status window
    }
    let text = own;
    if (late) {
      text = `[Late output from the previous command, which timed out:]\n${late}`
        + (own ? `\n\n[Response to this command:]\n${own}` : '');
      this._applyScore(null, late); // the status line (below) still wins; this keeps text-only deltas
    }

    if (!char) {
      const st = parseStatusLine(turn.statusLine);
      if (st.location) this.location = st.location;
      if (st.moves !== null) this.moves = st.moves;
      if (st.max_score !== null && this.parsedMaxScore === null) this.parsedMaxScore = st.max_score;
      this._applyScore(st.score, own);
    } else {
      this._applyScore(null, own);
    }
    if (this.location) this.locations.add(this.location);

    const invalid = command !== null && !char && isInvalidCommandResponse(own);
    if (command !== null) {
      if (invalid) this.invalidCommands++;
      this.metrics.command(invalid);
    }

    this.replay.logOutput(this.turn, text, turn.statusLine, this.score);

    const ending = this._detectEnding(turn, own, late, text);
    const obs = this._buildObservation(text, turn, ending);
    this.lastObservation = obs;
    if (ending) this._finish(ending);
    return obs;
  }

  _applyScore(statusScore, text) {
    const ts = parseScoreFromText(text);
    if (ts && ts.max_score !== undefined && this.parsedMaxScore === null) this.parsedMaxScore = ts.max_score;
    if (statusScore !== null) this.score = statusScore;
    else if (ts && ts.score !== undefined) this.score = ts.score;
    else if (ts && ts.delta !== undefined) this.score = (this.score ?? 0) + ts.delta;
    if (this.score !== null && (this.maxScoreReached === null || this.score > this.maxScoreReached)) {
      this.maxScoreReached = this.score;
    }
  }

  /** `own`: this command's text; `late`: text of an earlier timed-out command; `all`: both as shown. */
  _detectEnding(turn, own, late, all) {
    if (turn.crashed) return 'crashed';
    if (turn.exited) {
      if (this._recentCommands.some(isQuitCommand)) return 'quit';
      const banner = findBanner(all);
      if (banner) return classifyBanner(banner, this.score, this.maxScore);
      if (this.maxScore && this.score !== null && this.score >= this.maxScore) return 'won';
      return 'ended';
    }
    // Late text is checked on its own: its banner is not at the end of the combined text.
    const ctx = { score: this.score, max_score: this.maxScore };
    const banner = (late && detectEndingBanner(late, ctx)) || detectEndingBanner(own, ctx);
    if (banner) return banner.ending;
    if (this.turn >= this.maxTurns) return 'turn_limit';
    return null;
  }

  _buildObservation(text, turn, ending) {
    const over = ending !== null;
    return {
      session_id: this.id,
      game_id: this.game.id,
      turn: this.turn,
      text,
      status_line: turn.statusLine,
      location: this.location,
      score: this.score,
      max_score: this.maxScore,
      moves: this.moves,
      input_type: over ? null : turn.inputType,
      game_over: over,
      ending,
      notice: turn.notice,
    };
  }

  /** Summary shared by GET /api/sessions and the Result. */
  summary() {
    return {
      session_id: this.id,
      game_id: this.game.id,
      started_at: this.startedAt.toISOString(),
      turn: this.turn,
      max_turns: this.maxTurns,
      score: this.score,
      max_score: this.maxScore,
      game_over: this.gameOver,
      ending: this.ending,
      meta: this.meta,
    };
  }

  /**
   * End the session (idempotent) and return the persisted Result.
   * @param {string} ending
   */
  end(ending = 'aborted') {
    if (!this.gameOver) {
      // Make an in-flight command return a proper game-over Observation.
      const base = this.lastObservation || { session_id: this.id, game_id: this.game.id, text: '' };
      this.lastObservation = {
        ...base, text: '', turn: this.turn, input_type: null, game_over: true, ending, notice: null,
        location: this.location, score: this.score, max_score: this.maxScore, moves: this.moves,
      };
      this._finish(ending);
    }
    return this.result;
  }

  _finish(ending) {
    if (this.gameOver) return;
    this.ending = ending;
    this.endedAt = new Date();
    this._cancelIdle();
    this.interpreter.kill();
    this.replay?.logEnd(ending, this.score, this.turn);

    this.result = {
      ...this.summary(),
      ended_at: this.endedAt.toISOString(),
      duration_ms: this.endedAt - this.startedAt,
      invalid_commands: this.invalidCommands,
      unique_locations: this.locations.size,
      max_score_reached: this.maxScoreReached,
      transcript: this.replay ? `replays/${this.replay.filename}` : null,
    };
    try {
      fs.mkdirSync(this.cfg.RESULTS_DIR, { recursive: true });
      const file = path.join(this.cfg.RESULTS_DIR, `${this.id}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.result, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`[Session ${this.id}] Cannot write result: ${err.message}`);
    }
    try { this.onEnd?.(this.result); } catch (err) { console.error(err); }
    for (const fn of this._endListeners) {
      try { fn(this.result); } catch (err) { console.error(err); }
    }
  }

  _resetIdle() {
    this._cancelIdle();
    if (this.gameOver) return;
    this._idleTimer = setTimeout(() => this.end('timeout'), this.cfg.IDLE_TIMEOUT_MS);
    this._idleTimer.unref?.();
  }

  _cancelIdle() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }
}
