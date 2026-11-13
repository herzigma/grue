// A small game used by the engine unit tests.
import { createGame } from '../../lib/native/index.js';

export function spec() {
  return {
    title: 'Fixture',
    author: 'Test',
    maxScore: 5,
    start: 'hall',
    capacity: 4,
    rooms: {
      hall: {
        name: 'Hall',
        desc: 'A plain hall. A door leads east; a stair goes down.',
        exits: { n: 'cellar', d: 'cellar', e: { to: 'garden', door: 'door' }, w: 'A wall blocks the way west.' },
      },
      cellar: { name: 'Cellar', dark: true, desc: 'A damp cellar.', exits: { s: 'hall', u: 'hall' } },
      garden: {
        name: 'Garden',
        desc: 'A tidy garden.',
        exits: { w: { to: 'hall', door: 'door' } },
        before: { sing: 'You sing to the roses.' },
      },
    },
    objects: {
      door: { name: 'wooden door', syn: ['door'], loc: 'hall', also: ['garden'], scenery: true, fixed: true, openable: true },
      redKey: { name: 'red key', adj: ['red'], syn: ['key'], loc: 'hall' },
      brassKey: { name: 'brass key', syn: ['key'], loc: 'hall' },
      lamp: { name: 'brass lamp', syn: ['lamp', 'lantern'], loc: 'hall', lightSource: true, switchable: true },
      box: {
        name: 'wooden box', syn: ['box'], loc: 'hall', container: true, openable: true, locked: true, lockKey: 'brassKey',
        after: { unlock(g) { g.award('unlock', 2); } },
      },
      coin: { name: 'gold coin', syn: ['coin'], loc: 'box', after: { take(g) { g.award('coin', 1); } } },
      table: { name: 'round table', syn: ['table'], loc: 'hall', supporter: true, fixed: true, scenery: true },
      note: { name: 'paper note', syn: ['note'], loc: 'table', text: 'The note says: BEWARE.', after: { read(g) { g.award('note', 1); } } },
      stone: { name: 'grey stone', syn: ['stone'], loc: 'hall' },
      sack: { name: 'sack', loc: 'hall', container: true, openable: true, open: true },
      bread: { name: 'loaf of bread', syn: ['bread', 'loaf'], loc: 'hall', edible: true },
      guard: {
        name: 'guard', syn: ['guard', 'man'], loc: 'garden', npc: true,
        topics: { 'key|keys': 'The guard says the keys are in the hall.' },
        instead: {
          give(g, a) {
            if (a.noun === 'bread') { g.destroy('bread'); g.say('The guard eats it.'); g.award('bread', 1); return true; }
            return false;
          },
        },
      },
      lever: {
        name: 'lever', loc: 'garden', scenery: true, fixed: true,
        instead: { pull(g) { g.vars.pulled = (g.vars.pulled ?? 0) + 1; g.say(`Pulled ${g.vars.pulled}.`); } },
      },
      idol: { name: 'golden idol', syn: ['idol'], loc: 'garden', after: { take(g) { g.win('You have the idol!'); } } },
      pit: { name: 'pit', loc: 'garden', scenery: true, fixed: true, instead: { enter(g) { g.die('You fall in.'); } } },
    },
  };
}

export const make = () => createGame(spec);
