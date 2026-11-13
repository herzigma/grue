// Runs each original game's walkthrough through the native engine and checks the result.
// Usage: node games/src/verify.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNativeGame } from '../../lib/native/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export const GAMES = [
  { id: 'lantern-lane', file: 'games/original/lantern-lane.js', maxScore: 10 },
  { id: 'skerrin-light', file: 'games/original/skerrin-light.js', maxScore: 50 },
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
  const game = await loadNativeGame(path.join(root, entry.file));
  const lines = fs.readFileSync(path.join(here, entry.id, 'walkthrough.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
