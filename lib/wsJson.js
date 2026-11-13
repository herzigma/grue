/**
 * WebSocket JSON API at /ws/v1 (PROTOCOL.md section 6). One session per socket;
 * closing the socket aborts the session.
 */

import { GrueError } from './gameSession.js';

/**
 * @param {import('ws').WebSocket} ws
 * @param {{cfg: object, library: object, manager: object}} ctx
 * @param {string|null} [owner] id of the API key the socket authenticated with (null when auth is off)
 */
export function handleWsJson(ws, ctx, owner = null) {
  const { cfg, library, manager } = ctx;
  let session = null;
  let starting = false;
  let queue = Promise.resolve(); // handle messages one at a time, in order

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendError = (err) => {
    if (err instanceof GrueError) {
      send({ type: 'error', error: err.code, message: err.message });
    } else {
      console.error('[WS] Unhandled error:', err);
      send({ type: 'error', error: 'internal', message: 'Internal server error.' });
    }
  };

  async function handle(msg) {
    switch (msg.type) {
      case 'list_games':
        return send({ type: 'games', games: library.list() });

      case 'start': {
        if (session || starting) throw new GrueError('bad_request', 'A session is already running on this socket.');
        starting = true;
        try {
          const created = await manager.create({ game: msg.game, max_turns: msg.max_turns, meta: msg.meta }, owner);
          session = created.session;
          if (ws.readyState !== ws.OPEN) { session.end('aborted'); return undefined; }
          return send({ type: 'observation', ...created.observation });
        } finally {
          starting = false;
        }
      }

      case 'command': {
        if (!session) throw new GrueError('bad_request', 'No session; send {"type":"start","game":...} first.');
        if (typeof msg.command !== 'string') throw new GrueError('bad_request', '"command" (a string) is required.');
        if (msg.command.length > cfg.MAX_COMMAND_LENGTH) {
          throw new GrueError('command_too_long', `Commands are limited to ${cfg.MAX_COMMAND_LENGTH} characters.`);
        }
        return send({ type: 'observation', ...(await session.command(msg.command)) });
      }

      case 'end': {
        if (!session) throw new GrueError('bad_request', 'No session to end.');
        const result = session.end('aborted');
        send({ type: 'result', ...result });
        return ws.close(1000, 'session ended');
      }

      default:
        throw new GrueError('bad_request', `Unknown message type "${msg.type}".`);
    }
  }

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('not an object');
    } catch {
      return send({ type: 'error', error: 'bad_request', message: 'Messages must be JSON objects.' });
    }
    queue = queue.then(() => handle(msg)).catch(sendError);
    return undefined;
  });

  ws.on('error', () => { /* handled by close */ });
  ws.on('close', () => {
    if (session && !session.gameOver) session.end('aborted');
  });
}
