/**
 * Game Library — Scans the games directory for playable Glulx files.
 */

import fs from 'fs';
import path from 'path';

const SUPPORTED_EXTENSIONS = new Set(['.ulx', '.gblorb']);

/**
 * Scans the given directory for supported game files.
 * @param {string} gamesDir — Absolute path to the games directory.
 * @returns {{ id: number, name: string, filename: string, path: string }[]}
 */
export function scanGameLibrary(gamesDir) {
  if (!fs.existsSync(gamesDir)) {
    console.warn(`[GameLibrary] Games directory not found: ${gamesDir}`);
    return [];
  }

  const entries = fs.readdirSync(gamesDir, { withFileTypes: true });
  const games = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const basename = path.basename(entry.name, ext);
    const name = basename
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    games.push({
      id: games.length + 1,
      name,
      filename: entry.name,
      path: path.join(gamesDir, entry.name),
    });
  }

  console.log(`[GameLibrary] Found ${games.length} game(s) in ${gamesDir}`);
  return games;
}

/**
 * Formats the game library as a numbered text menu.
 * @param {{ id: number, name: string }[]} games
 * @returns {string}
 */
export function formatGameList(games) {
  if (games.length === 0) {
    return 'No games are currently available. Add .ulx or .gblorb files to the games/ directory.\n';
  }

  const lines = ['Available Games:', ''];
  for (const game of games) {
    lines.push(`  ${game.id}. ${game.name}`);
  }
  lines.push('', 'Enter a game number to begin: ');
  return lines.join('\n');
}
