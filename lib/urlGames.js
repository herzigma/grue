/**
 * Games loaded from a URL (POST /api/sessions {"game_url": ...}): story files the server operator did not
 * install. Their runs are unranked (PROTOCOL.md section 11).
 *
 * Safety rules:
 * - https only, default port, no credentials in the URL; the host must be on GAME_URL_HOSTS (a listed domain
 *   also allows its subdomains). Every redirect hop is checked the same way.
 * - At most GAME_URL_MAX_BYTES, read as a stream and cut off past the limit; GAME_URL_TIMEOUT_MS for the whole fetch.
 * - The format comes from the file's first bytes, not the URL: Z-code (versions 3, 4, 5, 8), Glulx, or a Blorb
 *   holding one of them. Grue's native games (JavaScript) are never loaded this way.
 * - Optional `sha256` pins the exact file; the server always records the file's SHA-256 on the Result.
 * - Each session plays its own copy in a throwaway directory, removed when the session ends.
 *
 * Downloads are cached on disk by SHA-256 (GAME_URL_CACHE_DIR, newest GAME_URL_CACHE_FILES kept), and a URL
 * is not fetched again for an hour.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GrueError } from './gameSession.js';

const MAX_REDIRECTS = 5;
const MAX_CONCURRENT_DOWNLOADS = 4;
const URL_TTL_MS = 60 * 60 * 1000;
const SHA256_RE = /^[0-9a-f]{64}$/;

const rejected = (m) => new GrueError('game_url_rejected', m, 400);
const failed = (m) => new GrueError('game_url_failed', m, 502);

/** GAME_URL_HOSTS as a list of lowercase domains; "off" (or nothing) disables URL games. */
export function parseHosts(value) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((h) => String(h).trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
  return list.length === 1 && list[0] === 'off' ? [] : list;
}

/** True when `host` is one of `allowed` or a subdomain of one. */
export function hostAllowed(host, allowed) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Parse and check a URL against the rules above. Returns a URL object or throws game_url_rejected. */
export function checkGameUrl(raw, allowed) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) throw rejected('"game_url" must be a URL of at most 2048 characters.');
  let u;
  try { u = new URL(raw); } catch { throw rejected('"game_url" is not a valid URL.'); }
  if (u.protocol !== 'https:') throw rejected('"game_url" must use https.');
  if (u.username || u.password) throw rejected('"game_url" must not contain credentials.');
  if (u.port && u.port !== '443') throw rejected('"game_url" must use the default https port.');
  if (!hostAllowed(u.hostname, allowed)) {
    throw rejected(`Host "${u.hostname}" is not allowed. This server loads games from: ${allowed.join(', ')}.`);
  }
  return u;
}

/** Walk a Blorb's chunks looking for the executable. */
function blorbExec(buf) {
  let off = 12;
  const end = Math.min(buf.length, 12 + buf.readUInt32BE(4));
  while (off + 8 <= end) {
    const type = buf.toString('latin1', off, off + 4);
    if (type === 'ZCOD') return buf.length > off + 8 && [3, 4, 5, 8].includes(buf[off + 8]) ? 'zcode' : null;
    if (type === 'GLUL') return 'glulx';
    const len = buf.readUInt32BE(off + 4);
    off += 8 + len + (len % 2);
  }
  return null;
}

/**
 * The story format from its first bytes: {format, ext} for a file emglken can run, or null.
 * @param {Buffer} buf
 */
export function detectFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 64) return null;
  const magic = buf.toString('latin1', 0, 4);
  if (magic === 'Glul') return { format: 'glulx', ext: '.ulx' };
  if (magic === 'FORM' && buf.toString('latin1', 8, 12) === 'IFRS') {
    const exec = blorbExec(buf);
    if (exec === 'zcode') return { format: 'zcode', ext: '.zblorb' };
    if (exec === 'glulx') return { format: 'glulx', ext: '.gblorb' };
    return null;
  }
  // Z-code has no magic number: the version byte, plus a header that points inside the file.
  const v = buf[0];
  const highMem = buf.readUInt16BE(4);
  const initialPc = buf.readUInt16BE(6);
  if ([3, 4, 5, 8].includes(v) && highMem >= 64 && highMem < buf.length && initialPc >= 64 && initialPc < buf.length) {
    return { format: 'zcode', ext: `.z${v}` };
  }
  return null;
}

function titleFromUrl(u) {
  const base = decodeURIComponent(path.posix.basename(u.pathname) || '') || u.hostname;
  return base.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 100) || u.hostname;
}

export class UrlGames {
  /**
   * @param {object} cfg  GAME_URL_HOSTS, GAME_URL_MAX_BYTES, GAME_URL_TIMEOUT_MS, GAME_URL_CACHE_DIR,
   *   GAME_URL_CACHE_FILES; GAME_URL_FETCH replaces global fetch (tests)
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.hosts = parseHosts(cfg.GAME_URL_HOSTS);
    this.fetch = cfg.GAME_URL_FETCH ?? globalThis.fetch;
    this.cacheDir = cfg.GAME_URL_CACHE_DIR || path.join(os.tmpdir(), 'grue-url-cache');
    this.byUrl = new Map(); // href -> {sha256, ext, format, at}
    this.inFlight = new Map(); // href -> Promise
  }

  get enabled() {
    return this.hosts.length > 0;
  }

  /**
   * Fetch (or reuse) the story at `rawUrl` and copy it into a fresh session directory.
   * @param {string} rawUrl
   * @param {string} [sha256]  expected SHA-256 (hex); a mismatch is game_url_rejected
   * @returns {Promise<{game: object, path: string, dir: string, cleanup: () => void}>}
   */
  async prepare(rawUrl, sha256) {
    if (!this.enabled) throw rejected('This server does not load games from URLs.');
    const want = sha256 === undefined || sha256 === null ? null : String(sha256).toLowerCase();
    if (want !== null && !SHA256_RE.test(want)) throw rejected('"sha256" must be 64 hex characters.');
    const url = checkGameUrl(rawUrl, this.hosts);

    const file = await this._resolve(url, want);
    if (want && file.sha256 !== want) {
      throw rejected(`The file at "game_url" has SHA-256 ${file.sha256}, not the "sha256" you sent.`);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-url-session-'));
    const gamePath = path.join(dir, `story${file.ext}`);
    try {
      fs.copyFileSync(file.path, gamePath);
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new GrueError('internal', `Cannot prepare the game: ${err.message}`, 500);
    }
    const game = {
      id: `url-${file.sha256.slice(0, 12)}`,
      title: titleFromUrl(url),
      author: null,
      format: file.format,
      filename: path.posix.basename(url.pathname) || null,
      max_score: null,
      difficulty: null,
      suggested_turn_limit: null,
      tags: ['url'],
      description: null,
      license: null,
      private: false,
      available: true,
      url: url.href,
      sha256: file.sha256,
    };
    const cleanup = () => {
      fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, () => {});
    };
    return { game, path: gamePath, dir, cleanup };
  }

  /** A cached file for this URL: {path, sha256, ext, format}. Downloads when needed. */
  async _resolve(url, want) {
    const cached = (sha) => {
      const hit = this._cachedFile(sha);
      return hit ? { ...hit, sha256: sha } : null;
    };
    if (want) {
      const hit = cached(want);
      if (hit) return hit;
    }
    const known = this.byUrl.get(url.href);
    if (known && Date.now() - known.at < URL_TTL_MS && (!want || known.sha256 === want)) {
      const hit = cached(known.sha256);
      if (hit) return hit;
    }
    let p = this.inFlight.get(url.href);
    if (!p) {
      if (this.inFlight.size >= MAX_CONCURRENT_DOWNLOADS) {
        throw new GrueError('too_many_sessions', 'The server is already downloading several games; try again shortly.', 429);
      }
      p = this._download(url).finally(() => this.inFlight.delete(url.href));
      this.inFlight.set(url.href, p);
    }
    return p;
  }

  _cachedFile(sha) {
    for (const ext of ['.ulx', '.gblorb', '.zblorb', '.z3', '.z4', '.z5', '.z8']) {
      const p = path.join(this.cacheDir, `${sha}${ext}`);
      if (fs.existsSync(p)) {
        return { path: p, ext, format: ext === '.ulx' || ext === '.gblorb' ? 'glulx' : 'zcode' };
      }
    }
    return null;
  }

  async _download(url) {
    const max = this.cfg.GAME_URL_MAX_BYTES;
    const signal = AbortSignal.timeout(this.cfg.GAME_URL_TIMEOUT_MS);
    let current = url;
    let res;
    try {
      for (let hop = 0; ; hop++) {
        res = await this.fetch(current.href, { redirect: 'manual', signal, headers: { Accept: '*/*' } });
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        if (hop >= MAX_REDIRECTS) throw failed('Too many redirects.');
        const loc = res.headers.get('location');
        if (!loc) throw failed(`HTTP ${res.status} without a Location header.`);
        current = checkGameUrl(new URL(loc, current).href, this.hosts);
      }
      if (!res.ok) throw failed(`Fetching the game returned HTTP ${res.status}.`);
      const declared = Number(res.headers.get('content-length'));
      if (declared > max) throw rejected(`The game file is larger than this server's limit of ${max} bytes.`);

      const chunks = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > max) throw rejected(`The game file is larger than this server's limit of ${max} bytes.`);
          chunks.push(Buffer.from(chunk));
        }
      }
      const buf = Buffer.concat(chunks);
      const fmt = detectFormat(buf);
      if (!fmt) {
        throw rejected('That file is not a story this server can run from a URL (Z-code versions 3, 4, 5 or 8, Glulx, or a Blorb of either).');
      }
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const dest = path.join(this.cacheDir, `${sha256}${fmt.ext}`);
      fs.mkdirSync(this.cacheDir, { recursive: true });
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(`${dest}.tmp`, buf);
        fs.renameSync(`${dest}.tmp`, dest);
        this._prune();
      }
      for (const u of new Set([url.href, current.href])) this.byUrl.set(u, { sha256, at: Date.now() });
      return { path: dest, sha256, ext: fmt.ext, format: fmt.format };
    } catch (err) {
      if (err instanceof GrueError) throw err;
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw failed('Fetching the game timed out.');
      throw failed(`Could not fetch the game: ${err?.message || err}`);
    }
  }

  /** Keep the newest GAME_URL_CACHE_FILES files in the cache. */
  _prune() {
    let files;
    try {
      files = fs.readdirSync(this.cacheDir)
        .filter((n) => !n.endsWith('.tmp'))
        .map((n) => ({ p: path.join(this.cacheDir, n), t: fs.statSync(path.join(this.cacheDir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    } catch { return; }
    for (const f of files.slice(this.cfg.GAME_URL_CACHE_FILES)) {
      try { fs.unlinkSync(f.p); } catch { /* in use or gone */ }
    }
  }
}
