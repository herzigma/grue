import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { testServer, hasZork, waitUntil, ROOT } from './helpers.js';
import { InterpreterSession } from '../lib/interpreterSession.js';
import { GameSession } from '../lib/gameSession.js';
import { Metrics } from '../lib/metrics.js';

const needZork = { skip: !hasZork && 'games/zork1.z3 not installed (npm run setup)' };
const ZORK = path.join(ROOT, 'games', 'zork1.z3');

/** Delay every write to the interpreter so a 1 ms command timeout always fires first (deterministic). */
function slowWrites(interp, ms = 60) {
  const write = interp._write.bind(interp);
  interp._write = (obj) => { setTimeout(() => write(obj), ms); };
  return () => { interp._write = write; };
}

test('late output after a command timeout is returned with the next command (Zork I over REST)', needZork, async () => {
  const s = await testServer({ COMMAND_TIMEOUT_MS: 1 });
  try {
    const first = await s.start('zork1');
    const id = first.session_id;
    const interp = s.manager.get(id).interpreter;
    const restore = slowWrites(interp);
    const timedOut = await s.cmd(id, 'open mailbox');
    restore();
    assert.equal(timedOut.text, '');
    assert.match(timedOut.notice, /did not respond/);
    assert.ok(await waitUntil(() => interp._ready), 'the interpreter finished the command');
    interp.commandTimeoutMs = 5000;
    const next = await s.cmd(id, 'look');
    assert.match(next.text, /Opening the small mailbox reveals a leaflet/, 'late output is not lost');
    assert.match(next.text, /West of House/, 'the new command is still answered');
    assert.match(next.text, /previous command, which timed out/);
    assert.ok(next.text.indexOf('leaflet') < next.text.indexOf('West of House'), 'late text comes first');
    assert.equal(next.turn, 2, 'the next command was sent normally');
    const after = await s.cmd(id, 'look');
    assert.doesNotMatch(after.text, /leaflet reveals|timed out/, 'late text is delivered only once');
    await s.del(`/api/sessions/${id}`);
    const entries = (await s.get(`/api/results/${id}/transcript`)).json.entries;
    assert.ok(entries.some((e) => e.type === 'output' && /leaflet/.test(e.text)), 'late output reaches the replay');
  } finally {
    await s.close();
  }
});

test('interpreter: late turn is stashed, then prepended exactly once', needZork, async () => {
  const it = new InterpreterSession(ZORK, { commandTimeoutMs: 1 });
  await it.start();
  try {
    const restore = slowWrites(it);
    const t1 = await it.send('open mailbox');
    restore();
    assert.equal(t1.timedOut, true);
    assert.ok(await waitUntil(() => it._ready));
    it.commandTimeoutMs = 5000;
    const t2 = await it.send('look');
    assert.match(t2.lateText, /Opening the small mailbox reveals a leaflet/);
    assert.doesNotMatch(t2.text, /leaflet reveals/);
    assert.match(t2.text, /West of House/);
    assert.equal(t2.commandSent, true);
    const t3 = await it.send('look');
    assert.equal(t3.lateText, '');
  } finally {
    it.kill();
  }
});

test('interpreter: a first screen that times out fails start() instead of returning an empty turn', needZork, async () => {
  const it = new InterpreterSession(ZORK, { startTimeoutMs: 1 });
  await assert.rejects(() => it.start(), /failed to start.*no first screen within 1 ms/);
  assert.equal(it.alive, false);
  assert.equal(it.child, null, 'interpreter process was killed');
});

test('REST: startup timeout is a 500 and frees the slot', needZork, async () => {
  const s = await testServer({ START_TIMEOUT_MS: 1 });
  try {
    const r = await s.post('/api/sessions', { game: 'zork1' });
    assert.equal(r.status, 500);
    assert.match(r.json.message, /failed to start/);
    assert.equal(s.manager.active.size, 0);
  } finally {
    await s.close();
  }
});

// -- GameSession level: scripted interpreter returning lateText ------------------------------------

const base = { statusLine: null, gridText: '', inputType: 'line', exited: false, crashed: false, timedOut: false, commandSent: true, notice: null, lateText: '' };

function lateSession(turns, game = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-late-'));
  const queue = [...turns];
  const interpreter = {
    start: async () => ({ ...base, ...queue.shift() }),
    send: async () => ({ ...base, ...queue.shift() }),
    kill() {},
  };
  return new GameSession({
    id: '33333333-3333-4333-8333-333333333333', game: { id: 'fake', max_score: null, ...game }, gamePath: 'x', meta: {}, maxTurns: 50,
    cfg: { REPLAYS_DIR: path.join(dir, 'r'), RESULTS_DIR: path.join(dir, 'res'), IDLE_TIMEOUT_MS: 60_000 },
    metrics: new Metrics(), interpreter,
  });
}

test('session: late text feeds score parsing, is shown first, and is not judged as this command\'s parser failure', async () => {
  const session = lateSession([
    { text: 'Start.' },
    { text: 'Look text.', lateText: 'Done. [Your score has just gone up by 5 points.]' },
    { text: 'Plain.', lateText: 'I don\'t know the word "frob".' },
  ]);
  await session.start();
  const obs = await session.command('look');
  assert.equal(obs.score, 5, 'score delta in late text is applied');
  assert.match(obs.text, /^\[Late output from the previous command, which timed out:\]\nDone\./);
  assert.match(obs.text, /\[Response to this command:\]\nLook text\.$/);
  await session.command('look');
  assert.equal(session.end('aborted').invalid_commands, 0, 'late text does not count as this command\'s parser failure');
});

test('session: an ending banner in late text ends the session', async () => {
  const session = lateSession([
    { text: 'Start.' },
    {
      text: 'The prompt answered something.',
      lateText: 'You fall.\n\n    *** You have died ***\n\nWould you like to RESTART, RESTORE a saved game, QUIT or UNDO the last command?',
    },
  ]);
  await session.start();
  const obs = await session.command('look');
  assert.equal(obs.game_over, true);
  assert.equal(obs.ending, 'died');
});

test('session: interpreter exit with late output keeps the late text and classifies the ending from it', async () => {
  const session = lateSession([
    { text: 'Start.' },
    { text: '', exited: true, inputType: null, commandSent: false, lateText: '*** You have won ***' },
  ]);
  await session.start();
  const obs = await session.command('look');
  assert.equal(obs.ending, 'won');
  assert.match(obs.text, /You have won/);
});
