/**
 * TCP Connection Handler — Manages the protocol flow for a raw TCP socket client.
 *
 * Lifecycle:
 *   1. Lobby  → Show welcome banner + game list, wait for game selection
 *   2. Setup  → Ask for mode (hard/easy), optional template selection
 *   3. Game   → Pipe interpreter ↔ socket, apply Easy Mode wrapping if needed
 */

import crypto from 'crypto';
import config from '../config.js';
import { formatGameList } from './gameLibrary.js';
import { renderOutput } from './easyMode.js';

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    ██████╗ ██████╗ ██╗   ██╗███████╗                         ║
║   ██╔════╝ ██╔══██╗██║   ██║██╔════╝                         ║
║   ██║  ███╗██████╔╝██║   ██║█████╗                           ║
║   ██║   ██║██╔══██╗██║   ██║██╔══╝                           ║
║   ╚██████╔╝██║  ██║╚██████╔╝███████╗                         ║
║    ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝                        ║
║                                                              ║
║   It is pitch black. You are likely to be eaten by a grue.   ║
║                                                              ║
║   Interactive Fiction Server for AI Agents                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

/**
 * Handles a new TCP socket connection.
 * @param {import('net').Socket} socket
 * @param {{ games: object[], sessionManager: import('./sessionManager.js').SessionManager }} ctx
 */
export function handleTcpConnection(socket, ctx) {
  const clientId = crypto.randomUUID();
  let phase = 'lobby'; // 'lobby' | 'mode-select' | 'template-select' | 'game'
  let selectedGame = null;
  let mode = config.DEFAULT_MODE;
  let templateName = 'default';
  let inputBuffer = '';

  console.log(`[TCP] Client connected: ${clientId}`);

  // Send welcome
  socket.write(BANNER + '\n');
  socket.write(formatGameList(ctx.games));

  // Handle incoming data
  socket.on('data', (data) => {
    inputBuffer += data.toString('utf-8');

    // Process complete lines
    let newlineIdx;
    while ((newlineIdx = inputBuffer.indexOf('\n')) !== -1) {
      const line = inputBuffer.slice(0, newlineIdx).replace(/\r$/, '').trim();
      inputBuffer = inputBuffer.slice(newlineIdx + 1);

      if (line.length === 0 && phase === 'lobby') {
        continue;
      }

      switch (phase) {
        case 'lobby':
          handleLobbyInput(line);
          break;
        case 'mode-select':
          handleModeInput(line);
          break;
        case 'template-select':
          handleTemplateInput(line);
          break;
        case 'game':
          handleGameInput(line);
          break;
      }
    }
  });

  socket.on('error', (err) => {
    if (err.code !== 'ECONNRESET') {
      console.error(`[TCP] Socket error for ${clientId}:`, err.message);
    }
  });

  socket.on('close', () => {
    console.log(`[TCP] Client disconnected: ${clientId}`);
    ctx.sessionManager.destroySession(clientId);
  });

  // ── Phase handlers ──

  function handleLobbyInput(line) {
    const num = parseInt(line, 10);
    if (isNaN(num) || num < 1 || num > ctx.games.length) {
      socket.write(`Invalid selection. Enter a number between 1 and ${ctx.games.length}: `);
      return;
    }

    selectedGame = ctx.games[num - 1];
    socket.write(`\nSelected: ${selectedGame.name}\n`);
    socket.write(`Mode? [hard] / easy: `);
    phase = 'mode-select';
  }

  function handleModeInput(line) {
    const input = line.toLowerCase();
    if (input === 'easy' || input === 'e') {
      mode = 'easy';
      socket.write(`Template? [default]: `);
      phase = 'template-select';
    } else {
      mode = 'hard';
      startGame();
    }
  }

  function handleTemplateInput(line) {
    if (line.length > 0) {
      templateName = line.trim();
    }
    startGame();
  }

  function startGame() {
    socket.write(`\nStarting "${selectedGame.name}" in ${mode.toUpperCase()} mode...\n\n`);
    phase = 'game';

    const interpreter = ctx.sessionManager.createSession(clientId, selectedGame);

    interpreter.on('output', (text) => {
      const turnNumber = ctx.sessionManager.recordOutput(clientId, text);

      let finalOutput = text;
      if (mode === 'easy') {
        finalOutput = renderOutput(templateName, { output: text, turnNumber });
      }

      if (!socket.destroyed) {
        socket.write(finalOutput);
      }
    });

    interpreter.on('exit', (code) => {
      if (!socket.destroyed) {
        socket.write(`\n\n[Game Over — interpreter exited with code ${code}]\n`);
        socket.end();
      }
    });

    interpreter.on('error', (err) => {
      if (!socket.destroyed) {
        socket.write(`\n[Error: ${err.message}]\n`);
        socket.write(`Make sure the interpreter binary is installed and the INTERPRETER_BIN config is set correctly.\n`);
        socket.end();
      }
    });

    interpreter.start();
  }

  function handleGameInput(line) {
    ctx.sessionManager.recordCommand(clientId, line);
    const entry = ctx.sessionManager.sessions.get(clientId);
    if (entry && entry.interpreter.alive) {
      entry.interpreter.sendCommand(line);
    }
  }
}
