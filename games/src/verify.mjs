// Runs each original game's walkthrough through the native engine and checks the result.
// Usage: node games/src/verify.mjs
//
// Public games live here (games/original + games/src/<id>/walkthrough.txt). Held-out games are checked too when
// GRUE_PRIVATE_DIR points at the private games checkout (<id>/<id>.js and <id>/walkthrough.txt there).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../config.js'; // loads .env (GRUE_PRIVATE_DIR)
import { loadNativeGame } from '../../lib/native/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function privateGames() {
  const dir = process.env.GRUE_PRIVATE_DIR;
  if (!dir || !fs.existsSync(dir)) return [];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'games', 'games.json'), 'utf8'));
  return fs.readdirSync(dir)
    .filter((id) => fs.existsSync(path.join(dir, id, `${id}.js`)) && fs.existsSync(path.join(dir, id, 'walkthrough.txt')))
    .map((id) => ({
      id,
      file: path.join(dir, id, `${id}.js`),
      walkthrough: path.join(dir, id, 'walkthrough.txt'),
      maxScore: manifest.find((g) => g.id === id)?.max_score ?? null,
    }));
}

export const GAMES = [
  { id: 'lantern-lane', file: 'games/original/lantern-lane.js', walkthrough: path.join(here, 'lantern-lane', 'walkthrough.txt'), maxScore: 10 },
  ...privateGames(),
];

const FAILURES = [
  /That's not a verb I recognise/,
  /You can't see any such thing/,
  /I didn't understand that sentence/,
  /I beg your pardon/,
  /I only understood you as far as/,
  /Which do you mean/,
  /What do you want to/,
  /\[Internal error/,
  /It is pitch dark, and you can't see a thing/,
];

export async function runWalkthrough(entry) {
  const game = await loadNativeGame(path.resolve(root, entry.file));
  const lines = fs.readFileSync(entry.walkthrough, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const problems = [];
  let obs = game.start();
  let n = 0;
  for (const cmd of lines) {
    if (obs.ended) { problems.push(`game ended before command "${cmd}"`); break; }
    obs = game.send(cmd);
    n++;
    for (const re of FAILURES) if (re.test(obs.text)) problems.push(`command ${n} "${cmd}": ${re} in output`);
  }
  if (!obs.text.includes('*** You have won ***')) problems.push('no "*** You have won ***" in final output');
  if (obs.ending !== 'won') problems.push(`ending is ${obs.ending}, expected won`);
  if (obs.score !== entry.maxScore) problems.push(`final score ${obs.score} != max ${entry.maxScore}`);
  if (game.spec.maxScore !== entry.maxScore) problems.push(`spec.maxScore ${game.spec.maxScore} != ${entry.maxScore}`);
  return { commands: n, score: obs.score, moves: obs.moves, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0;
  for (const entry of GAMES) {
    const r = await runWalkthrough(entry);
    const ok = r.problems.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${entry.id}: ${r.commands} commands, ${r.moves} moves, score ${r.score}/${entry.maxScore}`);
    for (const p of r.problems) console.log(`  - ${p}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}
