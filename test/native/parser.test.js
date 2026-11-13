import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './fixture.js';

const run = (g, c) => g.send(c).text;
const fresh = () => { const g = make(); g.start(); return g; };

test('articles are ignored', () => {
  const g = fresh();
  assert.equal(run(g, 'take the brass lamp'), 'Taken.');
  assert.equal(run(g, 'drop a lamp'), 'Dropped.');
  assert.equal(run(g, 'take some lamp'), 'Taken.');
});

test('case-insensitive and punctuation tolerant', () => {
  const g = fresh();
  assert.equal(run(g, 'TAKE   LAMP???'), 'Taken.');
  assert.match(run(g, 'Inventory'), /brass lamp/);
});

test('verb synonyms and multi-word verbs', () => {
  const g = fresh();
  for (const c of ['grab lamp', 'pick up lamp', 'pick lamp up', 'get lamp', 'take lantern']) {
    run(g, 'drop lamp');
    assert.match(run(g, c), /^Taken\./, c);
  }
  assert.match(run(g, 'x lamp'), /You see nothing special/);
  assert.match(run(g, 'look at lamp'), /You see nothing special/);
  assert.match(run(g, 'turn on lamp'), /switch on/);
  assert.match(run(g, 'switch off lamp'), /switch off/);
  assert.match(run(g, 'turn lamp on'), /switch on/);
  assert.match(run(g, 'put lamp on table'), /You put the brass lamp on the round table/);
  assert.match(run(g, 'take lamp from table'), /Taken\./);
});

test('classic parser error wording', () => {
  const g = fresh();
  assert.equal(run(g, 'frobnicate'), "That's not a verb I recognise.");
  assert.equal(run(g, 'take unicorn'), "You can't see any such thing.");
  assert.equal(run(g, ''), 'I beg your pardon?');
  assert.equal(run(g, '   '), 'I beg your pardon?');
  assert.equal(run(g, 'take lamp unicorn'), 'I only understood you as far as wanting to take the brass lamp.');
  assert.equal(run(g, 'w'), 'A wall blocks the way west.');
  assert.equal(run(g, 'take'), 'What do you want to take?');
  assert.equal(run(g, 'put lamp'), 'What do you want to put the brass lamp in or on?');
  assert.equal(run(g, 'look around the room'), 'I only understood you as far as wanting to look around.');
});

test('go and direction words', () => {
  const g = fresh();
  assert.match(run(g, 'go south'), /You can't go that way/);
  g.send('take lamp');
  g.send('turn on lamp');
  assert.match(run(g, 'go north'), /^Cellar/);
  assert.match(run(g, 'south'), /^Hall/);
  assert.match(run(g, 'down'), /^Cellar/);
  assert.match(run(g, 'u'), /^Hall/);
});

test('adjective disambiguation with a follow-up answer', () => {
  const g = fresh();
  assert.equal(run(g, 'take key'), 'Which do you mean, the red key or the brass key?');
  assert.equal(run(g, 'red'), 'Taken.');
  const inv = run(g, 'i');
  assert.match(inv, /red key/);
  assert.doesNotMatch(inv, /brass key/);

  const h = fresh();
  h.send('take key');
  assert.equal(h.send('the brass one').text, 'Taken.');
  assert.match(h.send('i').text, /brass key/);

  const k = fresh();
  k.send('take key');
  assert.equal(k.send('second').text, 'Taken.');
});

test('an unrelated reply to a disambiguation question is a fresh command', () => {
  const g = fresh();
  g.send('take key');
  assert.match(run(g, 'look'), /^Hall/);
  assert.match(run(g, 'take red key'), /Taken/);
});

test('only one visible match needs no question', () => {
  const g = fresh();
  assert.equal(run(g, 'take red key'), 'Taken.');
  assert.equal(run(g, 'take key'), 'Taken.'); // the brass key is the only one not already held
});

test('pronouns it and them', () => {
  const g = fresh();
  assert.equal(run(g, 'take stone'), 'Taken.');
  assert.equal(run(g, 'drop it'), 'Dropped.');
  assert.match(run(g, 'take lamp and stone'), /Brass lamp: Taken\.\nGrey stone: Taken\./);
  assert.match(run(g, 'drop them'), /Brass lamp: Dropped\./);
  assert.match(run(g, 'i'), /nothing/);
  const h = fresh();
  assert.match(run(h, 'examine it'), /not sure what "it" refers to/);
});

test('take all and drop all with exceptions', () => {
  const g = fresh();
  const out = run(g, 'take all');
  assert.match(out, /Brass lamp: Taken/);
  assert.match(out, /Red key: Taken/);
  assert.match(run(g, 'drop all but lamp'), /Red key: Dropped/);
  assert.doesNotMatch(run(g, 'i'), /red key/);
});

test('inventory capacity', () => {
  const g = fresh();
  const out = run(g, 'take all');
  assert.match(out, /too many things/);
});

test('multiple commands in one line', () => {
  const g = fresh();
  const o = g.send('take lamp. turn on lamp then take stone');
  assert.match(o.text, /Taken\.\nYou switch on the brass lamp\.\nTaken\./);
  assert.match(g.send('i').text, /grey stone/);
  assert.equal(g.send('take unicorn. take lamp').text, "You can't see any such thing.");
});

test('again repeats the last command', () => {
  const g = fresh();
  g.send('take lamp');
  g.send('drop lamp');
  assert.equal(run(g, 'g'), "You aren't holding that.");
  g.send('take lamp');
  assert.equal(run(g, 'again'), "You already have that.");
});

test('missing noun question can be answered', () => {
  const g = fresh();
  assert.equal(run(g, 'take'), 'What do you want to take?');
  assert.equal(run(g, 'lamp'), 'Taken.');
  assert.equal(run(g, 'unlock box with'), 'What do you want to unlock the wooden box with?');
});

test('ask and tell topics, give hooks', () => {
  const g = fresh();
  g.send('take bread');
  g.send('open door');
  g.send('e');
  assert.equal(run(g, 'ask guard about the keys'), 'The guard says the keys are in the hall.');
  assert.match(run(g, 'ask guard about weather'), /nothing to say/);
  assert.match(run(g, 'talk to guard'), /ASK GUARD/);
  assert.match(run(g, 'give bread to guard'), /^The guard eats it\./);
  assert.match(run(g, 'give stone to guard'), /see any such thing/);
});

test('meta commands', () => {
  const g = fresh();
  assert.equal(run(g, 'save'), 'Saving is not supported on this server.');
  assert.equal(run(g, 'restore'), 'Saving is not supported on this server.');
  assert.match(run(g, 'score'), /0 out of a possible 5, in 0 moves/);
  assert.match(run(g, 'help'), /Commands are short/);
  assert.match(run(g, 'about'), /Fixture/);
  assert.match(run(g, 'xyzzy'), /Nothing happens/);
  assert.match(run(g, 'sing'), /sing/i);
});
