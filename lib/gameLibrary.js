/**
 * Game library: the manifest (games/games.json) merged with whatever story files are on disk.
 *
 * Story files are searched in GAMES_DIR and GAMES_DIR/original (committed original games).
 * Files with no manifest entry are listed with an id slugified from the filename and null metadata.
 */

import fs from 'fs';
import path from 'path';

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

const SEARCH_SUBDIRS = ['', 'original'];

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';
}

function formatOf(filename) {
  return FORMATS[path.extname(filename).toLowerCase()] || 'unknown';
}

function titleCase(basename) {
  return basename.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Public catalog object (PROTOCOL.md section 2). */
function toGame(entry, filePath) {
  return {
    id: entry.id,
    title: entry.title ?? titleCase(path.basename(entry.filename, path.extname(entry.filename))),
    author: entry.author ?? null,
    format: entry.format ?? formatOf(entry.filename),
    filename: entry.filename,
    max_score: Number.isInteger(entry.max_score) ? entry.max_score : null,
    difficulty: entry.difficulty ?? null,
    suggested_turn_limit: Number.isInteger(entry.suggested_turn_limit) ? entry.suggested_turn_limit : null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    description: entry.description ?? null,
    license: entry.license ?? null,
    available: Boolean(filePath),
  };
}

export class GameLibrary {
  /** @param {string} gamesDir */
  constructor(gamesDir) {
    this.gamesDir = gamesDir;
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
        if (e.isFile() && FORMATS[path.extname(e.name).toLowerCase()]) {
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
      out.push({ game: toGame({ ...entry, id }, p), path: p });
    }

    for (const f of this._scanFiles().sort((a, b) => a.filename.localeCompare(b.filename))) {
      if (listedFiles.has(f.filename)) continue;
      const id = slugify(path.basename(f.filename, path.extname(f.filename)));
      if (ids.has(id)) continue;
      ids.add(id);
      listedFiles.add(f.filename);
      out.push({ game: toGame({ id, filename: f.filename }, f.path), path: f.path });
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
}
