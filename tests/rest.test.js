import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { testServer, hasZork, hasAirport, pidAlive, waitUntil } from './helpers.js';

let s;
before(async () => { s = await testServer(); });
after(async () => { await s.close(); });

const needZork = { skip: !hasZork && 'games/zork1.z3 not installed (npm run setup)' };
const needAirport = { skip: !hasAirport && 'games/Airport.gblorb not installed (npm run setup)' };

function interpreterPid(sessionId) {
  return s.manager.get(sessionId).interpreter.child.pid;
}

test('health, metrics, dashboard, catalog', async () => {
  const health = await s.get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.status, 'ok');
  assert.equal(health.json.version, '2.0.0');
  assert.equal(health.json.active_sessions, 0);

  const metrics = await s.get('/metrics');
  assert.equal(metrics.status, 200);
  assert.match(metrics.text, /grue_active_sessions 0/);

  const dash = await s.get('/');
  assert.equal(dash.status, 200);
  assert.match(dash.headers.get('content-type'), /text\/html/);
  assert.match(dash.text, /<title>Grue[:<]/);

  const games = await s.get('/api/games');
  assert.equal(games.status, 200);
  const ids = games.json.games.map((g) => g.id);
  assert.ok(ids.includes('zork1') && ids.includes('airport'));
  const zork = games.json.games.find((g) => g.id === 'zork1');
  assert.equal(zork.max_score, 350);
  assert.equal(zork.format, 'zcode');
  assert.deepEqual(zork.tags, ['classic', 'memorization-risk']);
  assert.equal(zork.available, hasZork);

  const one = await s.get('/api/games/zork1');
  assert.equal(one.status, 200);
  assert.equal(one.json.id, 'zork1');
  assert.equal((await s.get('/api/games/nope')).json.error, 'unknown_game');
  assert.equal((await s.get('/nothing-here')).status, 404);
});

test('Zork I over REST: score, location, invalid commands, quit ending, result, transcript', needZork, async () => {
  const obs0 = await s.start('zork1', { max_turns: 100, meta: { agent: 'test/1.0', model: 'unit:zork' } });
  const id = obs0.session_id;
  assert.equal(obs0.game_id, 'zork1');
  assert.equal(obs0.turn, 0);
  assert.equal(obs0.location, 'West of House');
  assert.equal(obs0.score, 0);
  assert.equal(obs0.max_score, 350);
  assert.equal(obs0.moves, 0);
  assert.equal(obs0.input_type, 'line');
  assert.equal(obs0.game_over, false);
  assert.equal(obs0.ending, null);
  assert.match(obs0.text, /ZORK I/);
  assert.match(obs0.text, /small mailbox/);
  assert.ok(!/>\s*$/.test(obs0.text), 'trailing prompt is stripped');
  assert.match(obs0.status_line, /West of House\s+Score: 0\s+Moves: 0/);

  const mailbox = await s.cmd(id, 'open mailbox');
  assert.equal(mailbox.turn, 1);
  assert.match(mailbox.text, /leaflet/);
  assert.equal(mailbox.moves, 1);

  const bad = await s.cmd(id, 'blorp the frobnitz');
  assert.match(bad.text, /don't know the word/);
  assert.equal(bad.turn, 2);

  await s.cmd(id, 'n');
  await s.cmd(id, 'n');
  assert.equal((await s.cmd(id, 'up')).location, 'Up a Tree');
  const egg = await s.cmd(id, 'take egg');
  assert.equal(egg.score, 5);
  assert.equal(egg.turn, 6);

  const state = await s.get(`/api/sessions/${id}`);
  assert.equal(state.status, 200);
  assert.equal(state.json.session.turn, 6);
  assert.equal(state.json.session.score, 5);
  assert.equal(state.json.session.max_turns, 100);
  assert.deepEqual(state.json.session.meta, { agent: 'test/1.0', model: 'unit:zork' });
  assert.equal(state.json.observation.turn, 6);

  const active = await s.get('/api/sessions');
  assert.ok(active.json.sessions.some((x) => x.session_id === id));

  const pid = interpreterPid(id);
  assert.ok(pidAlive(pid));

  const quit = await s.cmd(id, 'quit');
  assert.equal(quit.game_over, false);
  assert.match(quit.text, /Do you wish to leave the game/);
  const done = await s.cmd(id, 'y');
  assert.equal(done.game_over, true);
  assert.equal(done.ending, 'quit');
  assert.equal(done.input_type, null);
  assert.equal(done.score, 5);

  const after = await s.post(`/api/sessions/${id}/commands`, { command: 'look' });
  assert.equal(after.status, 409);
  assert.equal(after.json.error, 'game_over');
  assert.ok(await waitUntil(() => !pidAlive(pid)), 'interpreter process is gone');

  const result = (await s.get(`/api/results/${id}`)).json;
  assert.equal(result.session_id, id);
  assert.equal(result.ending, 'quit');
  assert.equal(result.score, 5);
  assert.equal(result.max_score, 350);
  assert.equal(result.max_score_reached, 5);
  assert.equal(result.turn, 8);
  assert.equal(result.invalid_commands, 1);
  assert.equal(result.unique_locations, 4);
  assert.equal(result.meta.model, 'unit:zork');
  assert.equal(result.game_over, true);
  assert.ok(result.duration_ms > 0);
  assert.ok(result.ended_at >= result.started_at);
  assert.match(result.transcript, /^replays\/zork1_.*\.jsonl$/);
  assert.ok(fs.existsSync(path.join(s.ctx.cfg.RESULTS_DIR, `${id}.json`)));

  const list = (await s.get('/api/results?game=zork1&limit=5')).json.results;
  assert.ok(list.some((r) => r.session_id === id));
  assert.ok(list.every((r) => r.game_id === 'zork1'));
  assert.equal((await s.get('/api/results?game=airport')).json.results.length, 0);
  assert.equal((await s.get('/api/results?limit=abc')).status, 400);

  const transcript = (await s.get(`/api/results/${id}/transcript`)).json.entries;
  assert.deepEqual(transcript.map((e) => e.type).slice(0, 3), ['start', 'output', 'command']);
  assert.equal(transcript.at(-1).type, 'end');
  assert.equal(transcript.at(-1).ending, 'quit');
  assert.equal(transcript.filter((e) => e.type === 'command').length, 8);
  assert.equal(transcript[2].text, 'open mailbox');
  assert.equal(transcript[1].turn, 0);

  // DELETE on a finished session just returns its Result.
  const del = await s.del(`/api/sessions/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.ending, 'quit');
  assert.ok(!(await s.get('/api/sessions')).json.sessions.some((x) => x.session_id === id));
});

test('Zork I: dying with reincarnation continues; score drop keeps the peak', needZork, async () => {
  // The grue is random: keep walking in the dark until it eats us (bounded).
  const obs0 = await s.start('zork1', { meta: { model: 'unit:grue' } });
  const id = obs0.session_id;
  for (const c of ['n', 'e', 'open window', 'w', 'w', 'move rug', 'open trap door', 'd']) await s.cmd(id, c);
  let died = null;
  for (let i = 0; i < 12 && !died; i++) {
    const o = await s.cmd(id, ['n', 's', 'e', 'w'][i % 4]);
    if (/You have died/.test(o.text)) died = o;
  }
  assert.ok(died, 'the grue got us');
  assert.equal(died.game_over, false, 'reincarnation is not an ending');
  assert.equal(died.input_type, 'line');
  const res = (await s.del(`/api/sessions/${id}`)).json;
  assert.equal(res.ending, 'aborted');
  assert.equal(res.max_score_reached, 35);
  assert.ok(res.score < 35);
});

test('Airport: Inform 7 status line, char-input menu, keypress notices', needAirport, async () => {
  const obs0 = await s.start('airport', { meta: { model: 'unit:airport' } });
  const id = obs0.session_id;
  assert.equal(obs0.location, 'Gate Waiting Area A-1');
  assert.equal(obs0.input_type, 'line');
  assert.equal(obs0.max_score, null);

  const look = await s.cmd(id, 'look');
  assert.equal(look.moves, 2);
  assert.equal(look.score, 0);
  assert.match(look.text, /Gate Waiting Area A-1/);

  // Save/restore prompts are cancelled with a notice, and the game keeps going.
  const save = await s.cmd(id, 'save');
  assert.match(save.notice, /not supported/);
  assert.equal(save.input_type, 'line');

  // "help" opens a menu that wants single keypresses.
  const help = await s.cmd(id, 'help');
  assert.equal(help.input_type, 'char');
  assert.match(help.text, /Introduction to The Airport/);
  assert.match(help.text, /N = Next/, 'menu drawn in the status window is included');

  const multi = await s.cmd(id, 'hello');
  assert.match(multi.notice, /single keypress.*'h'/);
  assert.equal(multi.input_type, 'char');

  const enter = await s.cmd(id, '\\enter');
  assert.equal(enter.notice, null);
  assert.match(enter.text, /press SPACE/);
  const space = await s.cmd(id, 'space');
  assert.equal(space.game_over, false);

  // Menu navigation eventually returns to line input.
  let o = space;
  for (let i = 0; i < 8 && o.input_type === 'char'; i++) o = await s.cmd(id, 'q');
  assert.equal(o.input_type, 'line');
  const inv = await s.cmd(id, 'inventory');
  assert.match(inv.text, /carrying/);
  assert.equal(inv.location, 'Gate Waiting Area A-1');

  const res = (await s.del(`/api/sessions/${id}`)).json;
  assert.equal(res.ending, 'aborted');
  assert.equal(res.game_id, 'airport');
  assert.ok(res.unique_locations >= 1);
});

test('turn_limit ends the session on the command that reaches it', needZork, async () => {
  const obs0 = await s.start('zork1', { max_turns: 3 });
  const id = obs0.session_id;
  assert.equal((await s.cmd(id, 'look')).game_over, false);
  assert.equal((await s.cmd(id, 'look')).game_over, false);
  const last = await s.cmd(id, 'look');
  assert.equal(last.game_over, true);
  assert.equal(last.ending, 'turn_limit');
  assert.equal(last.turn, 3);
  assert.equal((await s.post(`/api/sessions/${id}/commands`, { command: 'look' })).status, 409);
  assert.equal((await s.get(`/api/results/${id}`)).json.ending, 'turn_limit');
});

test('default max_turns comes from the catalog', needZork, async () => {
  const id = (await s.start('zork1')).session_id;
  assert.equal((await s.get(`/api/sessions/${id}`)).json.session.max_turns, 600);
  await s.del(`/api/sessions/${id}`);
});

test('garbage input: long, unicode, newlines, control characters, blank', needZork, async () => {
  const id = (await s.start('zork1')).session_id;
  const pid = interpreterPid(id);

  const tooLong = await s.post(`/api/sessions/${id}/commands`, { command: 'x'.repeat(257) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.error, 'command_too_long');

  const maxLen = await s.cmd(id, 'look ' + 'a'.repeat(251));
  assert.equal(maxLen.turn, 1, 'a 256-char command is accepted');

  const uni = await s.cmd(id, 'take café ☃ \u{1F600} 中文');
  assert.equal(uni.turn, 2);
  assert.equal(uni.game_over, false);

  const nl = await s.cmd(id, 'open\nmailbox\r\n\r\nlook');
  assert.equal(nl.turn, 3);
  assert.equal(nl.game_over, false);
  assert.ok(nl.text.length > 0);

  const ctrl = await s.cmd(id, 'look\x00\x07\x1b[31m\t\t');
  assert.equal(ctrl.turn, 4);

  const blank = await s.cmd(id, '');
  assert.equal(blank.turn, 5);
  assert.equal(blank.game_over, false);

  const json = await s.post(`/api/sessions/${id}/commands`, { command: 42 });
  assert.equal(json.status, 400);
  assert.equal((await s.post(`/api/sessions/${id}/commands`, '{bad json')).json.error, 'bad_request');
  assert.equal((await s.post(`/api/sessions/${id}/commands`, {})).json.error, 'bad_request');

  // Still alive and responsive after all that.
  const look = await s.cmd(id, 'look');
  assert.match(look.text, /West of House/);
  assert.equal(interpreterPid(id), pid);
  await s.del(`/api/sessions/${id}`);
});

test('error paths: 400 / 404 / 405', needZork, async () => {
  assert.equal((await s.post('/api/sessions', {})).json.error, 'bad_request');
  assert.equal((await s.post('/api/sessions', '[1,2]')).status, 400);
  assert.equal((await s.post('/api/sessions', { game: 'zork1', max_turns: 0 })).status, 400);
  assert.equal((await s.post('/api/sessions', { game: 'zork1', max_turns: 'many' })).status, 400);
  assert.equal((await s.post('/api/sessions', { game: 'zork1', meta: 'x' })).status, 400);
  assert.equal((await s.post('/api/sessions', { game: 'zork1', meta: { blob: 'x'.repeat(5000) } })).status, 400);

  const huge = await s.post('/api/sessions', 'x'.repeat(100_000));
  assert.equal(huge.status, 413);

  const unknownGame = await s.post('/api/sessions', { game: 'no-such-game' });
  assert.equal(unknownGame.status, 404);
  assert.equal(unknownGame.json.error, 'unknown_game');

  const ghost = '00000000-0000-4000-8000-000000000000';
  assert.equal((await s.post(`/api/sessions/${ghost}/commands`, { command: 'look' })).status, 404);
  assert.equal((await s.get(`/api/sessions/${ghost}`)).json.error, 'unknown_session');
  assert.equal((await s.del(`/api/sessions/${ghost}`)).status, 404);
  assert.equal((await s.get(`/api/results/${ghost}`)).status, 404);
  assert.equal((await s.get(`/api/results/${ghost}/transcript`)).status, 404);
  assert.equal((await s.get('/api/results/..%2f..%2fpackage')).status, 404);
  assert.equal((await s.post(`/api/sessions/not-a-uuid/commands`, { command: 'look' })).status, 404);

  assert.equal((await s.req('PUT', '/api/sessions', {})).status, 405);
  assert.equal((await s.req('POST', '/api/games', {})).status, 405);
});

test('game listed but not installed -> 409 game_unavailable', async () => {
  const srv = await testServer({ GAMES_DIR: path.join(s.dir, 'empty-games') });
  fs.mkdirSync(path.join(s.dir, 'empty-games'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'empty-games', 'games.json'), JSON.stringify([{ id: 'ghost', filename: 'ghost.z5' }]));
  try {
    const g = await srv.get('/api/games');
    assert.equal(g.json.games[0].available, false);
    const r = await srv.post('/api/sessions', { game: 'ghost' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'game_unavailable');
  } finally {
    await srv.close();
  }
});

test('concurrent sessions are isolated', needZork, async () => {
  const N = 5;
  const obs = await Promise.all(Array.from({ length: N }, (_, i) => s.start('zork1', { meta: { run_id: `c${i}` } })));
  const ids = obs.map((o) => o.session_id);
  assert.equal(new Set(ids).size, N);
  assert.equal(s.manager.active.size >= N, true);
  const pids = ids.map(interpreterPid);
  assert.equal(new Set(pids).size, N);

  // Each session takes a different number of moves; state must not bleed between them.
  const finals = await Promise.all(ids.map(async (id, i) => {
    let o;
    for (let k = 0; k <= i; k++) o = await s.cmd(id, 'look');
    return o;
  }));
  finals.forEach((o, i) => {
    assert.equal(o.turn, i + 1);
    assert.equal(o.moves, i + 1);
    assert.equal(o.session_id, ids[i]);
  });

  // Same-session commands fired together are answered in order.
  const [a, b] = await Promise.all([s.cmd(ids[0], 'open mailbox'), s.cmd(ids[0], 'read leaflet')]);
  assert.equal(a.turn + 1, b.turn);
  assert.match(a.text, /leaflet|already/i);

  await Promise.all(ids.map((id) => s.del(`/api/sessions/${id}`)));
  assert.ok(await waitUntil(() => pids.every((p) => !pidAlive(p))), 'all interpreters exited');
});

test('interpreter crash is reported as ending "crashed"', needZork, async () => {
  const id = (await s.start('zork1')).session_id;
  await s.cmd(id, 'look');
  const pid = interpreterPid(id);
  process.kill(pid);
  assert.ok(await waitUntil(() => !pidAlive(pid)));
  const o = await s.cmd(id, 'look').catch((e) => e);
  // Either the command observed the dead interpreter or the exit was already processed.
  if (o instanceof Error) assert.match(o.message, /409|game_over/);
  else { assert.equal(o.game_over, true); assert.equal(o.ending, 'crashed'); }
  const res = await s.get(`/api/results/${id}`);
  assert.equal(res.json.ending, 'crashed');
});

test('client disconnect mid-command does not wedge the session', needZork, async () => {
  const id = (await s.start('zork1')).session_id;
  const ctl = new AbortController();
  const p = fetch(`${s.base}/api/sessions/${id}/commands`, {
    method: 'POST', body: JSON.stringify({ command: 'look' }), signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
  }).catch(() => {});
  ctl.abort();
  await p;
  const o = await s.cmd(id, 'look');
  assert.ok(o.turn >= 1);
  assert.equal(o.game_over, false);
  await s.del(`/api/sessions/${id}`);
});
