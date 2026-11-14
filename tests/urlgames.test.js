// Games loaded from a URL: host/scheme checks, format sniffing, size and hash limits, unranked results.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { testServer, hasZork, ROOT, waitUntil } from './helpers.js';
import { checkGameUrl, detectFormat, hostAllowed, parseHosts } from '../lib/urlGames.js';

const HOSTS = parseHosts('ifarchive.org,githubusercontent.com');
const ZORK = hasZork ? fs.readFileSync(path.join(ROOT, 'games', 'zork1.z3')) : null;
const ZORK_SHA = ZORK ? crypto.createHash('sha256').update(ZORK).digest('hex') : null;
const GOOD = 'https://www.ifarchive.org/if-archive/games/zcode/zork1.z3';

test('hosts: listed domains and their subdomains only; "off" disables', () => {
  assert.deepEqual(parseHosts(' IFArchive.org , .github.com. '), ['ifarchive.org', 'github.com']);
  assert.deepEqual(parseHosts('off'), []);
  assert.ok(hostAllowed('ifarchive.org', HOSTS));
  assert.ok(hostAllowed('www.ifarchive.org', HOSTS));
  assert.ok(hostAllowed('raw.githubusercontent.com', HOSTS));
  assert.ok(!hostAllowed('evilifarchive.org', HOSTS));
  assert.ok(!hostAllowed('ifarchive.org.evil.com', HOSTS));
});

test('URL checks: https, default port, no credentials, allowed host', () => {
  assert.equal(checkGameUrl(GOOD, HOSTS).hostname, 'www.ifarchive.org');
  const bad = (u, re) => assert.throws(() => checkGameUrl(u, HOSTS), (e) => e.code === 'game_url_rejected' && re.test(e.message));
  bad('http://ifarchive.org/x.z5', /https/);
  bad('https://ifarchive.org:8443/x.z5', /port/);
  bad('https://u:p@ifarchive.org/x.z5', /credentials/);
  bad('https://169.254.169.254/latest', /not allowed/);
  bad('https://localhost/x.z5', /not allowed/);
  bad('file:///etc/passwd', /https/);
  bad('not a url', /valid URL/);
});

test('format sniffing: Z-code 3/4/5/8, Glulx, Blorb; nothing else', () => {
  const z = (v) => {
    const b = Buffer.alloc(1024);
    b[0] = v; b.writeUInt16BE(512, 4); b.writeUInt16BE(600, 6);
    return b;
  };
  assert.deepEqual(detectFormat(z(5)), { format: 'zcode', ext: '.z5' });
  assert.deepEqual(detectFormat(z(8)), { format: 'zcode', ext: '.z8' });
  assert.equal(detectFormat(z(6)), null, 'V6 is not supported by the interpreter');
  assert.equal(detectFormat(z(7)), null);
  const glulx = Buffer.alloc(128); glulx.write('Glul', 0, 'latin1');
  assert.deepEqual(detectFormat(glulx), { format: 'glulx', ext: '.ulx' });
  const blorb = (exec) => {
    const body = Buffer.alloc(200);
    body.write('RIdx', 0, 'latin1'); body.writeUInt32BE(4, 4); // empty-ish index chunk
    body.write(exec, 12, 'latin1'); body.writeUInt32BE(100, 16); body[20] = 5;
    const head = Buffer.alloc(12);
    head.write('FORM', 0, 'latin1'); head.writeUInt32BE(4 + body.length, 4); head.write('IFRS', 8, 'latin1');
    return Buffer.concat([head, body]);
  };
  assert.deepEqual(detectFormat(blorb('GLUL')), { format: 'glulx', ext: '.gblorb' });
  assert.deepEqual(detectFormat(blorb('ZCOD')), { format: 'zcode', ext: '.zblorb' });
  assert.equal(detectFormat(blorb('PNG ')), null);
  assert.equal(detectFormat(Buffer.from('<!doctype html><html>'.padEnd(200, ' '))), null);
  assert.equal(detectFormat(Buffer.from('export default { rooms: {} };'.padEnd(200, ' '))), null, 'native JS games are never loaded');
  assert.equal(detectFormat(Buffer.alloc(10)), null);
  if (ZORK) assert.deepEqual(detectFormat(ZORK), { format: 'zcode', ext: '.z3' });
});

// A fake fetch: serves `routes` (url -> Response factory) and counts calls.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    return r();
  };
  fn.calls = calls;
  return fn;
}

let s;
let fetchImpl;
let cacheDir;
before(async () => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-url-cache-test-'));
  fetchImpl = fakeFetch({
    [GOOD]: () => new Response(ZORK ?? Buffer.alloc(100), { status: 200 }),
    'https://ifarchive.org/moved.z3': () => new Response(null, { status: 302, headers: { location: GOOD } }),
    'https://ifarchive.org/escape.z3': () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x.z3' } }),
    'https://ifarchive.org/big.z5': () => new Response(Buffer.alloc(200_000), { status: 200 }),
    'https://ifarchive.org/page.html': () => new Response('<html>'.padEnd(500, ' '), { status: 200 }),
  });
  s = await testServer({
    GAME_URL_HOSTS: 'ifarchive.org', GAME_URL_FETCH: fetchImpl, GAME_URL_CACHE_DIR: cacheDir,
    GAME_URL_MAX_BYTES: ZORK ? ZORK.length + 10 : 1000, GAME_URL_TIMEOUT_MS: 5000, GAME_URL_CACHE_FILES: 8,
  });
});
after(async () => { await s.close(); });

test('request shape: exactly one of game / game_url; sha256 only with game_url', async () => {
  const both = await s.post('/api/sessions', { game: 'zork1', game_url: GOOD });
  assert.equal(both.status, 400);
  assert.equal(both.json.error, 'bad_request');
  assert.equal((await s.post('/api/sessions', {})).status, 400);
  assert.equal((await s.post('/api/sessions', { game: 'zork1', sha256: 'a'.repeat(64) })).status, 400);
  const badSha = await s.post('/api/sessions', { game_url: GOOD, sha256: 'xyz' });
  assert.equal(badSha.json.error, 'game_url_rejected');
});

test('rejected and failed fetches', async () => {
  const err = async (body) => (await s.post('/api/sessions', body)).json;
  assert.equal((await err({ game_url: 'https://example.com/x.z5' })).error, 'game_url_rejected');
  assert.match((await err({ game_url: 'https://ifarchive.org/escape.z3' })).message, /not allowed/, 'redirects are checked too');
  assert.match((await err({ game_url: 'https://ifarchive.org/big.z5' })).message, /larger than/);
  assert.match((await err({ game_url: 'https://ifarchive.org/page.html' })).message, /not a story/);
  const missing = await s.post('/api/sessions', { game_url: 'https://ifarchive.org/missing.z5' });
  assert.equal(missing.status, 502);
  assert.equal(missing.json.error, 'game_url_failed');
});

test('URL games can be switched off', async () => {
  const off = await testServer({ GAME_URL_HOSTS: 'off', GAME_URL_FETCH: fetchImpl });
  try {
    const r = await off.post('/api/sessions', { game_url: GOOD });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /does not load games from URLs/);
  } finally { await off.close(); }
});

test('a URL game plays, is unranked, hidden from listings, and in the export on request', { skip: !hasZork && 'needs games/zork1.z3' }, async () => {
  const o = await s.post('/api/sessions', { game_url: 'https://ifarchive.org/moved.z3', sha256: ZORK_SHA, meta: { model: 'test:url' } });
  assert.equal(o.status, 201, o.text);
  assert.equal(o.json.game_id, `url-${ZORK_SHA.slice(0, 12)}`);
  assert.match(o.json.text, /ZORK/);
  const sid = o.json.session_id;
  const dir = s.manager.get(sid).workDir;
  assert.ok(dir && fs.existsSync(dir), 'the story runs in its own directory');
  assert.equal((await s.cmd(sid, 'open mailbox')).turn, 1);

  const result = (await s.del(`/api/sessions/${sid}`)).json;
  assert.equal(result.unranked, true);
  assert.equal(result.game_url, 'https://ifarchive.org/moved.z3', 'the URL as requested');
  assert.equal(result.game_sha256, ZORK_SHA);
  assert.ok(await waitUntil(() => !fs.existsSync(dir), 5000), 'the session directory is removed');

  const listed = (await s.get('/api/results')).json.results.map((r) => r.session_id);
  assert.ok(!listed.includes(sid), 'hidden from the default listing');
  assert.ok((await s.get('/api/results?include_unranked=1')).json.results.some((r) => r.session_id === sid));
  assert.equal((await s.get(`/api/results/${sid}`)).status, 200, 'fetchable by id');
  assert.equal((await s.get(`/api/results/${sid}/transcript`)).status, 200);

  assert.ok(!(await s.get('/api/export.jsonl')).text.includes(sid));
  const rows = (await s.get('/api/export.jsonl?include_unranked=1')).text.trim().split('\n').map((l) => JSON.parse(l));
  const row = rows.find((r) => r.session_id === sid);
  assert.equal(row.unranked, true);
  assert.equal(row.game_sha256, ZORK_SHA);
  assert.equal(row.game_url, 'https://ifarchive.org/moved.z3');
});

test('downloads are cached: same URL or same sha256 does not fetch again', { skip: !hasZork && 'needs games/zork1.z3' }, async () => {
  const before = fetchImpl.calls.length;
  for (const body of [{ game_url: GOOD }, { game_url: 'https://ifarchive.org/moved.z3', sha256: ZORK_SHA }]) {
    const o = await s.post('/api/sessions', body);
    assert.equal(o.status, 201, o.text);
    await s.del(`/api/sessions/${o.json.session_id}`);
  }
  assert.equal(fetchImpl.calls.length, before, 'served from the cache');
  const wrong = await s.post('/api/sessions', { game_url: GOOD, sha256: 'b'.repeat(64) });
  assert.equal(wrong.json.error, 'game_url_rejected');
  assert.match(wrong.json.message, /not the "sha256" you sent/);
});
