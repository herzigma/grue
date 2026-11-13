import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatusLine, parseScoreFromText, detectEndingBanner, findBanner,
  classifyBanner, isInvalidCommandResponse, isQuitCommand,
} from '../lib/parse.js';

test('status line: Infocom/Zork format', () => {
  const r = parseStatusLine(' West of House                                               Score: 0  Moves: 12 ');
  assert.deepEqual(r, { location: 'West of House', score: 0, max_score: null, moves: 12 });
});

test('status line: Zork with negative score and long location', () => {
  const r = parseStatusLine('Round Room   Score: -10   Moves: 301');
  assert.equal(r.location, 'Round Room');
  assert.equal(r.score, -10);
  assert.equal(r.moves, 301);
});

test('status line: Inform 6 "Score: x/y" and Turns label', () => {
  const r = parseStatusLine(' Dungeon Entrance        Score: 5/100    Turns: 42');
  assert.equal(r.location, 'Dungeon Entrance');
  assert.equal(r.score, 5);
  assert.equal(r.max_score, 100);
  assert.equal(r.moves, 42);
});

test('status line: Inform 6 reversed order', () => {
  const r = parseStatusLine('Kitchen   Moves: 7   Score: 3');
  assert.equal(r.location, 'Kitchen');
  assert.equal(r.score, 3);
  assert.equal(r.moves, 7);
});

test('status line: Inform 7 score/turns', () => {
  const r = parseStatusLine(' Gate Waiting Area A-1                                          0/12             ');
  assert.deepEqual(r, { location: 'Gate Waiting Area A-1', score: 0, max_score: null, moves: 12 });
});

test('status line: Inform 7 with larger numbers', () => {
  const r = parseStatusLine('The Grand Hall      45/310');
  assert.equal(r.location, 'The Grand Hall');
  assert.equal(r.score, 45);
  assert.equal(r.moves, 310);
});

test('status line: location only / bare turn counter / time', () => {
  assert.equal(parseStatusLine('Library').location, 'Library');
  assert.equal(parseStatusLine('Library').score, null);
  const bare = parseStatusLine('Library        14');
  assert.equal(bare.location, 'Library');
  assert.equal(bare.moves, 14);
  const timed = parseStatusLine('Library       Time: 9:05 am');
  assert.equal(timed.location, 'Library');
  assert.equal(timed.score, null);
});

test('status line: numbers inside a location name are kept', () => {
  assert.equal(parseStatusLine('Room 101   Score: 1  Moves: 2').location, 'Room 101');
  assert.equal(parseStatusLine('Chapter 2 - The Cellar      3/20').location, 'Chapter 2 - The Cellar');
});

test('status line: multi-line grid uses the first non-blank line; empty input is all null', () => {
  const r = parseStatusLine('\n  Attic   Score: 1  Moves: 1\nExits: down');
  assert.equal(r.location, 'Attic');
  assert.deepEqual(parseStatusLine(null), { location: null, score: null, max_score: null, moves: null });
  assert.deepEqual(parseStatusLine('   '), { location: null, score: null, max_score: null, moves: null });
});

test('status line: only labels, no location', () => {
  const r = parseStatusLine('Score: 4  Moves: 9');
  assert.equal(r.location, null);
  assert.equal(r.score, 4);
});

test('score from text', () => {
  assert.deepEqual(parseScoreFromText('[Your score has just gone up by two points.]'), { delta: 2 });
  assert.deepEqual(parseScoreFromText('[Your score has just gone up by 10 points.]'), { delta: 10 });
  assert.deepEqual(parseScoreFromText('[Your score has just gone up by one point.]'), { delta: 1 });
  assert.deepEqual(parseScoreFromText('Your score has just gone down by 5 points.'), { delta: -5 });
  assert.deepEqual(
    parseScoreFromText('Your score is 35 (total of 350 points), in 8 moves.\nThis gives you the rank of Beginner.'),
    { score: 35, max_score: 350 },
  );
  assert.deepEqual(
    parseScoreFromText('You have so far scored 12 out of a possible 100, in 40 turns, earning you the rank of Novice.'),
    { score: 12, max_score: 100 },
  );
  assert.deepEqual(parseScoreFromText('You have scored 0 out of a possible 10, in 3 turns.'), { score: 0, max_score: 10 });
  assert.deepEqual(parseScoreFromText('Your score is 5 out of a possible 20.'), { score: 5, max_score: 20 });
  assert.deepEqual(parseScoreFromText('You have scored 7 points.'), { score: 7 });
  assert.equal(parseScoreFromText('You see nothing special.'), null);
  assert.equal(parseScoreFromText(''), null);
});

const INFORM_DEATH = `Oh no, the trap door falls shut.

    *** You have died ***


Would you like to RESTART, RESTORE a saved game, QUIT or UNDO the last command?`;

test('ending banner: Inform-style death / win / generic', () => {
  assert.equal(detectEndingBanner(INFORM_DEATH).ending, 'died');
  assert.equal(
    detectEndingBanner('Congratulations.\n\n *** You have won ***\n\nWould you like to RESTART, RESTORE a saved game or QUIT?').ending,
    'won',
  );
  assert.equal(
    detectEndingBanner('The story ends.\n\n*** The End ***\n\nWould you like to RESTART, RESTORE a saved game, or QUIT?').ending,
    'ended',
  );
});

test('ending banner: Zork final death (with RESTART/RESTORE/QUIT question)', () => {
  const text = `Your remains will be installed in the Land of the Living Dead.\n\n    ****  You have died  ****\n\nWould you like to restart the game from the beginning, restore a saved game, or end this session of the game? (Type RESTART, RESTORE, or QUIT):`;
  assert.equal(detectEndingBanner(text).ending, 'died');
});

test('ending banner: Zork death with reincarnation is NOT an ending', () => {
  const text = `Oh, no! A lurking grue slithered into the room and devoured you!\n\n    ****  You have died  ****\n\nNow, let's take a look here... Well, you probably deserve another chance.\n\nForest\nThis is a forest, with trees in all directions.`;
  assert.equal(detectEndingBanner(text), null);
  assert.equal(findBanner(text), 'You have died');
});

test('ending banner: score == max_score makes an unlabeled ending a win', () => {
  const text = '*** The End ***\n\nWould you like to RESTART or QUIT?';
  assert.equal(detectEndingBanner(text, { score: 10, max_score: 10 }).ending, 'won');
  assert.equal(detectEndingBanner(text, { score: 3, max_score: 10 }).ending, 'ended');
  assert.equal(classifyBanner('You have been killed'), 'died');
  assert.equal(classifyBanner('Victory!'), 'won');
});

test('no banner means no ending', () => {
  assert.equal(detectEndingBanner('You are in a maze of twisty little passages, all alike.'), null);
  assert.equal(detectEndingBanner(''), null);
  assert.equal(detectEndingBanner('You win *** a prize'), null);
});

test('invalid command detection', () => {
  const bad = [
    'I don\'t know the word "frobnicate".',
    'That\'s not a verb I recognise.',
    "I didn't understand that sentence.",
    "You can't see any such thing.",
    'I beg your pardon?',
    'There was no verb in that sentence!',
    'I only understood you as far as wanting to take the lamp.',
    "That noun did not make sense in this context.",
    'I don\'t understand that sentence.',
  ];
  for (const t of bad) assert.equal(isInvalidCommandResponse(t), true, t);
  const good = ['Taken.', 'You can\'t go that way.', 'West of House\nYou are standing in an open field.', ''];
  for (const t of good) assert.equal(isInvalidCommandResponse(t), false, t);
});

test('quit command detection', () => {
  assert.equal(isQuitCommand('quit'), true);
  assert.equal(isQuitCommand(' Q '), true);
  assert.equal(isQuitCommand('quit now'), false);
  assert.equal(isQuitCommand('look'), false);
});
