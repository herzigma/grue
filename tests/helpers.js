import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

import { startServer } from '../index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const hasZork = fs.existsSync(path.join(ROOT, 'games', 'zork1.z3'));
export const hasAirport = fs.existsSync(path.join(ROOT, 'games', 'Airport.gblorb'));

/** Start a server on ephemeral ports with throwaway results/replays directories. */
export async function testServer(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-test-'));
  const server = await startServer({
    HOST: '127.0.0.1',
    HTTP_PORT: 0,
    TCP_PORT: 0,
    QUIET: true,
    RESULTS_DIR: path.join(dir, 'results'),
    REPLAYS_DIR: path.join(dir, 'replays'),
    ...options,
  });
  const base = `http://127.0.0.1:${server.httpPort}`;

  async function req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }

  return {
    ...server,
    dir,
    base,
    req,
    get: (url, headers) => req('GET', url, undefined, headers),
    post: (url, body, headers) => req('POST', url, body, headers),
    del: (url, headers) => req('DELETE', url, undefined, headers),
    /** Start a session; returns the turn-0 observation. */
    async start(game, extra = {}) {
      const r = await req('POST', '/api/sessions', { game, ...extra });
      if (r.status !== 201) throw new Error(`start failed: ${r.status} ${r.text}`);
      return r.json;
    },
    /** Send a command; returns the Observation (throws on non-200). */
    async cmd(id, command) {
      const r = await req('POST', `/api/sessions/${id}/commands`, { command });
      if (r.status !== 200) throw new Error(`command failed: ${r.status} ${r.text}`);
      return r.json;
    },
  };
}

/** True while a process with this pid exists. */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function waitUntil(fn, timeoutMs = 3000, stepMs = 25) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

/** Collects text from a TCP socket and lets tests wait for patterns. */
export class TextClient {
  constructor(socket) {
    this.buf = '';
    this.closed = false;
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (d) => { this.buf += d; });
    socket.on('close', () => { this.closed = true; });
    socket.on('error', () => {});
  }

  static async tcp(port) {
    const socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    return new TextClient(socket);
  }

  send(line) { this.socket.write(line + '\n'); }

  /** Wait until the buffer matches, then clear it and return what was received. */
  async expect(re, timeoutMs = 8000) {
    const ok = await waitUntil(() => re.test(this.buf), timeoutMs);
    if (!ok) throw new Error(`timed out waiting for ${re}; got: ${JSON.stringify(this.buf.slice(-400))}`);
    const out = this.buf;
    this.buf = '';
    return out;
  }

  async waitClosed(timeoutMs = 5000) {
    return waitUntil(() => this.closed, timeoutMs);
  }

  close() { this.socket.destroy(); }
}

/** JSON-over-WebSocket client with a message queue. */
export class WsClient {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    ws.on('message', (data) => {
      const raw = data.toString('utf8');
      const w = this.waiters.shift();
      if (w) w(raw); else this.queue.push(raw);
    });
    ws.on('close', () => { this.closed = true; });
    ws.on('error', () => {});
  }

  static async connect(url, options) {
    const ws = new WebSocket(url, options);
    const client = new WsClient(ws); // attach handlers before 'open': the server may greet immediately
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
      ws.once('unexpected-response', (_, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    return client;
  }

  next(timeoutMs = 8000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws timeout')), timeoutMs);
      this.waiters.push((raw) => { clearTimeout(t); resolve(raw); });
    });
  }

  async nextJson() { return JSON.parse(await this.next()); }

  async request(obj) {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
    return this.nextJson();
  }

  /** Text-mode helper: send a line, wait for a message matching re. */
  async expect(re, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    let acc = '';
    while (Date.now() < end) {
      acc += await this.next(Math.max(50, end - Date.now()));
      if (re.test(acc)) return acc;
    }
    throw new Error(`timed out waiting for ${re}; got ${JSON.stringify(acc.slice(-300))}`);
  }

  waitClosed(timeoutMs = 5000) { return waitUntil(() => this.closed, timeoutMs); }
  close() { this.ws.terminate(); }
}
