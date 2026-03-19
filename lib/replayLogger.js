/**
 * Replay Logger — Records a JSONL transcript of each game session.
 */

import fs from 'fs';
import path from 'path';

export class ReplayLogger {
  /**
   * @param {string} replaysDir — Absolute path to the replays directory.
   * @param {string} gameId — Identifier for the game being played.
   * @param {string} clientId — Unique identifier for the client session.
   */
  constructor(replaysDir, gameId, clientId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${gameId}_${timestamp}_${clientId}.jsonl`;
    this.filepath = path.join(replaysDir, filename);

    // Ensure the directory exists
    fs.mkdirSync(replaysDir, { recursive: true });

    this._stream = fs.createWriteStream(this.filepath, { flags: 'a' });
    this._writeLine({ type: 'start', ts: new Date().toISOString(), gameId, clientId });
  }

  /**
   * Writes a single JSONL entry.
   * @param {object} entry
   */
  _writeLine(entry) {
    if (this._stream && !this._stream.destroyed) {
      this._stream.write(JSON.stringify(entry) + '\n');
    }
  }

  /**
   * Log an output turn from the interpreter.
   * @param {string} text
   */
  logOutput(text) {
    this._writeLine({ ts: new Date().toISOString(), type: 'output', text });
  }

  /**
   * Log a command from the player/agent.
   * @param {string} text
   */
  logCommand(text) {
    this._writeLine({ ts: new Date().toISOString(), type: 'command', text });
  }

  /**
   * Finalize and close the replay log.
   */
  close() {
    this._writeLine({ ts: new Date().toISOString(), type: 'end' });
    if (this._stream) {
      this._stream.end();
      this._stream = null;
    }
  }
}
