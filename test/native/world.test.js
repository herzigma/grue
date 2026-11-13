import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './fixture.js';
import { loadNativeGame } from '../../lib/native/index.js';

const run = (g, c) => g.send(c).text;
const fresh = () => { const g = make(); g.start(); return g; };

test('start observation shape and status line', () => {
  const g = make();
  const o = g.start();
  assert.match(o.text, /FIXTURE/);
  assert.match(o.text, /Hall\nA plain hall/);
  assert.equal(o.inputType, 'line');
  assert.equal(o.ended, false);
  assert.equal(o.ending, null);
  assert.match(o.statusLine, /^ Hall\s+Score: 0  Moves: 0 $/);
  assert.equal(o.statusLine.length, 80);
});

test('darkness: pitch dark without light, room shown when light arrives, dark again when it goes', () => {
  const g = fresh();
  g.send('take lamp');
  assert.match(run(g, 'n'), /pitch dark/);
  assert.match(g.send('look').statusLine, /Darkness/);
  assert.match(run(g, 'take stone'), /see any such thing|pitch dark/);
  const on = run(g, 'turn on lamp');
  assert.match(on, /You switch on the brass lamp\.\nCellar\nA damp cellar\./);
  const off = run(g, 'turn off lamp');
  assert.match(off, /It is now pitch dark in here!/);
  g.send('turn on lamp');
  assert.match(g.send('look').text, /^Cellar/);
});

test('a lamp inside an open container still lights a dark room, a closed one does not', () => {
  const g = fresh();
  g.send('take lamp'); g.send('take sack'); g.send('turn on lamp'); g.send('put lamp in sack');
  assert.match(run(g, 'n'), /^Cellar/);
  assert.match(run(g, 'close sack'), /It is now pitch dark/);
});

test('containers: closed, locked, unlock with key, contents revealed', () => {
  const g = fresh();
  assert.match(run(g, 'open box'), /locked/);
  assert.match(run(g, 'put stone in box'), /closed/);
  assert.match(run(g, 'take coin'), /see any such thing/);
  assert.match(run(g, 'unlock box'), /What do you want to unlock/);
  assert.match(run(g, 'unlock box with red key'), /aren't holding/);
  g.send('take red key');
  assert.match(run(g, 'unlock box with red key'), /doesn't seem to fit/);
  g.send('take brass key');
  const un = run(g, 'unlock box');
  assert.match(un, /\(with the brass key\)\nYou unlock the wooden box\./);
  assert.match(run(g, 'open box'), /revealing a gold coin/);
  assert.match(run(g, 'take coin'), /Taken/);
  assert.match(run(g, 'put coin in box'), /You put the gold coin into the wooden box/);
  assert.match(run(g, 'close box'), /You close/);
  assert.match(run(g, 'lock box'), /You lock/);
});

test('implicit take when putting something down in a container', () => {
  const g = fresh();
  assert.match(run(g, 'put stone in sack'), /\(first taking the grey stone\)\nYou put the grey stone into the sack/);
  assert.match(run(g, 'look'), /In the sack you can see a grey stone/);
});

test('supporters and readable text', () => {
  const g = fresh();
  assert.match(g.send('look').text, /On the round table you can see a paper note/);
  assert.match(run(g, 'read note'), /BEWARE/);
  assert.match(run(g, 'put stone on table'), /on the round table/);
  assert.match(run(g, 'read stone'), /nothing written/);
});

test('doors open automatically when you walk through; scenery cannot be taken', () => {
  const g = fresh();
  assert.match(run(g, 'take door'), /hardly portable/);
  const out = run(g, 'e');
  assert.match(out, /\(first opening the wooden door\)\nGarden/);
  assert.match(run(g, 'w'), /^Hall/);
});

test('score is awarded once per named achievement', () => {
  const g = fresh();
  g.send('take brass key');
  g.send('unlock box');
  g.send('open box');
  let o = g.send('take coin');
  assert.match(o.text, /\[Your score has just gone up by 1 point\.\]/);
  g.send('put coin in box');
  o = g.send('take coin');
  assert.doesNotMatch(o.text, /score has just gone up/);
  assert.equal(o.score, 3);
  g.send('read note');
  assert.equal(g.send('read note').score, 4);
});

test('score notice reports multi-point gains', () => {
  const g = fresh();
  g.send('take brass key');
  const o = g.send('unlock box');
  assert.match(o.text, /gone up by 2 points/);
});

test('undo takes back exactly one turn', () => {
  const g = fresh();
  g.send('take lamp');
  g.send('take stone');
  assert.match(run(g, 'undo'), /\[Previous turn undone\.\]/);
  const inv = run(g, 'i');
  assert.match(inv, /brass lamp/);
  assert.doesNotMatch(inv, /grey stone/);
  assert.match(run(g, 'undo'), /can't undo/);
  assert.equal(g.send('score').moves, 1);
});

test('moves count turns, not parser failures or meta commands', () => {
  const g = fresh();
  g.send('xyzzy plugh');
  g.send('score');
  g.send('i');
  assert.equal(g.send('look').moves, 0);
  assert.equal(g.send('take lamp').moves, 1);
  assert.equal(g.send('take unicorn').moves, 1);
});

test('npc topics and wearable/edible basics', () => {
  const g = fresh();
  assert.match(run(g, 'eat bread'), /\(first taking the loaf of bread\)\nYou eat the loaf of bread/);
  assert.match(run(g, 'eat stone'), /plainly inedible/);
  assert.match(run(g, 'eat lamp'), /plainly inedible/);
});

test('hooks: instead strings and functions, before returning false falls through', () => {
  const g = fresh();
  g.send('take bread'); g.send('open door'); g.send('e');
  assert.equal(run(g, 'sing'), 'You sing to the roses.');
  assert.equal(run(g, 'pull lever'), 'Pulled 1.');
  assert.equal(run(g, 'pull lever'), 'Pulled 2.');
});

test('winning ends the game with the standard banner', () => {
  const g = fresh();
  g.send('open door'); g.send('e');
  const o = g.send('take idol');
  assert.equal(o.ended, true);
  assert.equal(o.ending, 'won');
  assert.equal(o.inputType, null);
  assert.match(o.text, /You have the idol!/);
  assert.match(o.text, /\n\*\*\* You have won \*\*\*\n/);
  assert.match(o.text, /Would you like to RESTART, RESTORE a saved game or QUIT\?$/);
  assert.equal(g.send('look').ended, true);
});

test('dying ends the game with the death banner', () => {
  const g = fresh();
  g.send('open door'); g.send('e');
  const o = g.send('enter pit');
  assert.equal(o.ending, 'died');
  assert.match(o.text, /\*\*\* You have died \*\*\*/);
});

test('quit asks for confirmation', () => {
  const g = fresh();
  assert.match(run(g, 'quit'), /really want to quit/);
  assert.match(run(g, 'no'), /carrying on/);
  g.send('quit');
  const o = g.send('yes');
  assert.equal(o.ended, true);
  assert.equal(o.ending, 'quit');
});

test('games are deterministic and independent', async () => {
  const cmds = ['take lamp', 'n', 'turn on lamp', 'look', 's', 'take all', 'open door', 'e', 'ask guard about keys', 'undo'];
  const a = make(); const b = make();
  const ta = [a.start().text, ...cmds.map((c) => a.send(c).text)];
  const tb = [b.start().text, ...cmds.map((c) => b.send(c).text)];
  assert.deepEqual(ta, tb);
  const g1 = await loadNativeGame('games/original/lantern-lane.js');
  const g2 = await loadNativeGame('games/original/lantern-lane.js');
  g1.start(); g2.start();
  g1.send('look under flowerpot'); g1.send('take key');
  assert.match(g1.send('i').text, /brass key/);
  assert.match(g2.send('i').text, /carrying nothing/);
});
