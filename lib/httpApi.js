/**
 * HTTP layer: REST API (PROTOCOL.md section 4), health/metrics, and the dashboard page.
 * Node built-ins only.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GrueError } from './gameSession.js';

export const VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendError(res, status, error, message) {
  sendJson(res, status, { error, message });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { // keep draining (so the 413 can be delivered) but stop buffering
        tooBig = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new GrueError('bad_request', 'Request body too large.', 413));
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new GrueError('bad_request', 'Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const sha = (s) => crypto.createHash('sha256').update(s).digest();

/** True if no keys are configured, or the request carries a valid bearer key. */
export function isAuthorized(cfg, headers, queryToken = null) {
  if (!cfg.API_KEYS.length) return true;
  const m = /^Bearer\s+(.+)$/i.exec(headers.authorization || '');
  const presented = m ? m[1].trim() : queryToken;
  if (!presented) return false;
  const given = sha(presented);
  return cfg.API_KEYS.some((k) => crypto.timingSafeEqual(given, sha(k)));
}

/**
 * Build the request listener.
 * @param {{cfg: object, library: object, manager: object, metrics: object, results: object}} ctx
 */
export function createHttpHandler(ctx) {
  const { cfg, library, manager, metrics, results } = ctx;

  async function route(req, res, url) {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;
    const segs = p.split('/').filter(Boolean).map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });

    // Public endpoints
    if (p === '/' || p === '/index.html') {
      if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, 'method_not_allowed', 'Use GET.');
      let html;
      try {
        html = fs.readFileSync(path.join(cfg.PUBLIC_DIR, 'index.html'));
      } catch {
        return sendError(res, 404, 'not_found', 'Dashboard not installed.');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(method === 'HEAD' ? undefined : html);
    }
    if (p === '/health') {
      return sendJson(res, 200, { status: 'ok', version: VERSION, active_sessions: manager.active.size });
    }
    if (p === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(metrics.getReport());
    }

    if (segs[0] !== 'api') return sendError(res, 404, 'not_found', `No such route: ${p}`);
    if (!isAuthorized(cfg, req.headers)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendError(res, 401, 'unauthorized', 'A valid "Authorization: Bearer <key>" header is required.');
    }

    const [, resource, id, sub] = segs;
    const need = (...methods) => {
      if (!methods.includes(method)) {
        res.setHeader('Allow', methods.join(', '));
        sendError(res, 405, 'method_not_allowed', `Allowed: ${methods.join(', ')}`);
        return false;
      }
      return true;
    };

    if (resource === 'games') {
      if (!need('GET')) return undefined;
      if (segs.length === 2) return sendJson(res, 200, { games: library.list() });
      if (segs.length === 3) {
        const found = library.find(id);
        if (!found) throw new GrueError('unknown_game', `Unknown game "${id}".`, 404);
        return sendJson(res, 200, found.game);
      }
    }

    if (resource === 'sessions') {
      if (segs.length === 2) {
        if (method === 'GET') return sendJson(res, 200, { sessions: manager.list() });
        if (!need('GET', 'POST')) return undefined;
        const body = await readJsonBody(req);
        const { observation } = await manager.create(body);
        return sendJson(res, 201, observation);
      }
      if (segs.length === 3) {
        if (!need('GET', 'DELETE')) return undefined;
        if (method === 'DELETE') return sendJson(res, 200, manager.end(id));
        const s = manager.get(id);
        if (!s) throw new GrueError('unknown_session', `Unknown session "${id}".`, 404);
        return sendJson(res, 200, { session: s.summary(), observation: s.lastObservation });
      }
      if (segs.length === 4 && sub === 'commands') {
        if (!need('POST')) return undefined;
        const body = await readJsonBody(req);
        if (typeof body.command !== 'string') {
          throw new GrueError('bad_request', '"command" (a string) is required.');
        }
        if (body.command.length > cfg.MAX_COMMAND_LENGTH) {
          throw new GrueError('command_too_long', `Commands are limited to ${cfg.MAX_COMMAND_LENGTH} characters.`);
        }
        const session = manager.getActive(id);
        return sendJson(res, 200, await session.command(body.command));
      }
    }

    if (resource === 'results') {
      if (!need('GET')) return undefined;
      if (segs.length === 2) {
        const limitRaw = url.searchParams.get('limit');
        let limit;
        if (limitRaw !== null) {
          limit = parseInt(limitRaw, 10);
          if (!Number.isInteger(limit) || limit < 1) throw new GrueError('bad_request', '"limit" must be a positive integer.');
        }
        return sendJson(res, 200, { results: results.list({ game: url.searchParams.get('game') || undefined, limit }) });
      }
      if (segs.length === 3 || (segs.length === 4 && sub === 'transcript')) {
        const r = results.get(id);
        if (!r) throw new GrueError('unknown_session', `No result for session "${id}".`, 404);
        if (segs.length === 3) return sendJson(res, 200, r);
        const entries = results.transcript(id);
        if (!entries) throw new GrueError('unknown_session', 'Transcript not available.', 404);
        return sendJson(res, 200, { entries });
      }
    }

    return sendError(res, 404, 'not_found', `No such route: ${method} ${p}`);
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      if (err instanceof GrueError) return sendError(res, err.status, err.code, err.message);
      console.error('[HTTP] Unhandled error:', err);
      sendError(res, 500, 'internal', 'Internal server error.');
    }
  };
}
