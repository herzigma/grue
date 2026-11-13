/**
 * InterpreterSession -- drives one game through emglken's RemGlk JSON mode.
 *
 * Protocol (stdin/stdout, one JSON object per line):
 *   -> {"type":"init","gen":0,"metrics":{...},"support":[]}
 *   <- {"type":"update","gen":N,"content":[...],"input":[...],"windows":[...]}
 *   -> {"type":"line"|"char","gen":N,"window":ID,"value":"..."}
 * A "turn" ends when an update requests input again (or asks us to exit).
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const EMGLKEN_BIN = path.join(path.dirname(require.resolve('emglken/package.json')), 'bin', 'emglken.js');

// Kill every live interpreter if the server process dies without a clean shutdown.
const liveChildren = new Set();
process.on('exit', () => {
  for (const child of liveChildren) {
    try { child.kill(); } catch { /* already gone */ }
  }
});

/** Keys accepted in char-input mode (RemGlk key names), keyed by lower-case alias. */
const KEY_ALIASES = {
  return: 'return', enter: 'return',
  space: ' ',
  escape: 'escape', esc: 'escape',
  up: 'up', down: 'down', left: 'left', right: 'right',
  pageup: 'pageup', pgup: 'pageup', pagedown: 'pagedown', pgdn: 'pagedown',
  tab: 'tab', backspace: 'delete', delete: 'delete', del: 'delete',
  home: 'home', end: 'end',
};

/**
 * Map a client command to a single RemGlk keypress (PROTOCOL.md section 4, char-input mode).
 * @returns {{value: string, notice: string|null}}
 */
export function mapCharInput(command) {
  const raw = String(command ?? '');
  const trimmed = raw.trim();
  if (trimmed === '') return { value: 'return', notice: 'Game expects a single keypress; sent return.' };
  const alias = KEY_ALIASES[trimmed.replace(/^\\/, '').toLowerCase()];
  if (alias && (trimmed.length > 1 || alias === ' ')) {
    return { value: alias, notice: null };
  }
  const first = Array.from(raw.trim())[0];
  const notice = Array.from(trimmed).length > 1
    ? `Game expects a single keypress; sent '${first}'.`
    : null;
  return { value: first, notice };
}

/** Flatten a free-form command into one clean line (no newlines/control characters). */
export function sanitizeLineCommand(command) {
  return String(command ?? '')
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text of a RemGlk run array. Runs are {style,text} objects (or legacy "style", "text" pairs). */
function runsText(runs, skipInput = true) {
  let out = '';
  if (!Array.isArray(runs)) return out;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (typeof run === 'string') {
      i++;
      if (!(skipInput && run === 'input')) out += String(runs[i] ?? '');
    } else if (run && typeof run.text === 'string') {
      if (!(skipInput && run.style === 'input')) out += run.text;
    }
  }
  return out;
}

function asciiJson(obj) {
  return JSON.stringify(obj).replace(/[^\x00-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * @typedef {object} Turn
 * @property {string} text          buffer-window text since the previous turn, prompt stripped
 * @property {string|null} statusLine
 * @property {string} gridText      all visible grid text (menus in char mode)
 * @property {'line'|'char'|null} inputType
 * @property {boolean} exited       interpreter finished (game quit or crashed)
 * @property {boolean} crashed
 * @property {boolean} timedOut     gave up waiting; partial output returned
 * @property {boolean} commandSent  false when the interpreter was still busy and the command was dropped
 * @property {string|null} notice
 */

export class InterpreterSession extends EventEmitter {
  /**
   * @param {string} gamePath absolute path to the story file
   * @param {{commandTimeoutMs?: number, startTimeoutMs?: number}} [opts]
   */
  constructor(gamePath, opts = {}) {
    super();
    this.gamePath = gamePath;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 10_000;
    this.startTimeoutMs = opts.startTimeoutMs ?? 20_000;
    this.child = null;
    this.alive = false;
    this.inputType = null;

    this._stdout = '';
    this._stderr = '';
    this._gen = 0;
    this._input = null; // {id, type, maxlen}
    this._windows = new Map(); // id -> window descriptor
    this._buffers = new Map(); // id -> lines (this turn)
    this._grids = new Map(); // id -> lines
    this._notices = [];
    this._ready = false; // game is waiting for input
    this._disabled = false; // game told us it is finished
    this._pending = null; // {resolve, timer}
    this._lastInputWindow = null;
  }

  /** Spawn the interpreter and resolve with the first screen. */
  async start() {
    // emglken's Emscripten FS cannot open absolute (esp. Windows) paths: run in the story's
    // directory with a bare filename instead.
    const child = spawn(
      process.execPath,
      [EMGLKEN_BIN, path.basename(this.gamePath), '--rem'],
      { cwd: path.dirname(this.gamePath), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child = child;
    this.alive = true;
    liveChildren.add(child);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { this._stderr = (this._stderr + chunk).slice(-2000); });
    child.stdin.on('error', () => { /* EPIPE after exit */ });
    child.on('error', (err) => {
      this._stderr += String(err.message);
      this._onClose();
    });
    child.on('close', () => { liveChildren.delete(child); this._onClose(); });

    this._write({ type: 'init', gen: 0, metrics: { width: 80, height: 50 }, support: [] });
    const turn = await this._wait(this.startTimeoutMs);
    if (!turn.inputType) {
      this.kill();
      const why = turn.text || this._stderr.trim() || 'no output';
      throw new Error(`Interpreter failed to start: ${why.slice(0, 300)}`);
    }
    return turn;
  }

  /**
   * Send one command (line text, or one keypress in char mode).
   * @param {string} command
   * @returns {Promise<Turn>}
   */
  async send(command) {
    if (!this.alive) return this._deadTurn();

    // A previous command timed out and the game has not asked for input yet.
    if (!this._ready) {
      const turn = await this._wait(this.commandTimeoutMs);
      turn.commandSent = false;
      turn.notice = joinNotice(turn.notice, 'The game was still busy with the previous command; this command was not sent. Send it again.');
      return turn;
    }

    const req = this._input;
    this._ready = false;
    this.inputType = null;
    let event;
    if (req.type === 'char') {
      const { value, notice } = mapCharInput(command);
      if (notice) this._notices.push(notice);
      event = { type: 'char', gen: this._gen, window: req.id, value };
    } else {
      let value = sanitizeLineCommand(command);
      if (req.maxlen && value.length > req.maxlen) {
        value = value.slice(0, req.maxlen);
        this._notices.push(`Command truncated to ${req.maxlen} characters.`);
      }
      event = { type: 'line', gen: this._gen, window: req.id, value };
    }
    const waiting = this._wait(this.commandTimeoutMs);
    this._write(event);
    return waiting;
  }

  /** Terminate the interpreter. Safe to call repeatedly. */
  kill() {
    this.alive = false;
    this._ready = false;
    const child = this.child;
    if (child) {
      this.child = null;
      try { child.stdin.end(); } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
    }
    if (this._pending) this._finishTurn({ exited: true });
  }

  // -- internals -----------------------------------------------------------

  _write(obj) {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(asciiJson(obj) + '\n');
  }

  _wait(ms) {
    return new Promise((resolve) => {
      // If the update we are waiting for already arrived (late response), return it immediately.
      if (this._ready || this._disabled || !this.alive) {
        resolve(this._buildTurn({ exited: this._disabled || !this.alive }));
        this._resetTurn();
        return;
      }
      const timer = setTimeout(() => {
        const p = this._pending;
        this._pending = null;
        if (p) {
          const turn = this._buildTurn({ timedOut: true });
          turn.notice = joinNotice(turn.notice, `The game did not respond within ${ms} ms; showing partial output.`);
          this._resetTurn();
          p.resolve(turn);
        }
      }, ms);
      this._pending = { resolve, timer };
    });
  }

  _finishTurn(flags = {}) {
    const turn = this._buildTurn(flags);
    this._resetTurn();
    const p = this._pending;
    if (p) {
      clearTimeout(p.timer);
      this._pending = null;
      p.resolve(turn);
    }
  }

  _onClose() {
    const wasAlive = this.alive;
    this.alive = false;
    // Drain a final unterminated line, if any.
    if (this._stdout.trim()) {
      this._handleLine(this._stdout);
      this._stdout = '';
    }
    this._ready = false;
    if (wasAlive || this._pending) {
      this.emit('exit');
      if (this._pending) this._finishTurn({ exited: true });
    }
  }

  _onStdout(chunk) {
    this._stdout += chunk;
    let nl;
    while ((nl = this._stdout.indexOf('\n')) !== -1) {
      const line = this._stdout.slice(0, nl);
      this._stdout = this._stdout.slice(nl + 1);
      this._handleLine(line);
    }
  }

  _handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return; // emglken sometimes prints stray diagnostics on stdout
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }
    if (msg.type === 'error') {
      this._stderr += String(msg.message || 'interpreter error');
      this._disabled = true;
      this._finishTurn({ exited: true, crashed: true });
      this.kill();
      return;
    }
    if (msg.type !== 'update') return;
    this._applyUpdate(msg);
  }

  _applyUpdate(msg) {
    if (typeof msg.gen === 'number') this._gen = msg.gen;

    if (Array.isArray(msg.windows)) {
      const next = new Map();
      for (const w of msg.windows) {
        next.set(w.id, w);
        if (!this._buffers.has(w.id) && w.type === 'buffer') this._buffers.set(w.id, []);
        if (!this._grids.has(w.id) && w.type === 'grid') this._grids.set(w.id, []);
        if (w.type === 'grid' && typeof w.gridheight === 'number') {
          const g = this._grids.get(w.id);
          if (g.length > w.gridheight) g.length = w.gridheight;
        }
      }
      for (const id of [...this._grids.keys()]) if (!next.has(id)) this._grids.delete(id);
      for (const id of [...this._buffers.keys()]) if (!next.has(id)) this._buffers.delete(id);
      this._windows = next;
    }

    for (const c of msg.content || []) this._applyContent(c);

    if (msg.specialinput) {
      // A file prompt (save/restore/transcript). We do not support files: cancel it.
      this._notices.push('Save/restore and transcript files are not supported by this server; the request was cancelled.');
      this._write({ type: 'specialresponse', gen: this._gen, response: 'fileref_prompt', value: null });
      return;
    }

    if (Array.isArray(msg.input) && msg.input.length) {
      const req = msg.input[0];
      this._input = { id: req.id, type: req.type === 'char' ? 'char' : 'line', maxlen: req.maxlen || null };
      this._lastInputWindow = req.id;
      this.inputType = this._input.type;
      this._ready = true;
      this._finishTurn();
      return;
    }

    if (msg.disable) {
      this._disabled = true;
      this._input = null;
      this.inputType = null;
      this._finishTurn({ exited: true });
      // The interpreter exits by itself; make sure it does.
      setTimeout(() => this.kill(), 1000).unref();
    }
  }

  _applyContent(c) {
    const win = this._windows.get(c.id);
    if (!win) return;
    if (win.type === 'buffer') {
      let lines = this._buffers.get(c.id);
      if (!lines) { lines = []; this._buffers.set(c.id, lines); }
      if (c.clear) lines.length = 0;
      for (const para of c.text || []) {
        const t = runsText(para.content);
        if (para.append && lines.length) lines[lines.length - 1] += t;
        else lines.push(t);
      }
    } else if (win.type === 'grid') {
      let lines = this._grids.get(c.id);
      if (!lines) { lines = []; this._grids.set(c.id, lines); }
      if (c.clear) lines.length = 0;
      for (const l of c.lines || []) {
        const idx = typeof l.line === 'number' ? l.line : lines.length;
        while (lines.length < idx) lines.push('');
        lines[idx] = runsText(l.content, false);
      }
    }
  }

  _gridInfo() {
    const grids = [...this._windows.values()]
      .filter((w) => w.type === 'grid' && !w.hidden)
      .sort((a, b) => (a.top ?? 0) - (b.top ?? 0) || a.id - b.id)
      .map((w) => (this._grids.get(w.id) || []).map((l) => l.trim()).filter(Boolean));
    const status = grids.find((g) => g.length);
    return {
      statusLine: status ? status.join('\n') : null,
      gridText: grids.flat().join('\n'),
    };
  }

  _buildTurn(flags = {}) {
    // Main window (the one that asked for input) first, then other buffer windows.
    const ids = [...this._buffers.keys()].sort((a, b) => {
      const am = a === this._lastInputWindow ? -1 : 0;
      const bm = b === this._lastInputWindow ? -1 : 0;
      return am - bm || a - b;
    });
    const parts = ids.map((id) => cleanBufferText(this._buffers.get(id), this._input?.type !== 'char' || !!flags.exited)).filter(Boolean);
    const text = parts.join('\n\n');
    const { statusLine, gridText } = this._gridInfo();
    let crashed = !!flags.crashed;
    if (flags.exited && !this._disabled) crashed = true; // process vanished without a clean exit
    if (flags.exited && /\b(?:Fatal error|Glk library error|Unhandled Rejection)\b/.test(text)) crashed = true;
    return {
      text,
      statusLine,
      gridText,
      inputType: flags.exited ? null : (this.inputType ?? this._input?.type ?? 'line'),
      exited: !!flags.exited,
      crashed,
      timedOut: !!flags.timedOut,
      commandSent: true,
      notice: this._notices.length ? this._notices.join(' ') : null,
    };
  }

  _resetTurn() {
    for (const lines of this._buffers.values()) lines.length = 0;
    this._notices = [];
  }

  _deadTurn() {
    return {
      text: '', statusLine: null, gridText: '', inputType: null, exited: true,
      crashed: !this._disabled, timedOut: false, commandSent: false, notice: 'The interpreter is not running.',
    };
  }
}

function joinNotice(a, b) {
  return a ? `${a} ${b}` : b;
}

/** Join lines into display text; strip the trailing input prompt and runs of blank lines. */
export function cleanBufferText(lines, stripPrompt = true) {
  if (!lines || !lines.length) return '';
  const out = lines.map((l) => l.replace(/\s+$/, ''));
  while (out.length && out[out.length - 1] === '') out.pop();
  if (stripPrompt && out.length) {
    const last = out[out.length - 1];
    if (/^\s*>\s*$/.test(last)) out.pop();
    else if (/(^|\s)>$/.test(last)) out[out.length - 1] = last.slice(0, -1).replace(/\s+$/, '');
  }
  return out.join('\n').replace(/^\s*\n/, '').replace(/\n{3,}/g, '\n\n').trim();
}
