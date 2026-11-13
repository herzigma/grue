/**
 * Game library: the manifest (games/games.json) merged with whatever story files are on disk.
 *
 * Story files are searched in GAMES_DIR, GAMES_DIR/original (committed original games) and
 * GAMES_DIR/sealed (encrypted held-out games, see lib/sealed.js; playable only with GRUE_GAMES_KEY).
 * Files with no manifest entry are listed with an id slugified from the filename and null metadata.
 *
 * A game is private (held out) when its manifest tags include "private" or its file is sealed:
 * the server never serves transcripts of private games.
 */

import fs from 'fs';
import path from 'path';
import { SEALED_EXT } from './sealed.js';

/** Extensions emglken can run, mapped to catalog format. */
export const FORMATS = {
  '.ulx': 'glulx',
  '.gblorb': 'glulx',
  '.z3': 'zcode',
  '.z4': 'zcode',
  '.z5': 'zcode',
  '.z8': 'zcode',
  '.zblorb': 'zcode',
  '.hex': 'hugo',
  '.taf': 'adrift',
  '.gam': 'tads',
  '.t3': 'tads',
};

const SEARCH_SUBDIRS = ['', 'original', 'sealed'];

/** Games written for Grue's built-in engine (lib/native): JS modules, only under games/original. */
const NATIVE_EXT = '.js';

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';
}

const isSealed = (filename) => String(filename).toLowerCase().endsWith(SEALED_EXT);

function formatOf(filename) {
  if (isSealed(filename) || path.extname(filename).toLowerCase() === NATIVE_EXT) return 'native';
  return FORMATS[path.extname(filename).toLowerCase()] || 'unknown';
}

function titleCase(basename) {
  basename = basename.replace(/\.js$/i, '');
  return basename.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Public catalog object (PROTOCOL.md section 2). A sealed game is available only when the key is set. */
function toGame(entry, filePath, hasKey) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const sealed = isSealed(entry.filename);
  return {
    id: entry.id,
    title: entry.title ?? titleCase(path.basename(entry.filename, path.extname(entry.filename))),
    author: entry.author ?? null,
    format: entry.format ?? formatOf(entry.filename),
    filename: entry.filename,
    max_score: Number.isInteger(entry.max_score) ? entry.max_score : null,
    difficulty: entry.difficulty ?? null,
    suggested_turn_limit: Number.isInteger(entry.suggested_turn_limit) ? entry.suggested_turn_limit : null,
    tags,
    description: entry.description ?? null,
    license: entry.license ?? null,
    private: sealed || tags.includes('private'),
    available: Boolean(filePath) && (!sealed || hasKey),
  };
}

export class GameLibrary {
  /**
   * @param {string} gamesDir
   * @param {{sealedKey?: Buffer|null}} [o] key for sealed games (only its presence matters here)
   */
  constructor(gamesDir, { sealedKey = null } = {}) {
    this.gamesDir = gamesDir;
    this.hasKey = Boolean(sealedKey);
  }

  _readManifest() {
    const file = path.join(this.gamesDir, 'games.json');
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[GameLibrary] Cannot read ${file}: ${err.message}`);
      return [];
    }
  }

  _locate(filename) {
    for (const sub of SEARCH_SUBDIRS) {
      const p = path.join(this.gamesDir, sub, filename);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* not here */ }
    }
    return null;
  }

  _scanFiles() {
    const found = [];
    for (const sub of SEARCH_SUBDIRS) {
      let entries;
      try {
        entries = fs.readdirSync(path.join(this.gamesDir, sub), { withFileTypes: true });
      } catch { continue; }
      for (const e of entries) {
        const ext = path.extname(e.name).toLowerCase();
        const native = (sub === 'original' && ext === NATIVE_EXT) || (sub === 'sealed' && isSealed(e.name));
        if (e.isFile() && (FORMATS[ext] || native)) {
          found.push({ filename: e.name, path: path.join(this.gamesDir, sub, e.name) });
        }
      }
    }
    return found;
  }

  /**
   * All games, manifest entries first. Each item is {game, path} where path is null if unavailable.
   * Re-reads the disk on every call so freshly downloaded games show up without a restart.
   */
  entries() {
    const out = [];
    const ids = new Set();
    const listedFiles = new Set();

    for (const entry of this._readManifest()) {
      if (!entry || typeof entry.filename !== 'string') continue;
      const id = entry.id || slugify(path.basename(entry.filename, path.extname(entry.filename)));
      if (ids.has(id)) continue;
      ids.add(id);
      listedFiles.add(entry.filename);
      const p = this._locate(entry.filename);
      out.push({ game: toGame({ ...entry, id }, p, this.hasKey), path: p });
    }

    for (const f of this._scanFiles().sort((a, b) => a.filename.localeCompare(b.filename))) {
      if (listedFiles.has(f.filename)) continue;
      const id = slugify(path.basename(f.filename.replace(/\.js\.enc$/i, ''), path.extname(f.filename)));
      if (ids.has(id)) continue;
      ids.add(id);
      listedFiles.add(f.filename);
      out.push({ game: toGame({ id, filename: f.filename }, f.path, this.hasKey), path: f.path });
    }
    return out;
  }

  list() {
    return this.entries().map((e) => e.game);
  }

  /** @returns {{game: object, path: string|null}|null} */
  find(id) {
    return this.entries().find((e) => e.game.id === id) || null;
  }

  /** Is this game held out (transcripts never served)? Unknown ids are not private. */
  isPrivate(id) {
    return Boolean(this.find(id)?.game.private);
  }
}
