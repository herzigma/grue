/**
 * Native session: runs a game written for Grue's built-in engine (lib/native) behind the same
 * interface as InterpreterSession (start / send / kill, resolving to a Turn), so GameSession,
 * scoring, endings, replays and every transport work unchanged.
 *
 * The engine runs in-process and synchronously, so there is no child process to manage.
 */

import { EventEmitter } from 'events';
import { loadNativeGame } from './native/index.js';
import { sanitizeLineCommand } from './interpreterSession.js';

const MAX_LINE = 256;

export class NativeSession extends EventEmitter {
  /** @param {string} gamePath absolute path to the game module (.js) */
  constructor(gamePath) {
    super();
    this.gamePath = gamePath;
    this.game = null;
    this.alive = false;
    this.inputType = null;
  }

  async start() {
    this.game = await loadNativeGame(this.gamePath);
    this.alive = true;
    return this._turn(this.game.start());
  }

  async send(command) {
    if (!this.alive) {
      return {
        text: '', statusLine: null, gridText: '', inputType: null, exited: true,
        crashed: false, timedOut: false, commandSent: false, notice: 'The game is not running.',
      };
    }
    let value = sanitizeLineCommand(command);
    let notice = null;
    if (value.length > MAX_LINE) {
      value = value.slice(0, MAX_LINE);
      notice = `Command truncated to ${MAX_LINE} characters.`;
    }
    let obs;
    try {
      obs = this.game.send(value);
    } catch (err) {
      // The engine is designed never to throw; treat it like an interpreter crash if it does.
      this.kill();
      return {
        text: `[Engine error: ${err.message}]`, statusLine: null, gridText: '', inputType: null,
        exited: true, crashed: true, timedOut: false, commandSent: true, notice,
      };
    }
    const turn = this._turn(obs);
    turn.notice = notice;
    return turn;
  }

  kill() {
    if (this.alive) {
      this.alive = false;
      this.emit('exit');
    }
  }

  _turn(obs) {
    const ended = !!obs.ended;
    if (ended) this.kill();
    this.inputType = ended ? null : (obs.inputType || 'line');
    return {
      text: (obs.text || '').replace(/\s+$/, ''),
      statusLine: obs.statusLine ? obs.statusLine.trim() : null,
      gridText: obs.statusLine || '',
      inputType: this.inputType,
      exited: ended,
      crashed: false,
      timedOut: false,
      commandSent: true,
      notice: null,
    };
  }
}
