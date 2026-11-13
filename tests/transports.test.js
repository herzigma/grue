import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  testServer, hasZork, hasAirport, pidAlive, waitUntil, TextClient, WsClient,
} from './helpers.js';

const needZork = { skip: !hasZork && 'games/zork1.z3 not installed (npm run setup)' };

test('WebSocket JSON: list, start, command, invalid, end', needZork, async () => {
  const s = await testServer();
  try {
    const c = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1`);

    const games = await c.request({ type: 'list_games' });
    assert.equal(games.type, 'games');
    assert.ok(games.games.some((g) => g.id === 'zork1'));

    const early = await c.request({ type: 'command', command: 'look' });
    assert.equal(early.type, 'error');
    assert.equal(early.error, 'bad_request');

    const notJson = await c.request('this is not json');
    assert.equal(notJson.type, 'error');
    assert.equal(notJson.error, 'bad_request');

    const unknown = await c.request({ type: 'start', game: 'nope' });
    assert.deepEqual([unknown.type, unknown.error], ['error', 'unknown_game']);

    const start = await c.request({ type: 'start', game: 'zork1', max_turns: 50, meta: { model: 'unit:ws' } });
    assert.equal(start.type, 'observation');
    assert.equal(start.turn, 0);
    assert.equal(start.location, 'West of House');
    assert.equal(start.max_score, 350);

    const again = await c.request({ type: 'start', game: 'zork1' });
    assert.equal(again.error, 'bad_request');

    const obs = await c.request({ type: 'command', command: 'open mailbox' });
    assert.equal(obs.type, 'observation');
    assert.equal(obs.turn, 1);
    assert.match(obs.text, /leaflet/);

    const tooLong = await c.request({ type: 'command', command: 'x'.repeat(300) });
    assert.equal(tooLong.error, 'command_too_long');

    const bad = await c.request({ type: 'command', command: 'frobnicate' });
    assert.match(bad.text, /don't know the word/);

    const wat = await c.request({ type: 'dance' });
    assert.equal(wat.error, 'bad_request');

    const result = await c.request({ type: 'end' });
    assert.equal(result.type, 'result');
    assert.equal(result.ending, 'aborted');
    assert.equal(result.turn, 2);
    assert.equal(result.invalid_commands, 1);
    assert.equal(result.meta.model, 'unit:ws');
    assert.ok(await c.waitClosed(), 'socket closes after end');
    assert.equal((await s.get(`/api/results/${result.session_id}`)).json.ending, 'aborted');
  } finally {
    await s.close();
  }
});

test('WebSocket JSON: closing the socket aborts the session and kills the interpreter', needZork, async () => {
  const s = await testServer();
  try {
    const c = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1`);
    const start = await c.request({ type: 'start', game: 'zork1' });
    const id = start.session_id;
    const pid = s.manager.get(id).interpreter.child.pid;
    assert.ok(pidAlive(pid));
    c.close();
    assert.ok(await waitUntil(() => s.manager.active.size === 0), 'session removed');
    assert.ok(await waitUntil(() => !pidAlive(pid)), 'interpreter killed');
    assert.equal((await s.get(`/api/results/${id}`)).json.ending, 'aborted');
  } finally {
    await s.close();
  }
});

test('WebSocket JSON: game over is reported and further commands error', needZork, async () => {
  const s = await testServer();
  try {
    const c = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1`);
    await c.request({ type: 'start', game: 'zork1', max_turns: 1 });
    const last = await c.request({ type: 'command', command: 'look' });
    assert.equal(last.game_over, true);
    assert.equal(last.ending, 'turn_limit');
    const more = await c.request({ type: 'command', command: 'look' });
    assert.equal(more.error, 'game_over');
    c.close();
  } finally {
    await s.close();
  }
});

test('legacy TCP: pick a game, play, quit', needZork, async () => {
  const s = await testServer();
  try {
    const c = await TextClient.tcp(s.tcpPort);
    const lobby = await c.expect(/Enter a game number or id/);
    assert.match(lobby, /Zork I/);
    assert.match(lobby, /\[zork1\]/);

    c.send('99');
    await c.expect(/Unknown game/);

    c.send('zork1');
    const intro = await c.expect(/Turn: 0\]\s*\n> $/);
    assert.match(intro, /West of House/);
    assert.match(intro, /Score: 0\/350/);

    c.send('open mailbox');
    const out = await c.expect(/Turn: 1\]/);
    assert.match(out, /leaflet/);

    c.send('');
    c.send('look\r');
    const look = await c.expect(/Turn: 2\]/); // blank line was ignored, CRLF handled
    assert.match(look, /West of House/);

    c.send('quit');
    await c.expect(/leave the game/);
    c.send('y');
    const end = await c.expect(/Game over: quit/);
    assert.match(end, /Turn: 4/);
    assert.ok(await c.waitClosed(), 'connection closes at game over');
    const results = (await s.get('/api/results')).json.results;
    assert.equal(results[0].ending, 'quit');
    assert.equal(results[0].meta.interface, 'tcp');
  } finally {
    await s.close();
  }
});

test('legacy TCP: disconnect mid-game aborts the session; pick by number', needZork, async () => {
  const s = await testServer();
  try {
    const c = await TextClient.tcp(s.tcpPort);
    const lobby = await c.expect(/Enter a game number or id/);
    const n = lobby.split('\n').find((l) => /\[zork1\]/.test(l)).trim().split('.')[0];
    c.send(n);
    await c.expect(/Turn: 0\]/);
    const [session] = [...s.manager.active.values()];
    const pid = session.interpreter.child.pid;
    c.close();
    assert.ok(await waitUntil(() => s.manager.active.size === 0));
    assert.ok(await waitUntil(() => !pidAlive(pid)));
    assert.equal(session.result.ending, 'aborted');
  } finally {
    await s.close();
  }
});

test('legacy WebSocket text interface on / (not /ws/v1)', needZork, async () => {
  const s = await testServer();
  try {
    const c = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/`);
    await c.expect(/Enter a game number or id/);
    c.ws.send('zork1');
    await c.expect(/West of House[\s\S]*Turn: 0\]/);
    c.ws.send('look');
    const o = await c.expect(/Turn: 1\]/);
    assert.match(o, /West of House/);
    c.close();
    assert.ok(await waitUntil(() => s.manager.active.size === 0));
  } finally {
    await s.close();
  }
});

test('legacy interface: char-mode hint (Airport help menu)', { skip: !hasAirport && 'Airport not installed' }, async () => {
  const s = await testServer();
  try {
    const c = await TextClient.tcp(s.tcpPort);
    await c.expect(/Enter a game number or id/);
    c.send('airport');
    await c.expect(/Turn: 0\]/);
    c.send('help');
    const menu = await c.expect(/single keypress/);
    assert.match(menu, /\\enter/);
    c.send('q');
    await c.expect(/Turn: 2\]/);
    c.close();
  } finally {
    await s.close();
  }
});

test('MAX_SESSIONS: 429 too_many_sessions, slot freed when a session ends', needZork, async () => {
  const s = await testServer({ MAX_SESSIONS: 2 });
  try {
    const a = await s.start('zork1');
    const b = await s.start('zork1');
    const third = await s.post('/api/sessions', { game: 'zork1' });
    assert.equal(third.status, 429);
    assert.equal(third.json.error, 'too_many_sessions');
    await s.del(`/api/sessions/${a.session_id}`);
    const c = await s.start('zork1');
    assert.notEqual(c.session_id, b.session_id);
    // Concurrent create burst cannot exceed the limit.
    await s.del(`/api/sessions/${c.session_id}`);
    const burst = await Promise.all(Array.from({ length: 5 }, () => s.post('/api/sessions', { game: 'zork1' })));
    assert.equal(burst.filter((r) => r.status === 201).length, 1);
    assert.equal(burst.filter((r) => r.status === 429).length, 4);
  } finally {
    await s.close();
  }
});

test('idle timeout ends the session with "timeout" and frees the interpreter', needZork, async () => {
  const s = await testServer({ IDLE_TIMEOUT_MS: 400 });
  try {
    const id = (await s.start('zork1')).session_id;
    const pid = s.manager.get(id).interpreter.child.pid;
    await s.cmd(id, 'look');
    assert.ok(await waitUntil(() => s.manager.active.size === 0, 3000), 'session timed out');
    assert.ok(await waitUntil(() => !pidAlive(pid)));
    assert.equal((await s.get(`/api/results/${id}`)).json.ending, 'timeout');
    assert.equal((await s.post(`/api/sessions/${id}/commands`, { command: 'look' })).status, 409);
  } finally {
    await s.close();
  }
});

test('API keys: /api and /ws/v1 require a bearer key; /health stays open; legacy off by default', needZork, async () => {
  const s = await testServer({ API_KEYS: ['sekret'], LEGACY_ENABLED: false });
  try {
    assert.equal(s.tcpPort, null, 'no TCP listener when legacy is disabled');
    assert.equal((await s.get('/health')).status, 200);
    const no = await s.get('/api/games');
    assert.equal(no.status, 401);
    assert.equal(no.json.error, 'unauthorized');
    assert.equal((await s.get('/api/games', { Authorization: 'Bearer wrong' })).status, 401);
    const auth = { Authorization: 'Bearer sekret' };
    assert.equal((await s.get('/api/games', auth)).status, 200);
    assert.equal((await s.post('/api/sessions', { game: 'zork1' })).status, 401);
    const r = await s.post('/api/sessions', { game: 'zork1' }, auth);
    assert.equal(r.status, 201);
    await s.del(`/api/sessions/${r.json.session_id}`, auth);

    await assert.rejects(() => WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1`), /401/);
    const viaHeader = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1`, { headers: auth });
    assert.equal((await viaHeader.request({ type: 'list_games' })).type, 'games');
    viaHeader.close();
    const viaQuery = await WsClient.connect(`ws://127.0.0.1:${s.httpPort}/ws/v1?api_key=sekret`);
    assert.equal((await viaQuery.request({ type: 'list_games' })).type, 'games');
    viaQuery.close();
    await assert.rejects(() => WsClient.connect(`ws://127.0.0.1:${s.httpPort}/`), /404/);
  } finally {
    await s.close();
  }
});

test('server shutdown kills every interpreter and records aborted results', needZork, async () => {
  const s = await testServer();
  const ids = [(await s.start('zork1')).session_id, (await s.start('zork1')).session_id];
  const pids = ids.map((id) => s.manager.get(id).interpreter.child.pid);
  const dir = s.ctx.cfg.RESULTS_DIR;
  await s.close();
  assert.ok(await waitUntil(() => pids.every((p) => !pidAlive(p))), 'no zombie interpreters');
  const fs = await import('fs');
  for (const id of ids) {
    const r = JSON.parse(fs.readFileSync(`${dir}/${id}.json`, 'utf8'));
    assert.equal(r.ending, 'aborted');
  }
});
