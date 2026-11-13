import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { testServer, WsClient, waitUntil } from './helpers.js';
import config from '../config.js';
import { exposureWarning } from '../index.js';
import { ResultStore } from '../lib/sessionManager.js';

const GAME = 'lantern-lane'; // built-in native game: no interpreter process, always installed

/** Open a raw TCP connection that records what the server sends and whether it closed. */
async function rawConnect(port) {
  const sock = net.connect(port, '127.0.0.1');
  const c = { sock, buf: '', closed: false };
  sock.setEncoding('utf8');
  sock.on('data', (d) => { c.buf += d; });
  sock.on('close', () => { c.closed = true; });
  sock.on('error', () => { c.closed = true; });
  await new Promise((r) => sock.once('connect', r));
  return c;
}

// -- request bodies --------------------------------------------------------------------------------

test('non-object JSON bodies are 400 bad_request on every endpoint that reads a body', async () => {
  const s = await testServer();
  try {
    const { session_id: id } = await s.start(GAME);
    for (const body of ['null', '[]', '[1,2]', '42', '"text"', 'true']) {
      const create = await s.post('/api/sessions', body);
      assert.equal(create.status, 400, `create with ${body}`);
      assert.equal(create.json.error, 'bad_request');
      const command = await s.post(`/api/sessions/${id}/commands`, body);
      assert.equal(command.status, 400, `command with ${body}`);
      assert.equal(command.json.error, 'bad_request');
    }
    assert.equal((await s.post(`/api/sessions/${id}/commands`, '{"command":"look"}')).status, 200);
    assert.equal((await s.post(`/api/sessions/${id}/commands`, '{not json')).status, 400);
    // an empty body is still "{}" (so "command is required"), not a crash
    assert.equal((await s.post(`/api/sessions/${id}/commands`, '')).status, 400);
  } finally {
    await s.close();
  }
});

test('oversized body: 413 right away and the connection is closed, not drained until timeout', async () => {
  const s = await testServer();
  try {
    // Promise 10 MB but send almost none of it: a server that waits for the body would hang here.
    const declared = await rawConnect(s.httpPort);
    declared.sock.write('POST /api/sessions HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 10000000\r\n\r\n{"game":');
    assert.ok(await waitUntil(() => /^HTTP\/1\.1 413 /.test(declared.buf), 1500), `got ${JSON.stringify(declared.buf.slice(0, 80))}`);
    assert.match(declared.buf, /connection: close/i);
    assert.ok(await waitUntil(() => declared.closed, 3000), 'connection closed by the server');
    declared.sock.destroy();

    // streamed overflow without a Content-Length (chunked) is cut off the same way
    const chunked = await rawConnect(s.httpPort);
    chunked.sock.write('POST /api/sessions HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n');
    const piece = 'a'.repeat(16 * 1024);
    for (let i = 0; i < 6; i++) chunked.sock.write(`${piece.length.toString(16)}\r\n${piece}\r\n`);
    assert.ok(await waitUntil(() => /^HTTP\/1\.1 413 /.test(chunked.buf), 1500));
    assert.ok(await waitUntil(() => chunked.closed, 3000));
    chunked.sock.destroy();
  } finally {
    await s.close();
  }
});

// -- keep-alive ------------------------------------------------------------------------------------

test('keep-alive outlives a 5 s think time; headersTimeout stays above it', async () => {
  const s = await testServer();
  try {
    assert.equal(s.httpServer.keepAliveTimeout, 65_000);
    assert.ok(s.httpServer.headersTimeout > s.httpServer.keepAliveTimeout);
  } finally {
    await s.close();
  }
});

// -- exposure --------------------------------------------------------------------------------------

test('HOST defaults to loopback', () => {
  if (!process.env.HOST) assert.equal(config.HOST, '127.0.0.1');
});

test('startup warning only for a non-loopback bind without API keys', () => {
  assert.match(exposureWarning({ HOST: '0.0.0.0', API_KEYS: [] }), /WARNING.*0\.0\.0\.0.*GRUE_API_KEYS/);
  assert.match(exposureWarning({ HOST: '192.168.1.5', API_KEYS: [] }), /WARNING/);
  assert.equal(exposureWarning({ HOST: '0.0.0.0', API_KEYS: ['k'] }), null);
  for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1']) {
    assert.equal(exposureWarning({ HOST: host, API_KEYS: [] }), null, host);
  }
});

test('startServer logs the exposure warning on a public bind without keys, and not with keys', async () => {
  const warnings = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...a) => warnings.push(a.join(' '));
  console.log = () => {};
  try {
    const open = await testServer({ QUIET: false, HOST: '0.0.0.0', TCP_PORT: null });
    await open.close();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /WARNING.*GRUE_API_KEYS/);

    warnings.length = 0;
    const keyed = await testServer({ QUIET: false, HOST: '0.0.0.0', TCP_PORT: null, API_KEYS: ['k'] });
    await keyed.close();
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
  }
});

// -- sessions are scoped to the API key that created them --------------------------------------------

test('API keys: sessions are private to the creating key; results stay readable', async () => {
  const s = await testServer({ API_KEYS: ['key-a', 'key-b'], LEGACY_ENABLED: false });
  const A = { Authorization: 'Bearer key-a' };
  const B = { Authorization: 'Bearer key-b' };
  try {
    const a = (await s.post('/api/sessions', { game: GAME }, A)).json;
    const b = (await s.post('/api/sessions', { game: GAME }, B)).json;
    assert.ok(a.session_id && b.session_id);

    const listA = (await s.get('/api/sessions', A)).json.sessions.map((x) => x.session_id);
    const listB = (await s.get('/api/sessions', B)).json.sessions.map((x) => x.session_id);
    assert.deepEqual(listA, [a.session_id]);
    assert.deepEqual(listB, [b.session_id]);

    // Another key's session is indistinguishable from an unknown one.
    const cmd = await s.post(`/api/sessions/${a.session_id}/commands`, { command: 'look' }, B);
    assert.equal(cmd.status, 404);
    assert.equal(cmd.json.error, 'unknown_session');
    const get = await s.get(`/api/sessions/${a.session_id}`, B);
    assert.equal(get.status, 404);
    assert.equal(get.json.error, 'unknown_session');
    const del = await s.del(`/api/sessions/${a.session_id}`, B);
    assert.equal(del.status, 404);
    assert.equal(del.json.error, 'unknown_session');

    // The owner is unaffected, and B's attempts did not end it.
    assert.equal((await s.post(`/api/sessions/${a.session_id}/commands`, { command: 'look' }, A)).status, 200);
    assert.equal((await s.get(`/api/sessions/${a.session_id}`, A)).status, 200);

    // After it ends: the owner gets 409, another key still gets 404; results are readable by any key.
    assert.equal((await s.del(`/api/sessions/${a.session_id}`, A)).status, 200);
    assert.equal((await s.post(`/api/sessions/${a.session_id}/commands`, { command: 'look' }, A)).status, 409);
    assert.equal((await s.post(`/api/sessions/${a.session_id}/commands`, { command: 'look' }, B)).status, 404);
    assert.equal((await s.get(`/api/sessions/${a.session_id}`, B)).status, 404);
    assert.equal((await s.get(`/api/results/${a.session_id}`, B)).status, 200);
    const results = (await s.get('/api/results', B)).json.results.map((r) => r.session_id);
    assert.ok(results.includes(a.session_id));
    await s.del(`/api/sessions/${b.session_id}`, B);
  } finally {
    await s.close();
  }
});

test('API keys: /ws/v1 sessions belong to the socket key', async () => {
  const s = await testServer({ API_KEYS: ['key-a', 'key-b'], LEGACY_ENABLED: false });
  const A = { Authorization: 'Bearer key-a' };
  const B = { Authorization: 'Bearer key-b' };
  try {
    const ws = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1`, { headers: A });
    const obs = await ws.request({ type: 'start', game: GAME });
    assert.equal(obs.type, 'observation');
    // visible to key-a over REST, hidden from key-b
    assert.equal((await s.get(`/api/sessions/${obs.session_id}`, A)).status, 200);
    assert.equal((await s.get('/api/sessions', B)).json.sessions.length, 0);
    assert.equal((await s.post(`/api/sessions/${obs.session_id}/commands`, { command: 'look' }, B)).status, 404);
    assert.equal((await s.del(`/api/sessions/${obs.session_id}`, B)).status, 404);
    // the socket itself only ever talks to its own session
    const next = await ws.request({ type: 'command', command: 'look' });
    assert.equal(next.type, 'observation');
    assert.equal(next.session_id, obs.session_id);
    ws.close();
  } finally {
    await s.close();
  }
});

test('without API keys every client sees every session (no scoping)', async () => {
  const s = await testServer();
  try {
    const a = await s.start(GAME);
    assert.equal((await s.get('/api/sessions')).json.sessions.length, 1);
    assert.equal((await s.get(`/api/sessions/${a.session_id}`)).status, 200);
    await s.del(`/api/sessions/${a.session_id}`);
  } finally {
    await s.close();
  }
});

// -- ResultStore -------------------------------------------------------------------------------------

test('ResultStore: unknown ids do not rescan the results directory every time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-results-'));
  const store = new ResultStore({ RESULTS_DIR: dir, REPLAYS_DIR: dir, RESULTS_RESCAN_MS: 150 });
  const orig = fs.readdirSync;
  let scans = 0;
  fs.readdirSync = (...a) => { scans++; return orig(...a); };
  try {
    store.get(randomUUID()); // first miss may scan
    scans = 0;
    for (let i = 0; i < 200; i++) assert.equal(store.get(randomUUID()), null);
    assert.equal(scans, 0, 'a burst of unknown ids costs no directory scans');

    // a result written by someone else is found once the rescan window has passed
    const id = randomUUID();
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ session_id: id, game_id: 'x' }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(store.get(id)?.session_id, id);
    assert.equal(scans, 1);

    // results added by this process are visible immediately
    const own = randomUUID();
    store.add({ session_id: own, game_id: 'x' });
    assert.equal(store.get(own).session_id, own);
  } finally {
    fs.readdirSync = orig;
  }
});
