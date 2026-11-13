import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { mapCharInput, sanitizeLineCommand, cleanBufferText } from '../lib/interpreterSession.js';
import { GameLibrary, slugify } from '../lib/gameLibrary.js';
import { GameSession } from '../lib/gameSession.js';
import { Metrics } from '../lib/metrics.js';
import { isAuthorized } from '../lib/httpApi.js';

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grue-unit-'));

test('char input mapping', () => {
  assert.deepEqual(mapCharInput('return'), { value: 'return', notice: null });
  assert.deepEqual(mapCharInput('\\enter'), { value: 'return', notice: null });
  assert.deepEqual(mapCharInput('ENTER'), { value: 'return', notice: null });
  assert.deepEqual(mapCharInput('\\space'), { value: ' ', notice: null });
  assert.deepEqual(mapCharInput('esc'), { value: 'escape', notice: null });
  assert.deepEqual(mapCharInput('\\UP'), { value: 'up', notice: null });
  assert.deepEqual(mapCharInput('pagedown'), { value: 'pagedown', notice: null });
  assert.deepEqual(mapCharInput('q'), { value: 'q', notice: null });
  assert.deepEqual(mapCharInput('3'), { value: '3', notice: null });
  assert.equal(mapCharInput('').value, 'return');
  assert.ok(mapCharInput('').notice);
  const multi = mapCharInput('talk salesman');
  assert.equal(multi.value, 't');
  assert.match(multi.notice, /single keypress.*'t'/);
});

test('line command sanitizing: newlines, control chars, whitespace', () => {
  assert.equal(sanitizeLineCommand('open\nmailbox'), 'open mailbox');
  assert.equal(sanitizeLineCommand('  take   all\r\n\r\ndrop all  '), 'take all drop all');
  assert.equal(sanitizeLineCommand('a\x00b\x07c\x1b[31md'), 'a b c [31md');
  assert.equal(sanitizeLineCommand(''), '');
  assert.equal(sanitizeLineCommand(null), '');
  assert.equal(sanitizeLineCommand('café \u{1F600}'), 'café \u{1F600}');
});

test('buffer text cleaning strips the prompt and blank-line runs', () => {
  assert.equal(cleanBufferText(['', '', 'Hello', '', 'World', '', '>']), 'Hello\n\nWorld');
  assert.equal(cleanBufferText(['Do you wish to leave the game? (Y is affirmative): >']), 'Do you wish to leave the game? (Y is affirmative):');
  assert.equal(cleanBufferText(['a', '', '', '', 'b']), 'a\n\nb');
  assert.equal(cleanBufferText(['Press any key >'], false), 'Press any key >');
  assert.equal(cleanBufferText([]), '');
});

test('slugify', () => {
  assert.equal(slugify('Airport.gblorb'), 'airport-gblorb');
  assert.equal(slugify('  Zork I: The Great Underground Empire '), 'zork-i-the-great-underground-empire');
  assert.equal(slugify('!!!'), 'game');
});

test('game library: manifest + auto-scan + original/ + availability', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'original'));
  fs.writeFileSync(path.join(dir, 'a_game.z5'), 'x');
  fs.writeFileSync(path.join(dir, 'My Story.ulx'), 'x');
  fs.writeFileSync(path.join(dir, 'original', 'mine.z8'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify([
    { id: 'known', title: 'Known Game', filename: 'a_game.z5', max_score: 100, tags: ['t'], url: 'http://example/x', sha256: 'abc' },
    { id: 'missing', filename: 'nope.z3', max_score: 5 },
    { id: 'orig', title: 'Original One', filename: 'mine.z8', format: 'zcode' },
  ]));
  const lib = new GameLibrary(dir);
  const games = lib.list();
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));

  assert.deepEqual(Object.keys(byId).sort(), ['known', 'missing', 'my-story', 'orig']);
  assert.equal(byId.known.title, 'Known Game');
  assert.equal(byId.known.max_score, 100);
  assert.equal(byId.known.available, true);
  assert.equal(byId.known.url, undefined, 'url/sha256 are manifest-only');
  assert.equal(byId.known.sha256, undefined);
  assert.equal(byId.missing.available, false);
  assert.equal(byId.orig.available, true, 'files under games/original/ are found');
  assert.equal(byId['my-story'].title, 'My Story');
  assert.equal(byId['my-story'].format, 'glulx');
  assert.equal(byId['my-story'].max_score, null);
  assert.deepEqual(byId['my-story'].tags, []);
  assert.equal(lib.find('missing').path, null);
  assert.equal(lib.find('known').path, path.join(dir, 'a_game.z5'));
  assert.equal(lib.find('nope'), null);
  for (const g of games) {
    assert.deepEqual(Object.keys(g).sort(), [
      'author', 'available', 'description', 'difficulty', 'filename', 'format', 'id', 'license',
      'max_score', 'suggested_turn_limit', 'tags', 'title',
    ]);
  }
});

test('game library: missing directory and bad manifest do not throw', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'games.json'), '{not json');
  assert.deepEqual(new GameLibrary(dir).list(), []);
  assert.deepEqual(new GameLibrary(path.join(dir, 'absent')).list(), []);
});

test('api key check', () => {
  const cfg = { API_KEYS: ['k1', 'k2'] };
  assert.equal(isAuthorized({ API_KEYS: [] }, {}), true);
  assert.equal(isAuthorized(cfg, {}), false);
  assert.equal(isAuthorized(cfg, { authorization: 'Bearer k2' }), true);
  assert.equal(isAuthorized(cfg, { authorization: 'bearer   k1 ' }), true);
  assert.equal(isAuthorized(cfg, { authorization: 'Bearer nope' }), false);
  assert.equal(isAuthorized(cfg, { authorization: 'Basic k1' }), false);
  assert.equal(isAuthorized(cfg, {}, 'k1'), true);
  assert.equal(isAuthorized(cfg, {}, 'zzz'), false);
});

/** A scripted stand-in for InterpreterSession, to test ending/score logic deterministically. */
function fakeInterpreter(turns) {
  const queue = [...turns];
  const base = { statusLine: null, gridText: '', inputType: 'line', exited: false, crashed: false, timedOut: false, commandSent: true, notice: null };
  return {
    killed: false,
    start: async () => ({ ...base, ...queue.shift() }),
    send: async () => ({ ...base, ...queue.shift() }),
    kill() { this.killed = true; },
  };
}

function makeSession(turns, game = {}, extra = {}) {
  const dir = tmpdir();
  const cfg = { REPLAYS_DIR: path.join(dir, 'replays'), RESULTS_DIR: path.join(dir, 'results'), IDLE_TIMEOUT_MS: 60_000, COMMAND_TIMEOUT_MS: 1000, START_TIMEOUT_MS: 1000 };
  const interpreter = fakeInterpreter(turns);
  const session = new GameSession({
    id: '11111111-1111-4111-8111-111111111111',
    game: { id: 'fake', max_score: null, ...game },
    gamePath: 'x',
    meta: { model: 'unit' },
    maxTurns: extra.maxTurns ?? 50,
    cfg,
    metrics: new Metrics(),
    interpreter,
  });
  return { session, interpreter, cfg };
}

const st = (loc, score, moves) => `${loc}      Score: ${score}  Moves: ${moves}`;

test('session: status line drives score/location, peak score, unique locations, invalid commands', async () => {
  const { session } = makeSession([
    { text: 'Welcome.', statusLine: st('Hall', 0, 0) },
    { text: 'Taken.', statusLine: st('Hall', 10, 1) },
    { text: 'Kitchen', statusLine: st('Kitchen', 10, 2) },
    { text: 'I don\'t know the word "xyzzy".', statusLine: st('Kitchen', 10, 2) },
    { text: 'Ouch.', statusLine: st('Hall', 5, 3) },
  ], { max_score: 100 });
  const first = await session.start();
  assert.equal(first.turn, 0);
  assert.equal(first.location, 'Hall');
  assert.equal(first.max_score, 100);
  await session.command('take lamp');
  await session.command('n');
  const bad = await session.command('xyzzy');
  assert.equal(bad.turn, 3);
  const last = await session.command('s');
  assert.equal(last.score, 5);
  const result = session.end('aborted');
  assert.equal(result.invalid_commands, 1);
  assert.equal(result.unique_locations, 2);
  assert.equal(result.max_score_reached, 10);
  assert.equal(result.score, 5);
  assert.equal(result.ending, 'aborted');
  assert.equal(result.turn, 4);
  assert.deepEqual(result.meta, { model: 'unit' });
  assert.ok(fs.existsSync(path.join(session.cfg.RESULTS_DIR, `${session.id}.json`)));
  const replay = fs.readFileSync(path.join(session.cfg.REPLAYS_DIR, 'fake_' + session.id + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(replay.map((e) => e.type), ['start', 'output', 'command', 'output', 'command', 'output', 'command', 'output', 'command', 'output', 'end']);
});

test('session: Inform death banner ends the session as "died"', async () => {
  const { session, interpreter } = makeSession([
    { text: 'Start.', statusLine: 'Cellar    0/0' },
    { text: 'You fall.\n\n    *** You have died ***\n\nWould you like to RESTART, RESTORE a saved game, QUIT or UNDO the last command?', statusLine: 'Cellar    0/1' },
  ]);
  await session.start();
  const obs = await session.command('jump');
  assert.equal(obs.game_over, true);
  assert.equal(obs.ending, 'died');
  assert.equal(obs.input_type, null);
  assert.equal(interpreter.killed, true);
  await assert.rejects(() => session.command('look'), (e) => e.code === 'game_over' && e.status === 409);
});

test('session: reincarnation text does not end the game; score drop is tracked', async () => {
  const { session } = makeSession([
    { text: 'x', statusLine: st('Cellar', 35, 8) },
    { text: 'devoured you!\n\n    ****  You have died  ****\n\nNow, let us take a look here.\n\nForest', statusLine: st('Forest', 25, 9) },
  ], { max_score: 350 });
  await session.start();
  const obs = await session.command('n');
  assert.equal(obs.game_over, false);
  assert.equal(obs.score, 25);
  assert.equal(session.end('aborted').max_score_reached, 35);
});

test('session: interpreter exit -> quit / won / ended / crashed', async () => {
  const run = async (cmds, finalTurn, game) => {
    const turns = [{ text: 'hi', statusLine: st('A', 0, 0) }, ...cmds.map(() => ({ text: 'ok', statusLine: st('A', 0, 1) })).slice(0, -1), finalTurn];
    const { session } = makeSession(turns, game);
    await session.start();
    let obs;
    for (const c of cmds) obs = await session.command(c);
    return obs;
  };
  const exited = { text: '', exited: true, inputType: null, statusLine: st('A', 0, 1) };
  assert.equal((await run(['quit'], exited)).ending, 'quit');
  assert.equal((await run(['quit', 'y'], exited)).ending, 'quit');
  assert.equal((await run(['look'], exited)).ending, 'ended');
  assert.equal((await run(['look'], { ...exited, text: '*** You have won ***' })).ending, 'won');
  assert.equal((await run(['look'], { ...exited, statusLine: st('A', 10, 5) }, { max_score: 10 })).ending, 'won');
  assert.equal((await run(['look'], { ...exited, crashed: true })).ending, 'crashed');
});

test('session: turn limit', async () => {
  const { session } = makeSession([
    { text: 'a', statusLine: st('A', 0, 0) },
    { text: 'b', statusLine: st('A', 0, 1) },
    { text: 'c', statusLine: st('A', 0, 2) },
  ], {}, { maxTurns: 2 });
  await session.start();
  assert.equal((await session.command('1')).game_over, false);
  const obs = await session.command('2');
  assert.equal(obs.game_over, true);
  assert.equal(obs.ending, 'turn_limit');
  assert.equal(obs.turn, 2);
});

test('session: score from text when there is no status line', async () => {
  const { session } = makeSession([
    { text: 'Start' },
    { text: 'Done. [Your score has just gone up by two points.]' },
    { text: 'Done again. [Your score has just gone up by 3 points.]' },
    { text: 'You have scored 5 out of a possible 20, in 3 turns.' },
  ]);
  await session.start();
  assert.equal((await session.command('a')).score, 2);
  assert.equal((await session.command('b')).score, 5);
  const o = await session.command('score');
  assert.equal(o.score, 5);
  assert.equal(o.max_score, 20);
  assert.equal(o.status_line, null);
  assert.equal(o.location, null);
});

test('session: idle timeout ends the session with "timeout"', async () => {
  const { session, cfg } = makeSession([{ text: 'x' }]);
  cfg.IDLE_TIMEOUT_MS = 30;
  await session.start();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(session.gameOver, true);
  assert.equal(session.result.ending, 'timeout');
});

test('session: commands are processed in order even when issued concurrently', async () => {
  const order = [];
  const interpreter = {
    start: async () => ({ text: 'x', statusLine: null, gridText: '', inputType: 'line', exited: false, crashed: false, timedOut: false, commandSent: true, notice: null }),
    send: async (c) => {
      order.push(`start:${c}`);
      await new Promise((r) => setTimeout(r, c === 'slow' ? 40 : 1));
      order.push(`end:${c}`);
      return { text: c, statusLine: null, gridText: '', inputType: 'line', exited: false, crashed: false, timedOut: false, commandSent: true, notice: null };
    },
    kill() {},
  };
  const dir = tmpdir();
  const session = new GameSession({
    id: '22222222-2222-4222-8222-222222222222', game: { id: 'fake', max_score: null }, gamePath: 'x', meta: {}, maxTurns: 10,
    cfg: { REPLAYS_DIR: dir, RESULTS_DIR: dir, IDLE_TIMEOUT_MS: 60000 }, metrics: new Metrics(), interpreter,
  });
  await session.start();
  const [a, b] = await Promise.all([session.command('slow'), session.command('fast')]);
  assert.equal(a.text, 'slow');
  assert.equal(b.text, 'fast');
  assert.deepEqual(order, ['start:slow', 'end:slow', 'start:fast', 'end:fast']);
  session.end('aborted');
});
