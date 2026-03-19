/**
 * Session Manager — Manages the lifecycle of all active game sessions.
 *
 * Handles creation, idle timeouts, and teardown of InterpreterSessions.
 */

import path from 'path';
import { InterpreterSession } from './interpreterSession.js';
import { ReplayLogger } from './replayLogger.js';
import config from '../config.js';

export class SessionManager {
  /**
   * @param {import('./metrics.js').Metrics} metrics
   */
  constructor(metrics) {
    /** @type {Map<string, SessionEntry>} */
    this.sessions = new Map();
    this.metrics = metrics;
  }

  /**
   * Creates a new game session for a client.
   * @param {string} clientId
   * @param {{ id: number, name: string, filename: string, path: string }} game
   * @returns {InterpreterSession}
   */
  createSession(clientId, game) {
    if (this.sessions.has(clientId)) {
      this.destroySession(clientId);
    }

    const interpreter = new InterpreterSession(game.path);
    const replay = new ReplayLogger(config.REPLAYS_DIR, String(game.id), clientId);

    const entry = {
      interpreter,
      replay,
      game,
      turnNumber: 0,
      idleTimer: null,
    };

    this.sessions.set(clientId, entry);
    this.metrics.sessionStarted();

    // Start the idle timeout
    this._resetIdleTimer(clientId);

    return interpreter;
  }

  /**
   * Resets the idle timeout for a session. Call on each command.
   * @param {string} clientId
   */
  _resetIdleTimer(clientId) {
    const entry = this.sessions.get(clientId);
    if (!entry) return;

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    entry.idleTimer = setTimeout(() => {
      this._handleIdleTimeout(clientId);
    }, config.IDLE_TIMEOUT_MS);
  }

  /**
   * Handles an idle timeout — auto-saves and then destroys the session.
   * @param {string} clientId
   */
  _handleIdleTimeout(clientId) {
    const entry = this.sessions.get(clientId);
    if (!entry) return;

    console.log(`[SessionManager] Idle timeout for client ${clientId}. Auto-saving...`);

    const savePath = path.join(
      config.SAVES_DIR,
      `autosave_${entry.game.id}_${clientId}.sav`
    );

    entry.interpreter.save(savePath);

    // Give the save command a moment to process, then destroy
    setTimeout(() => {
      this.destroySession(clientId);
    }, 2000);
  }

  /**
   * Records a command from the client and resets the idle timer.
   * @param {string} clientId
   * @param {string} command
   */
  recordCommand(clientId, command) {
    const entry = this.sessions.get(clientId);
    if (!entry) return;

    this._resetIdleTimer(clientId);
    entry.replay.logCommand(command);
    this.metrics.commandReceived();

    if (this.metrics.isLikelyInvalid(command, config.MAX_COMMAND_LENGTH)) {
      this.metrics.commandInvalid();
    }
  }

  /**
   * Records an output turn from the interpreter.
   * @param {string} clientId
   * @param {string} text
   * @returns {number} The new turn number.
   */
  recordOutput(clientId, text) {
    const entry = this.sessions.get(clientId);
    if (!entry) return 0;

    entry.turnNumber++;
    entry.replay.logOutput(text);
    return entry.turnNumber;
  }

  /**
   * Gets the current turn number for a session.
   * @param {string} clientId
   * @returns {number}
   */
  getTurnNumber(clientId) {
    const entry = this.sessions.get(clientId);
    return entry ? entry.turnNumber : 0;
  }

  /**
   * Destroys a session, cleaning up all resources.
   * @param {string} clientId
   */
  destroySession(clientId) {
    const entry = this.sessions.get(clientId);
    if (!entry) return;

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    entry.interpreter.destroy();
    entry.replay.close();

    this.sessions.delete(clientId);
    this.metrics.sessionEnded();

    console.log(`[SessionManager] Session destroyed for client ${clientId}`);
  }

  /**
   * Destroys all active sessions (for graceful shutdown).
   */
  destroyAll() {
    for (const clientId of this.sessions.keys()) {
      this.destroySession(clientId);
    }
  }
}
