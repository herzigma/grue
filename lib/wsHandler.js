/**
 * WebSocket Connection Handler — Same protocol as TCP, but over WebSocket text frames.
 */

import crypto from 'crypto';
import config from '../config.js';
import { formatGameList } from './gameLibrary.js';
import { renderOutput } from './easyMode.js';

const BANNER = [
  '',
  '  ┌─────────────────────────────────────────┐',
  '  │              G R U E                     │',
  '  │  Interactive Fiction Server for AI Agents │',
  '  │                                          │',
  '  │  "It is pitch black.                     │',
  '  │   You are likely to be eaten by a grue." │',
  '  └─────────────────────────────────────────┘',
  '',
].join('\n');

/**
 * Handles a new WebSocket connection.
 * @param {import('ws').WebSocket} ws
 * @param {{ games: object[], sessionManager: import('./sessionManager.js').SessionManager }} ctx
 */
export function handleWsConnection(ws, ctx) {
  const clientId = crypto.randomUUID();
  let phase = 'lobby';
  let selectedGame = null;
  let mode = config.DEFAULT_MODE;
  let templateName = 'default';

  console.log(`[WS] Client connected: ${clientId}`);

  // Send welcome
  ws.send(BANNER + '\n' + formatGameList(ctx.games));

  ws.on('message', (data) => {
    const line = data.toString('utf-8').replace(/\r?\n$/, '').trim();
    if (line.length === 0 && phase === 'lobby') {
      return;
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
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for ${clientId}:`, err.message);
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${clientId}`);
    ctx.sessionManager.destroySession(clientId);
  });

  // ── Phase handlers ──

  function handleLobbyInput(line) {
    const num = parseInt(line, 10);
    if (isNaN(num) || num < 1 || num > ctx.games.length) {
      ws.send(`Invalid selection. Enter a number between 1 and ${ctx.games.length}: `);
      return;
    }

    selectedGame = ctx.games[num - 1];
    ws.send(`\nSelected: ${selectedGame.name}\nMode? [hard] / easy: `);
    phase = 'mode-select';
  }

  function handleModeInput(line) {
    const input = line.toLowerCase();
    if (input === 'easy' || input === 'e') {
      mode = 'easy';
      ws.send(`Template? [default]: `);
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
    ws.send(`\nStarting "${selectedGame.name}" in ${mode.toUpperCase()} mode...\n\n`);
    phase = 'game';

    const interpreter = ctx.sessionManager.createSession(clientId, selectedGame);

    interpreter.on('output', (text) => {
      const turnNumber = ctx.sessionManager.recordOutput(clientId, text);

      let finalOutput = text;
      if (mode === 'easy') {
        finalOutput = renderOutput(templateName, { output: text, turnNumber });
      }

      if (ws.readyState === ws.OPEN) {
        ws.send(finalOutput);
      }
    });

    interpreter.on('exit', (code) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(`\n\n[Game Over — interpreter exited with code ${code}]`);
        ws.close();
      }
    });

    interpreter.on('error', (err) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(`\n[Error: ${err.message}]\nMake sure the interpreter binary is installed and the INTERPRETER_BIN config is set correctly.`);
        ws.close();
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
