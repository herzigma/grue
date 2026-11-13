// Lantern Lane -- a tutorial game for the Grue native engine.
// (c) 2026 Joshua Herzig-Marx. MIT License. Original work.

const flame = (g) => g.holds('matchbox') || (g.holds('lantern') && g.is('lantern', 'lit'));

function findKey(g) {
  if (g.is('brassKey', 'hidden')) {
    g.reveal('brassKey');
    g.say('You tip the flowerpot aside. Pressed into the damp earth beneath it lies a small brass key.');
  } else {
    g.say('There is nothing more under the flowerpot but a few unhappy woodlice.');
  }
  return true;
}

function lightLantern(g, a) {
  if (g.is('lantern', 'lit')) { g.say('The lantern is already burning.'); return true; }
  if (!g.holds('matchbox')) { g.say('You have nothing to light it with.'); return true; }
  g.set('lantern', 'lit', true);
  g.say('You strike a match from the box and touch it to the wick. The lantern catches with a warm yellow glow.');
  g.award('lantern', 1);
  return true;
}

function fillLamp(g) {
  if (!g.vars.propped) { g.say('The lamp sits far too high above you to reach from the ground.'); return true; }
  if (!g.holds('oilCan')) { g.say('You have nothing to fill it with.'); return true; }
  if (g.vars.filled) { g.say('The reservoir is already brimming with oil.'); return true; }
  g.vars.filled = true;
  g.say('You climb the ladder with the oil can, unscrew the little brass cap and tip oil into the lamp\'s reservoir until it is nearly full. Then you climb down again.');
  g.award('fill', 1);
  return true;
}

function lightLamp(g) {
  if (!g.vars.propped) { g.say('The lamp sits far too high above you to reach from the ground.'); return true; }
  if (!g.vars.filled) { g.say('The reservoir is bone dry. The wick would only smoke and sputter.'); return true; }
  if (!flame(g)) { g.say('You have nothing to light it with.'); return true; }
  g.say('You climb the ladder, strike a flame and hold it to the wick. For a moment nothing happens, then the lamp takes light.');
  g.award('light', 2);
  g.win(
    'Gold light spills down the post and along the cobbles. One by one, up and down Lantern Lane, windows open and neighbours come out to stand beneath the glow. ' +
    'Old Pell, grinning, steps out from behind the baker\'s cart. "Not bad for a first night, apprentice," he says. "Not bad at all."',
  );
  return true;
}

export default {
  title: 'Lantern Lane',
  author: 'Joshua Herzig-Marx',
  release: 'A tutorial adventure. Release 1 / MIT License',
  license: 'MIT',
  maxScore: 10,
  start: 'doorstep',
  intro:
    'It is the evening of the Lamp Festival, and you are old Pell the lamplighter\'s apprentice. Pell has gone ahead to the square with a promise ' +
    'that the great street lamp will be lit before the last light fades. He has left you the job.',
  help:
    'Your goal is to get the great street lamp at the end of Lantern Lane lit before the evening is out. Examine things, read what you find, and talk to people.',
  about:
    'A short tutorial game for learning interactive fiction. Try LOOK, EXAMINE, TAKE, OPEN, UNLOCK, READ, GIVE and ASK.',
  hint: 'Look at everything you can. Notes tell you what to do next. Dark places need a light you can carry.',

  rooms: {
    doorstep: {
      name: 'Pell\'s Doorstep',
      desc:
        'You stand on the worn stone step of the lamplighter\'s cottage. The front door is painted green and the paint is peeling. ' +
        'A clay flowerpot full of tired geraniums sits beside the step. Lantern Lane runs away to the north between low stone walls, ' +
        'and the sky above it is turning the colour of weak tea.',
      exits: { n: 'lane', in: { to: 'kitchen', door: 'frontDoor' } },
    },
    kitchen: {
      name: 'Lamplighter\'s Kitchen',
      desc:
        'A snug, low-ceilinged kitchen smelling of oil and woodsmoke. A black stove squats in one corner, and above it runs a narrow mantel. ' +
        'A scrubbed table stands under the window. In the floor by the stove is a square trapdoor with an iron ring. ' +
        'The front door leads out to the doorstep.',
      exits: { out: { to: 'doorstep', door: 'frontDoor' }, d: { to: 'cellar', door: 'trapdoor' } },
    },
    cellar: {
      name: 'Cellar',
      dark: true,
      desc:
        'A cool, low cellar with a floor of beaten earth. Barrels line one wall and stout shelves hold jars, rope and the usual lamplighter\'s clutter. ' +
        'A flight of steps leads back up to the kitchen.',
      exits: { u: { to: 'kitchen', door: 'trapdoor' } },
    },
    lane: {
      name: 'Lantern Lane',
      desc:
        'The lane is cobbled and crooked, and a row of iron lamp brackets, all of them lit already, marches off to the north. ' +
        'A low wall runs along the east side. Pell\'s cottage is to the south, and the lane opens into a square to the north.',
      exits: { s: 'doorstep', n: 'square' },
    },
    square: {
      name: 'Lamplight Square',
      desc:
        'A small cobbled square with a dry fountain at its centre. At the north end stands the great street lamp on its tall iron post, ' +
        'its glass dark and cold. Everything else in the square glows with festival lanterns, but the great lamp is the one everyone will look to. ' +
        'The lane leads back south.',
      exits: { s: 'lane' },
    },
  },

  objects: {
    frontDoor: {
      name: 'green front door', adj: ['green', 'front', 'cottage'], syn: ['door'],
      loc: 'doorstep', also: ['kitchen'], scenery: true, fixed: true, openable: true, locked: true, lockKey: 'brassKey',
      desc: 'A stout cottage door with peeling green paint and a brass keyhole.',
      after: { unlock(g) { g.award('door', 1); } },
    },
    flowerpot: {
      name: 'flowerpot', adj: ['clay'], syn: ['pot', 'geraniums', 'geranium', 'flowers', 'plant'],
      loc: 'doorstep', scenery: true, fixed: true,
      desc: 'A chipped clay pot of geraniums. It sits slightly crooked, as though it has been moved a few times.',
      before: { lookunder: findKey, take: findKey, push: findKey, pull: findKey, search: findKey },
    },
    brassKey: {
      name: 'small brass key', adj: ['small', 'brass'], syn: ['key'],
      loc: 'doorstep', hidden: true,
      desc: 'A small brass key, still flecked with earth.',
      after: { take(g) { g.award('key', 1); } },
    },
    cottage: {
      name: 'cottage', syn: ['house', 'step', 'walls', 'wall'], loc: 'doorstep', scenery: true, fixed: true,
      desc: 'A small whitewashed cottage with a slate roof. It has seen a great many lamplighters come and go.',
    },
    kitchenTable: {
      name: 'scrubbed table', adj: ['scrubbed', 'kitchen'], syn: ['table'], loc: 'kitchen', scenery: true, fixed: true, supporter: true,
      desc: 'A big old table, scrubbed pale.',
    },
    note: {
      name: 'folded note', adj: ['folded'], syn: ['paper', 'letter', 'message', 'note'], loc: 'kitchenTable',
      desc: 'A folded sheet of paper, addressed in a neat hand: "For the apprentice."',
      text:
        '"Apprentice -- I have gone ahead to the square. The great lamp wants filling and lighting before dusk is done.\n' +
        'The lamp oil is in the cellar, so you will need a light of your own down there: the lantern on its hook will serve, ' +
        'and the matches are on the mantel. The lamp itself is too high to reach, and the only ladder on the lane belongs to Bram, ' +
        'the baker\'s boy. He will swap it for something sweet. -- Pell"',
      after: { read(g) { g.award('note', 1); } },
    },
    mantel: {
      name: 'mantel', syn: ['shelf', 'mantelpiece'], loc: 'kitchen', scenery: true, fixed: true, supporter: true,
      desc: 'A narrow oak mantel above the stove, dark with years of smoke.',
    },
    matchbox: {
      name: 'box of matches', adj: ['box'], syn: ['matches', 'match', 'matchbox'], loc: 'mantel',
      desc: 'A cardboard box crammed with long matches. There are certainly enough for one evening.',
      instead: {
        light: (g, a) => (a.noun === 'matchbox' ? (g.say('You strike a match, watch it flare, and shake it out. Best save them for something worth lighting.'), true) : false),
        switchon: (g, a) => (a.noun === 'matchbox' ? (g.say('You strike a match, watch it flare, and shake it out. Best save them for something worth lighting.'), true) : false),
      },
    },
    lantern: {
      name: 'hurricane lantern', adj: ['hurricane', 'old', 'brass'], syn: ['lantern'],
      loc: 'kitchen', lightSource: true, switchable: true,
      initial: 'A hurricane lantern hangs from a hook beside the stove.',
      desc: 'A battered hurricane lantern with a clean glass chimney and a trimmed wick.',
      before: { switchon: lightLantern, light: lightLantern },
    },
    stove: {
      name: 'black stove', adj: ['black', 'iron'], syn: ['stove', 'range'], loc: 'kitchen', scenery: true, fixed: true,
      desc: 'A squat iron stove, cold at this hour. Pell has gone out for the festival and left it unlit.',
    },
    window: {
      name: 'window', syn: ['glass'], loc: 'kitchen', scenery: true, fixed: true,
      desc: 'Through the small window you can see the dusk gathering over the lane.',
    },
    biscuitTin: {
      name: 'biscuit tin', adj: ['biscuit', 'tin', 'dented'], syn: ['tin', 'box'], loc: 'kitchenTable', container: true, openable: true,
      desc: 'A dented tin painted with faded roses.',
    },
    biscuit: {
      name: 'ginger biscuit', adj: ['ginger', 'sweet'], syn: ['biscuit', 'cookie'], loc: 'biscuitTin', edible: true,
      desc: 'A fat, sugar-dusted ginger biscuit.',
    },
    trapdoor: {
      name: 'trapdoor', adj: ['iron', 'square'], syn: ['trap', 'hatch', 'ring', 'cellar'],
      loc: 'kitchen', also: ['cellar'], scenery: true, fixed: true, openable: true,
      desc: 'A square wooden trapdoor in the kitchen floor with an iron ring to lift it.',
    },
    barrels: {
      name: 'barrels', syn: ['barrel', 'cask', 'casks'], loc: 'cellar', scenery: true, fixed: true, plural: true,
      desc: 'Stout barrels, tight-lidded. They smell of old apples.',
    },
    shelves: {
      name: 'shelves', syn: ['shelf', 'jars', 'rope', 'clutter'], loc: 'cellar', scenery: true, fixed: true, plural: true,
      desc: 'Plain pine shelves holding jars, a coil of rope and assorted lamplighter\'s clutter. None of it is any use tonight.',
    },
    oilCan: {
      name: 'oil can', adj: ['oil', 'tin'], syn: ['can', 'oil', 'oilcan'], loc: 'cellar',
      initial: 'A tin can of lamp oil stands on the nearest shelf.',
      desc: 'A tin can with a long spout, heavy with lamp oil.',
      after: { take(g) { g.award('can', 1); } },
    },
    bram: {
      name: 'Bram', adj: ['baker\'s', 'boy', 'baker'], syn: ['bram', 'boy', 'lad', 'child'], loc: 'lane', npc: true, proper: true,
      initial: 'Bram, the baker\'s boy, sits on the wall swinging his boots and looking hungry.',
      desc: 'A freckled boy of about ten with flour in his hair. He keeps glancing at your pockets.',
      greeting: '"Evening," says Bram. "You\'re Pell\'s apprentice, aren\'t you? I\'ve got the ladder you want, but nothing\'s free, you know."',
      noTopic: '"Dunno about that," says Bram with a shrug.',
      topics: [
        { keys: 'ladder|ladders', say: '"It\'s Dad\'s ladder," says Bram. "But I\'ll swap it for something sweet. Something proper sweet."' },
        { keys: 'biscuit|biscuits|sweet|food|hungry|hungry|sweets|cake', say: '"Pell\'s got a tin of ginger biscuits, hasn\'t he?" says Bram wistfully.' },
        { keys: 'lamp|pell|lamplighter|festival|oil', say: '"Pell\'s already at the square," says Bram. "Said you\'d be along to light the big lamp. You\'ll need a ladder for that."' },
        { keys: 'key|door|cottage', say: '"Pell hides his key under the flowerpot," says Bram. "Everyone knows that."' },
      ],
      instead: {
        give(g, a) {
          if (a.noun === 'biscuit') {
            g.destroy('biscuit');
            g.vars.ladderFree = true;
            g.say('Bram\'s eyes go round. He takes the biscuit and has it down in two bites. "Go on, then," he says through the crumbs. "Take the ladder. Mind you bring it back."');
            g.award('bram', 2);
            return true;
          }
          g.say('"Not hungry for that," says Bram, shaking his head.');
          return true;
        },
        show(g, a) {
          if (a.noun === 'biscuit') {
            g.say('Bram stares at the biscuit. "Give it here and the ladder is yours," he says.');
            return true;
          }
          g.say('Bram glances at it and shrugs.');
          return true;
        },
      },
    },
    ladder: {
      name: 'wooden ladder', adj: ['wooden', 'long'], syn: ['ladder'], loc: 'lane',
      desc: 'A long wooden ladder, much repaired, leaning against the wall.',
      before: {
        take(g) {
          if (!g.vars.ladderFree) {
            g.say('"Oi!" says Bram. "That\'s my dad\'s ladder. Ask nicely, or bring me something sweet."');
            return true;
          }
          return false;
        },
      },
      instead: {
        put(g, a) {
          if (a.second !== 'greatLamp') return false;
          if (g.room !== 'square') return false;
          g.move('ladder', 'square');
          g.vars.propped = true;
          g.say('You prop the ladder against the lamp post. It looks firm enough to climb.');
          return true;
        },
        climb(g) {
          g.say(g.vars.propped ? 'You climb a few rungs and back down. Better to wait until there is something to do at the top.' : 'You would have to prop the ladder up against something first.');
        },
      },
      after: {
        take(g) { g.vars.propped = false; },
        drop(g) {
          if (g.room === 'square') {
            g.vars.propped = true;
            g.say('You prop the ladder against the lamp post. It looks firm enough to climb.');
            return true;
          }
          return false;
        },
      },
    },
    wall: {
      name: 'low wall', adj: ['low', 'stone'], syn: ['wall', 'walls'], loc: 'lane', scenery: true, fixed: true,
      desc: 'A low drystone wall, just right for a hungry boy to sit on.',
    },
    fountain: {
      name: 'dry fountain', adj: ['dry'], syn: ['fountain', 'basin'], loc: 'square', scenery: true, fixed: true,
      desc: 'A stone basin with nothing in it but a few fallen leaves.',
    },
    greatLamp: {
      name: 'great street lamp', adj: ['great', 'street', 'iron', 'tall'], syn: ['lamp', 'post', 'lamp-post', 'lamppost', 'glass', 'reservoir', 'wick'],
      loc: 'square', scenery: true, fixed: true,
      desc: function (g) {
        if (g.is('greatLamp', 'lit')) return 'The great lamp blazes.';
        const bits = [];
        bits.push(g.vars.filled ? 'The reservoir has been filled with oil.' : 'The reservoir looks empty.');
        bits.push(g.vars.propped ? 'The ladder stands against the post.' : 'It is far too high to reach from the ground.');
        return 'A tall iron post topped by a glass lamp as big as a barrel. ' + bits.join(' ');
      },
      instead: {
        fill: fillLamp,
        pour(g, a) { return a.second === 'greatLamp' ? fillLamp(g) : false; },
        light: lightLamp,
        switchon: lightLamp,
        burn: lightLamp,
        climb(g) { g.say(g.vars.propped ? 'You do not need to climb up just now; wait until there is something to do up there.' : 'There is nothing to climb but the post itself, and it is far too smooth.'); },
        put(g, a) { if (a.noun === 'oilCan' && a.second === 'greatLamp') return fillLamp(g); return false; },
        use(g, a) {
          if (a.noun === 'oilCan') return fillLamp(g);
          if (a.noun === 'matchbox' || a.noun === 'lantern') return lightLamp(g);
          return false;
        },
      },
    },
  },
};
