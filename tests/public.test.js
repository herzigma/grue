// Public website support: read-only endpoints without a key, static files, featured result collections.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { testServer } from './helpers.js';
import { publicFile } from '../lib/httpApi.js';

const KEY = 'test-key-public';
const SID = '11111111-2222-4333-8444-555555555555';
let s;
let featuredDir;

before(async () => {
  featuredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-featured-'));
  const c = path.join(featuredDir, 'demo-collection');
  fs.mkdirSync(path.join(c, 'results'), { recursive: true });
  fs.mkdirSync(path.join(c, 'replays'), { recursive: true });
  fs.writeFileSync(path.join(c, 'results', `${SID}.json`), JSON.stringify({
    session_id: SID, game_id: 'lantern-lane', started_at: '2026-11-13T00:00:00Z', ended_at: '2026-11-13T00:05:00Z',
    turn: 2, score: 10, max_score: 10, ending: 'won', meta: { model: 'demo' }, transcript: `replays/lantern-lane_${SID}.jsonl`,
  }));
  fs.writeFileSync(path.join(c, 'replays', `lantern-lane_${SID}.jsonl`),
    '{"type":"command","turn":1,"text":"look"}\n{"type":"output","turn":1,"text":"A lane."}\n');
  s = await testServer({ API_KEYS: [KEY], FEATURED_DIR: featuredDir });
});
after(async () => { await s.close(); });

test('catalog and results are readable without a key; sessions still need one', async () => {
  assert.equal((await s.get('/api/games')).status, 200);
  assert.equal((await s.get('/api/results')).status, 200);
  assert.equal((await s.get('/api/sessions')).status, 401);
  assert.equal((await s.post('/api/sessions', { game: 'lantern-lane' })).status, 401);
  const ok = await s.post('/api/sessions', { game: 'lantern-lane' }, { Authorization: `Bearer ${KEY}` });
  assert.equal(ok.status, 201);
  await s.del(`/api/sessions/${ok.json.session_id}`, { Authorization: `Bearer ${KEY}` });
});

test('featured collections are listed, tagged, and have transcripts', async () => {
  const list = await s.get('/api/results');
  const r = list.json.results.find((x) => x.session_id === SID);
  assert.ok(r, 'featured result listed');
  assert.equal(r.collection, 'demo-collection');
  assert.equal((await s.get(`/api/results/${SID}`)).json.ending, 'won');
  const t = await s.get(`/api/results/${SID}/transcript`);
  assert.equal(t.status, 200);
  assert.equal(t.json.entries.length, 2);
  // filtering by game still works with featured results
  assert.ok((await s.get('/api/results?game=lantern-lane')).json.results.some((x) => x.session_id === SID));
});

test('PUBLIC_READ=false keeps everything behind the key', async () => {
  const closed = await testServer({ API_KEYS: [KEY], PUBLIC_READ: false });
  try {
    assert.equal((await closed.get('/api/games')).status, 401);
    assert.equal((await closed.get('/api/results')).status, 401);
    assert.equal((await closed.get('/api/games', { Authorization: `Bearer ${KEY}` })).status, 200);
  } finally {
    await closed.close();
  }
});

test('static files: allowed types only, no traversal', async () => {
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-public-'));
  fs.mkdirSync(path.join(pub, 'featured'));
  fs.writeFileSync(path.join(pub, 'featured', 'x.json'), '{}');
  fs.writeFileSync(path.join(pub, 'secret.js'), 'nope');
  assert.equal(publicFile(pub, '/featured/x.json'), path.join(pub, 'featured', 'x.json'));
  assert.equal(publicFile(pub, '/secret.js'), null, 'unlisted extension');
  assert.equal(publicFile(pub, '/../package.json'), null);
  assert.equal(publicFile(pub, '/%2e%2e/%2e%2e/etc/passwd.json'), null);
  assert.equal(publicFile(pub, '/featured/missing.json'), null);
  assert.equal(publicFile(pub, '/x%00.json'), null);

  const res = await s.get('/featured/2026-11.json');
  if (fs.existsSync(path.join(process.cwd(), 'public', 'featured', '2026-11.json'))) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
  }
  assert.equal((await s.get('/../config.js')).status, 404);
});

test('harness test runs (mock:, human:, probe) are hidden from listings but fetchable by id', async () => {
  const auth = { Authorization: `Bearer ${KEY}` };
  const o = await s.post('/api/sessions', { game: 'lantern-lane', meta: { model: 'mock:walkthrough.txt' } }, auth);
  assert.equal(o.status, 201);
  const sid = o.json.session_id;
  await s.del(`/api/sessions/${sid}`, auth);
  const listed = (await s.get('/api/results')).json.results.map((r) => r.session_id);
  assert.ok(!listed.includes(sid), 'mock run hidden from the public list');
  assert.equal((await s.get(`/api/results/${sid}`)).status, 200, 'still fetchable by id');
  const all = (await s.get('/api/results?include_tests=1')).json.results.map((r) => r.session_id);
  assert.ok(all.includes(sid), 'include_tests=1 shows it');
});
