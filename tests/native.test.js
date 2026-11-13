// Original games on the built-in engine, played end to end through the REST API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { testServer, ROOT } from './helpers.js';

let s;
before(async () => { s = await testServer(); });
after(async () => { await s.close(); });

// Held-out games are sealed: playable only with GRUE_GAMES_KEY, and their walkthroughs live in the private
// games checkout (GRUE_PRIVATE_DIR). Without both, their walkthrough test is skipped.
const PRIVATE_DIR = process.env.GRUE_PRIVATE_DIR;
const hasKey = Boolean(process.env.GRUE_GAMES_KEY);

function walkthroughFile(id) {
  const pub = path.join(ROOT, 'games', 'src', id, 'walkthrough.txt');
  if (fs.existsSync(pub)) return pub;
  const priv = PRIVATE_DIR ? path.join(PRIVATE_DIR, id, 'walkthrough.txt') : null;
  return priv && fs.existsSync(priv) ? priv : null;
}

function walkthrough(id) {
  return fs.readFileSync(walkthroughFile(id), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

test('native games are listed with format "native"; held-out ones are private', async () => {
  const { json } = await s.get('/api/games');
  for (const id of ['lantern-lane', 'skerrin-light']) {
    const g = json.games.find((x) => x.id === id);
    assert.ok(g, `${id} listed`);
    assert.equal(g.format, 'native');
  }
  const lane = json.games.find((x) => x.id === 'lantern-lane');
  const skerrin = json.games.find((x) => x.id === 'skerrin-light');
  assert.equal(lane.available, true);
  assert.equal(lane.private, false);
  assert.equal(skerrin.private, true);
  assert.equal(skerrin.available, hasKey, 'a sealed game is playable only with the key');
  // A native game appears once, not also as an auto-scanned duplicate.
  assert.equal(json.games.filter((g) => g.filename.endsWith('lantern-lane.js')).length, 1);
  assert.equal(json.games.filter((g) => g.filename.startsWith('skerrin-light')).length, 1);
});

for (const [id, max] of [['lantern-lane', 10], ['skerrin-light', 50]]) {
  const skip = !walkthroughFile(id) || (id !== 'lantern-lane' && !hasKey) ? 'needs GRUE_PRIVATE_DIR and GRUE_GAMES_KEY' : false;
  test(`${id}: walkthrough wins with full score via REST`, { skip }, async () => {
    const first = await s.start(id, { meta: { agent: 'test' } });
    assert.equal(first.input_type, 'line');
    assert.ok(first.location, 'location parsed from status line');
    assert.equal(first.score, 0);
    assert.equal(first.max_score, max);

    let obs = first;
    for (const cmd of walkthrough(id)) {
      assert.equal(obs.game_over, false, `game ended early before "${cmd}"`);
      obs = await s.cmd(first.session_id, cmd);
    }
    assert.equal(obs.game_over, true);
    assert.equal(obs.ending, 'won');
    assert.equal(obs.score, max);
    assert.equal(obs.input_type, null);

    const r = await s.get(`/api/results/${first.session_id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.ending, 'won');
    assert.equal(r.json.max_score_reached, max);
    assert.equal(r.json.invalid_commands, 0);
    assert.ok(r.json.unique_locations >= 4);
  });
}

test('native game: invalid commands counted, quit ends with "quit"', async () => {
  const o = await s.start('lantern-lane');
  const bad = await s.cmd(o.session_id, 'frobnicate the wombat');
  assert.match(bad.text, /not a verb I recognise/);
  await s.cmd(o.session_id, 'quit');
  const end = await s.cmd(o.session_id, 'y');
  assert.equal(end.game_over, true);
  assert.equal(end.ending, 'quit');
  const r = await s.get(`/api/results/${o.session_id}`);
  assert.equal(r.json.invalid_commands, 1);
  const again = await s.post(`/api/sessions/${o.session_id}/commands`, { command: 'look' });
  assert.equal(again.status, 409);
});
