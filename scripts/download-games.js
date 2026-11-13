#!/usr/bin/env node

/**
 * download-games.js -- fetch the story files listed in games/games.json (`npm run setup`).
 *
 * - Entries without a `url` (e.g. original games committed under games/original/) are skipped.
 * - Files already present are kept; if the manifest has a `sha256`, they are verified.
 * - Downloads go to a temp file, are verified against `sha256` when present, then moved into place.
 *
 * Node built-ins only. Exits non-zero if any download or checksum fails.
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES_DIR = process.env.GAMES_DIR || path.join(ROOT, 'games');
const MANIFEST_PATH = path.join(GAMES_DIR, 'games.json');
const MAX_REDIRECTS = 5;

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: 60_000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'));
        return download(new URL(res.headers.location, url).href, destPath, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
      res.on('error', reject);
      return undefined;
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function main() {
  console.log('\nGrue game downloader\n');

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const counts = { downloaded: 0, present: 0, skipped: 0, failed: 0 };

  for (const entry of manifest) {
    const name = entry.filename;
    if (!name) continue;
    if (!entry.url) {
      console.log(`  -  ${name} (no url; not downloadable)`);
      counts.skipped++;
      continue;
    }
    const dest = path.join(GAMES_DIR, name);

    if (fs.existsSync(dest)) {
      if (entry.sha256 && sha256Of(dest) !== entry.sha256.toLowerCase()) {
        console.log(`  !  ${name} exists but its sha256 does not match the manifest (delete it to re-download)`);
        counts.failed++;
      } else {
        console.log(`  ok ${name} (already present${entry.sha256 ? ', checksum ok' : ''})`);
        counts.present++;
      }
      continue;
    }

    process.stdout.write(`  v  ${name} ... `);
    const tmp = `${dest}.download`;
    try {
      await download(entry.url, tmp);
      if (entry.sha256) {
        const actual = sha256Of(tmp);
        if (actual !== entry.sha256.toLowerCase()) {
          throw new Error(`sha256 mismatch (expected ${entry.sha256}, got ${actual})`);
        }
      }
      fs.renameSync(tmp, dest);
      console.log('done');
      counts.downloaded++;
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      console.log(`FAILED (${err.message})`);
      counts.failed++;
    }
  }

  console.log(`\n  ${counts.downloaded} downloaded, ${counts.present} already present, ${counts.skipped} skipped, ${counts.failed} failed\n`);
  if (counts.failed > 0) process.exit(1);
}

main();
