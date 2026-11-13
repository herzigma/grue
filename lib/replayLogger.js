/**
 * Replay logger: one JSONL transcript per session (PROTOCOL.md section 8).
 * Writes are synchronous appends so nothing is lost on abrupt shutdown.
 */

import fs from 'fs';
import path from 'path';

export class ReplayLogger {
  /**
   * @param {string} replaysDir
   * @param {string} gameId
   * @param {string} sessionId
   * @param {object} meta client-supplied metadata
   */
  constructor(replaysDir, gameId, sessionId, meta = {}) {
    fs.mkdirSync(replaysDir, { recursive: true });
    this.sessionId = sessionId;
    this.gameId = gameId;
    this.filename = `${gameId}_${sessionId}.jsonl`;
    this.filepath = path.join(replaysDir, this.filename);
    this._write({ type: 'start', session_id: sessionId, game_id: gameId, meta });
  }

  _write(entry) {
    try {
      fs.appendFileSync(this.filepath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    } catch (err) {
      console.error(`[Replay] Cannot write ${this.filepath}: ${err.message}`);
    }
  }

  logOutput(turn, text, statusLine, score) {
    this._write({ type: 'output', turn, text, status_line: statusLine ?? null, score: score ?? null });
  }

  logCommand(turn, text) {
    this._write({ type: 'command', turn, text });
  }

  logEnd(ending, score, turn) {
    this._write({ type: 'end', ending, score: score ?? null, turn });
  }
}

/** Read a replay file back into entries (skips unparseable lines). */
export function readReplay(filepath) {
  const entries = [];
  for (const line of fs.readFileSync(filepath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return entries;
}
