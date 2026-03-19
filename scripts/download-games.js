#!/usr/bin/env node

/**
 * download-games.js — Downloads game files listed in games/games.json.
 *
 * Skips any files already present in the games/ directory.
 * Uses only Node.js built-ins (no extra dependencies).
 *
 * Usage:  node scripts/download-games.js
 *    or:  npm run setup
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const GAMES_DIR = path.join(ROOT, 'games');
const MANIFEST_PATH = path.join(GAMES_DIR, 'games.json');

// ── Helpers ──

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (res) => {
      // Follow redirects (3xx)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, destPath).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }

      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => {
        fs.unlink(destPath, () => {}); // clean up partial file
        reject(err);
      });
    }).on('error', reject);
  });
}

// ── Main ──

async function main() {
  console.log('');
  console.log('  📦  Grue — Game Downloader');
  console.log('');

  // Read manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`  ❌  Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

  if (manifest.length === 0) {
    console.log('  No games listed in games.json.');
    return;
  }

  console.log(`  Found ${manifest.length} game(s) in manifest.\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of manifest) {
    const destPath = path.join(GAMES_DIR, entry.filename);

    if (fs.existsSync(destPath)) {
      console.log(`  ✔  ${entry.filename} (already exists)`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ⬇  ${entry.filename} ... `);

    try {
      await download(entry.url, destPath);
      console.log('done');
      downloaded++;
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      failed++;
    }
  }

  // Summary
  console.log('');
  console.log(`  Summary: ${downloaded} downloaded, ${skipped} already present, ${failed} failed`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

main();
