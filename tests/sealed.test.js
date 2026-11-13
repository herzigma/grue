// Sealed held-out games: encryption, loading, and the rule that their transcripts are never served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseKey, seal, unseal } from '../lib/sealed.js';
import { GameLibrary } from '../lib/gameLibrary.js';
import { loadNativeGame } from '../lib/native/index.js';
import { testServer, ROOT } from './helpers.js';

const KEY = crypto.randomBytes(32);
const LANE = path.join(ROOT, 'games', 'original', 'lantern-lane.js');
const WALK = fs.readFileSync(path.join(ROOT, 'games', 'src', 'lantern-lane', 'walkthrough.txt'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** A games dir holding Lantern Lane sealed as a private game "held-out", plus a public copy "open-lane". */
function sealedGamesDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-sealed-'));
  fs.mkdirSync(path.join(dir, 'sealed'));
  fs.mkdirSync(path.join(dir, 'original'));
  fs.writeFileSync(path.join(dir, 'sealed', 'held-out.js.enc'), seal(fs.readFileSync(LANE), KEY));
  fs.copyFileSync(LANE, path.join(dir, 'original', 'open-lane.js'));
  fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify([
    { id: 'held-out', filename: 'held-out.js.enc', max_score: 10, tags: ['original', 'private'] },
    { id: 'open-lane', filename: 'original/open-lane.js', max_score: 10, tags: ['original'] },
  ]));
  return dir;
}

test('sealed: key parsing, round trip, tamper and wrong-key detection', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey(undefined), null);
  assert.deepEqual(parseKey(KEY.toString('base64')), KEY);
  assert.deepEqual(parseKey(KEY.toString('hex')), KEY);
  assert.throws(() => parseKey('dG9vIHNob3J0'), /32 bytes/);

  const sealed = seal('export default 1;', KEY);
  assert.match(sealed, /^grue-sealed-v1:/);
  assert.ok(!sealed.includes('export default'));
  assert.equal(unseal(sealed, KEY).toString(), 'export default 1;');
  assert.notEqual(seal('same', KEY), seal('same', KEY), 'a fresh IV each time');
  assert.throws(() => unseal(sealed, crypto.randomBytes(32)), /wrong GRUE_GAMES_KEY/);
  const parts = sealed.trim().split(':');
  const ct = Buffer.from(parts[3], 'base64');
  ct[0] ^= 1;
  assert.throws(() => unseal([...parts.slice(0, 3), ct.toString('base64')].join(':'), KEY), /wrong GRUE_GAMES_KEY or a damaged/);
  assert.throws(() => unseal(sealed, null), /no GRUE_GAMES_KEY/);
  assert.throws(() => unseal('plain text', KEY), /Not a sealed/);
});

test('sealed: the library lists sealed games as private, available only with the key', async () => {
  const dir = sealedGamesDir();
  const withKey = Object.fromEntries(new GameLibrary(dir, { sealedKey: KEY }).list().map((g) => [g.id, g]));
  const noKey = Object.fromEntries(new GameLibrary(dir).list().map((g) => [g.id, g]));
  assert.equal(withKey['held-out'].format, 'native');
  assert.equal(withKey['held-out'].private, true);
  assert.equal(withKey['held-out'].available, true);
  assert.equal(noKey['held-out'].available, false);
  assert.equal(withKey['open-lane'].private, false);
  assert.equal(Object.keys(withKey).length, 2, 'the sealed file is not listed twice');

  const game = await loadNativeGame(path.join(dir, 'sealed', 'held-out.js.enc'), { key: KEY });
  assert.match(game.start().text, /Lantern/);
  await assert.rejects(loadNativeGame(path.join(dir, 'sealed', 'held-out.js.enc')), /no GRUE_GAMES_KEY/);
});

test('sealed: a private game plays normally, but its transcript is never served', async () => {
  const dir = sealedGamesDir();
  const s = await testServer({ GAMES_DIR: dir, GAMES_KEY: KEY.toString('base64') });
  try {
    const first = await s.start('held-out', { meta: { agent: 'test' } });
    let obs = first;
    for (const cmd of WALK) obs = await s.cmd(first.session_id, cmd);
    assert.equal(obs.ending, 'won');
    assert.equal(obs.score, 10);

    const one = await s.get(`/api/results/${first.session_id}`);
    assert.equal(one.status, 200);
    assert.equal(one.json.score, 10, 'the score is public');
    assert.equal(one.json.transcript, null);
    assert.equal(one.json.transcript_private, true);
    const listed = (await s.get('/api/results')).json.results.find((r) => r.session_id === first.session_id);
    assert.equal(listed.transcript, null);
    const tr = await s.get(`/api/results/${first.session_id}/transcript`);
    assert.equal(tr.status, 403);
    assert.equal(tr.json.error, 'private_game');
    const csv = await s.get('/api/export.csv');
    assert.ok(csv.text.includes(first.session_id), 'private runs are still in the export');

    // A public game's transcript is still served.
    const open = await s.start('open-lane');
    await s.cmd(open.session_id, 'look');
    await s.del(`/api/sessions/${open.session_id}`);
    assert.equal((await s.get(`/api/results/${open.session_id}/transcript`)).status, 200);
  } finally {
    await s.close();
  }
});

test('sealed: without the key a sealed game cannot be started', async () => {
  const s = await testServer({ GAMES_DIR: sealedGamesDir(), GAMES_KEY: '' });
  try {
    const r = await s.post('/api/sessions', { game: 'held-out' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'game_unavailable');
  } finally {
    await s.close();
  }
});
