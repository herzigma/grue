#!/usr/bin/env node
// Seal (encrypt) held-out games into games/sealed/ so they can ship in this public repo unreadable.
//
//   node scripts/seal-game.mjs path/to/my-game.js [...]   seal these files
//   node scripts/seal-game.mjs --all                       seal every <id>/<id>.js under GRUE_PRIVATE_DIR
//
// The key is GRUE_GAMES_KEY (from the environment or .env). A game whose sealed file already decrypts to
// the same source is left untouched, so re-running does not churn the repo. See lib/sealed.js.
import fs from 'node:fs';
import path from 'node:path';
import cfg, { ROOT } from '../config.js';
import { parseKey, seal, unseal } from '../lib/sealed.js';

const key = parseKey(cfg.GAMES_KEY);
if (!key) {
  console.error('GRUE_GAMES_KEY is not set (environment or .env).');
  process.exit(1);
}

let files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (process.argv.includes('--all')) {
  const dir = process.env.GRUE_PRIVATE_DIR;
  if (!dir) { console.error('--all needs GRUE_PRIVATE_DIR (the private games checkout).'); process.exit(1); }
  for (const id of fs.readdirSync(dir)) {
    const f = path.join(dir, id, `${id}.js`);
    if (fs.existsSync(f)) files.push(f);
  }
}
if (!files.length) {
  console.error('Usage: node scripts/seal-game.mjs <game.js> [...] | --all');
  process.exit(1);
}

const outDir = path.join(ROOT, 'games', 'sealed');
fs.mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const src = fs.readFileSync(f);
  const out = path.join(outDir, `${path.basename(f)}.enc`);
  let same = false;
  try { same = unseal(fs.readFileSync(out, 'utf8'), key).equals(src); } catch { /* absent or another key */ }
  if (same) { console.log(`unchanged ${path.relative(ROOT, out)}`); continue; }
  fs.writeFileSync(out, seal(src, key));
  console.log(`sealed    ${path.relative(ROOT, out)}`);
}
