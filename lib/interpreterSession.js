/**
 * Interpreter Session — Wraps a dumb-glulxe child process for a single game.
 *
 * Spawns the interpreter, buffers its stdout, detects the input prompt,
 * and emits complete "turns" of narrative text.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import config from '../config.js';

export class InterpreterSession extends EventEmitter {
  /**
   * @param {string} gamePath — Absolute path to the .ulx/.gblorb file.
   * @param {string} interpreterCmd — Command to spawn.
   * @param {string[]} interpreterArgs — Base arguments to pass before the gamePath.
   */
  constructor(gamePath, interpreterCmd = config.INTERPRETER_CMD, interpreterArgs = config.INTERPRETER_ARGS || []) {
    super();
    // Emscripten virtual filesystems (used by emglken) do not handle absolute Windows paths well.
    // Convert to a posix-style relative path.
    this.gamePath = path.relative(process.cwd(), gamePath).replace(/\\/g, '/');
    this.interpreterCmd = interpreterCmd;
    this.interpreterArgs = interpreterArgs;
    this.process = null;
    this._buffer = '';
    this._debounceTimer = null;
    this._alive = false;
  }

  /**
   * Spawns the interpreter process and begins capturing output.
   */
  start() {
    this.process = spawn(this.interpreterCmd, [...this.interpreterArgs, this.gamePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    this._alive = true;

    this.process.stdout.on('data', (chunk) => {
      this._buffer += chunk.toString('utf-8');
      this._scheduleFlush();
    });

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      console.error(`[Interpreter:stderr] ${text.trim()}`);
    });

    this.process.on('error', (err) => {
      console.error(`[Interpreter] Process error:`, err.message);
      this._alive = false;
      this.emit('error', err);
    });

    this.process.on('exit', (code, signal) => {
      this._alive = false;
      // Flush any remaining buffered text
      if (this._buffer.length > 0) {
        this._flush();
      }
      this.emit('exit', code, signal);
    });
  }

  /**
   * Schedules a buffer flush. We flush when:
   *   1. The prompt pattern `> ` is detected at the end of the buffer, OR
   *   2. Output has been quiet for OUTPUT_DEBOUNCE_MS (fallback).
   */
  _scheduleFlush() {
    // Clear any pending debounce
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Check for prompt pattern
    if (config.PROMPT_PATTERN.test(this._buffer)) {
      this._flush(false);
      return;
    }

    // Fallback: debounce-based flush
    this._debounceTimer = setTimeout(() => {
      if (this._buffer.length > 0) {
        this._flush(true);
      }
    }, config.OUTPUT_DEBOUNCE_MS);
  }

  /**
   * Flushes the accumulated buffer as a single output turn.
   * @param {boolean} wasDebounced - True if flushed by timeout (often implies char/menu mode).
   */
  _flush(wasDebounced = false) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    let text = this._buffer;
    this._buffer = '';

    if (wasDebounced) {
      // If we didn't end on a standard prompt, the game is likely in character-input mode (e.g., a menu).
      text += '\n\n[System: The game is waiting for a key press (Menu/More). Use macros (\\up, \\down, \\enter) or a single character (q, space, 1, 2) to interact.]';
    }

    this.emit('output', text);
  }

  /**
   * Sends a command to the interpreter's stdin.
   * @param {string} text — The command text.
   */
  sendCommand(text) {
    if (!this._alive || !this.process) {
      console.warn('[Interpreter] Cannot send command — process not running.');
      return;
    }

    const t = text.trim().toLowerCase();
    
    // Check for special key macros
    switch (t) {
      case '\\up':
        this.process.stdin.write('\x1b[A');
        return;
      case '\\down':
        this.process.stdin.write('\x1b[B');
        return;
      case '\\right':
        this.process.stdin.write('\x1b[C');
        return;
      case '\\left':
        this.process.stdin.write('\x1b[D');
        return;
      case '\\enter':
      case '\\return':
        this.process.stdin.write('\n'); // Emits return keypress
        return;
      case '\\space':
        this.process.stdin.write(' ');
        return;
      case '\\esc':
      case '\\escape':
        this.process.stdin.write('\x1b');
        return;
    }

    // Standard text
    this.process.stdin.write(text + '\n');
  }

  /**
   * Injects a save command into the interpreter.
   * @param {string} filepath — Path where the save file should be written.
   */
  save(filepath) {
    this.sendCommand('save');
    // Many interpreters prompt for a filename after "save"; provide it.
    setTimeout(() => {
      this.sendCommand(filepath);
    }, 500);
  }

  /**
   * Whether the interpreter process is still alive.
   */
  get alive() {
    return this._alive;
  }

  /**
   * Kills the interpreter process and cleans up.
   */
  destroy() {
    this._alive = false;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this.process) {
      this.process.stdin.end();
      this.process.kill();
      this.process = null;
    }
    this.removeAllListeners();
  }
}
