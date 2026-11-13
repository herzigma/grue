// Default behaviour of every standard verb. Each run(G, a) returns true when the action
// "succeeded" (so after-hooks fire) and false when it only produced a refusal.
// A.free = takes no game time; A.meta = out-of-world command (no undo snapshot, no turn).

import { cap, joinList } from './text.js';
import { DIR_WORDS } from './grammar.js';

const ANIMATE = 'You can only do that to something animate.';
const refuse = (msg) => ({ meta: true, run: (G) => G.fail(msg) });

function contentsLine(G, id) {
  const inside = G.children(id).filter((c) => !G.is(c, 'hidden'));
  if (!inside.length) return null;
  return `${G.is(id, 'supporter') ? 'On' : 'In'} ${G.the(id)} you can see ${joinList(inside.map((c) => G.tagged(c)))}.`;
}

function inventoryLines(G, holder, indent) {
  const lines = [];
  for (const id of G.children(holder)) {
    if (G.is(id, 'hidden')) continue;
    lines.push(`${indent}${G.tagged(id)}`);
    if (G.seesInside(id)) lines.push(...inventoryLines(G, id, indent + '  '));
  }
  return lines;
}

function keysOf(G, id) {
  const k = G.defs[id].lockKey;
  return k === undefined ? [] : Array.isArray(k) ? k : [k];
}

function lockOp(G, a, locking) {
  const id = a.noun;
  const d = G.defs[id];
  const keys = keysOf(G, id);
  if (!G.is(id, 'lockable') && !keys.length) return G.fail(`That doesn't seem to be something you can ${locking ? 'lock' : 'unlock'}.`);
  if (locking && G.is(id, 'locked')) return G.fail("That's locked at the moment.");
  if (!locking && !G.is(id, 'locked')) return G.fail("That's unlocked at the moment.");
  if (locking && G.is(id, 'open')) return G.fail(`You'll have to close ${G.the(id)} first.`);
  let key = a.second;
  if (!key) {
    const held = keys.filter((k) => G.holds(k));
    if (held.length === 1) { key = held[0]; G.say(`(with ${G.the(key)})`); } else if (!keys.length) {
      return G.fail(`${cap(G.the(id))} has a lock, but you have nothing that fits it.`);
    } else return G.fail(`What do you want to ${locking ? 'lock' : 'unlock'} ${G.the(id)} with?`);
  }
  if (!G.holds(key)) return G.fail(`You aren't holding ${G.the(key)}.`);
  if (!keys.includes(key)) return G.fail("That doesn't seem to fit the lock.");
  G.set(id, 'locked', locking);
  G.say(locking ? `You lock ${G.the(id)}.` : `You unlock ${G.the(id)}.`);
  void d;
  return true;
}

function switchOp(G, a, on) {
  const id = a.noun;
  const key = G.is(id, 'lightSource') ? 'lit' : 'on';
  if (!G.is(id, 'switchable') && !G.is(id, 'lightSource')) return G.fail(`That's not something you can switch ${on ? 'on' : 'off'}.`);
  if (G.is(id, key) === on) return G.fail(`That's already ${on ? 'on' : 'off'}.`);
  if (G.is(id, 'lightSource') && !G.is(id, 'switchable') && G.defs[id].lit === true) return G.fail("You can't put that out.");
  G.set(id, key, on);
  G.say(on ? `You switch on ${G.the(id)}.` : `You switch off ${G.the(id)}.`);
  return true;
}

function talkTo(G, a, mode) {
  const id = a.noun;
  if (!G.is(id, 'npc')) return G.fail(ANIMATE);
  const d = G.defs[id];
  const words = a.text.split(/\s+/).filter(Boolean);
  const topics = (mode === 'tell' && d.tellTopics) || d.topics;
  const list = Array.isArray(topics) ? topics : Object.entries(topics ?? {}).map(([keys, v]) => (typeof v === 'object' && v !== null ? { keys, ...v } : { keys, say: v }));
  for (const t of list) {
    const keys = Array.isArray(t.keys) ? t.keys : String(t.keys).split('|');
    const hit = keys.some((k) => k.trim().split(/\s+/).every((kw) => words.includes(kw) || words.includes(kw + 's') || words.includes(kw.replace(/s$/, ''))));
    if (!hit) continue;
    if (t.when && !t.when(G.g, a)) continue;
    const r = typeof t.say === 'function' ? t.say(G.g, a) : t.say;
    if (typeof r === 'string') G.say(r);
    return true;
  }
  const none = d.noTopic !== undefined ? G.text(d.noTopic, a) : `${cap(G.the(id))} has nothing to say about that.`;
  G.say(none);
  return true;
}

function travel(G, dir) {
  const st = G.state;
  const room = G.rooms[st.room];
  const exitKey = Object.keys(room.exits ?? {}).find((k) => (DIR_WORDS[k.toLowerCase()] ?? k.toLowerCase()) === dir);
  let ex = exitKey ? room.exits[exitKey] : undefined;
  if (typeof ex === 'function') ex = ex(G.g);
  if (ex === undefined || ex === null || ex === false) return G.fail("You can't go that way.");
  if (typeof ex === 'string') ex = G.rooms[ex] ? { to: ex } : { blocked: ex };
  if (!ex.to || (ex.when && !ex.when(G.g))) return G.fail(G.text(ex.blocked) ?? "You can't go that way.");
  if (ex.door) {
    const dr = ex.door;
    if (G.is(dr, 'locked')) return G.fail(G.text(G.defs[dr].lockedMsg) ?? `${cap(G.the(dr))} is locked.`);
    if (G.is(dr, 'openable') && !G.is(dr, 'open')) {
      G.set(dr, 'open', true);
      G.say(`(first opening ${G.the(dr)})`);
    }
  }
  const from = st.room;
  if (ex.say) G.say(G.text(ex.say));
  G.goto(ex.to);
  G.arrive(from);
  return true;
}

function useDefault(G, a) {
  const id = a.noun;
  const s = a.second;
  if (s) {
    if (keysOf(G, s).includes(id) && G.is(s, 'locked')) return G.doAction({ ...a, verb: 'unlock', noun: s, nouns: [s], second: id });
    if (keysOf(G, s).includes(id)) return G.doAction({ ...a, verb: 'lock', noun: s, nouns: [s], second: id });
    return G.fail(`You'll need to be more specific about how you want to use ${G.the(id)} with ${G.the(s)}.`);
  }
  const d = G.defs[id];
  if (G.is(id, 'lightSource') || G.is(id, 'switchable')) return G.doAction({ ...a, verb: G.is(id, 'lit') || G.is(id, 'on') ? 'switchoff' : 'switchon' });
  if (G.is(id, 'edible')) return G.doAction({ ...a, verb: 'eat' });
  if (G.is(id, 'wearable') && !G.is(id, 'worn')) return G.doAction({ ...a, verb: 'wear' });
  if (d.text !== undefined) return G.doAction({ ...a, verb: 'read' });
  if (G.is(id, 'openable')) return G.doAction({ ...a, verb: G.is(id, 'open') ? 'close' : 'open' });
  return G.fail(`Please be more specific about what you want to do with ${G.the(id)}.`);
}

export const ACTIONS = {
  look: { free: true, run: (G) => { G.look(); return true; } },

  inventory: {
    free: true,
    run(G) {
      const lines = inventoryLines(G, 'player', '  ');
      if (!lines.length) G.say('You are carrying nothing.');
      else G.say('You are carrying:', ...lines);
      return true;
    },
  },

  examine: {
    run(G, a) {
      const id = a.noun;
      const d = G.defs[id];
      G.say(d.desc !== undefined ? G.text(d.desc, a) : `You see nothing special about ${G.the(id)}.`);
      if (id === 'self') return true;
      if (G.is(id, 'container') && G.is(id, 'openable') && !d.quietState) {
        G.say(`${cap(G.the(id))} is ${G.is(id, 'open') ? 'open' : 'closed'}.`);
      } else if (G.is(id, 'openable') && !d.quietState) G.say(`${cap(G.the(id))} is ${G.is(id, 'open') ? 'open' : 'closed'}.`);
      if (G.is(id, 'switchable') || (G.is(id, 'lightSource') && d.lit !== true)) {
        G.say(`${cap(G.the(id))} is currently ${G.is(id, 'lit') || G.is(id, 'on') ? 'switched on' : 'switched off'}.`);
      }
      if (G.seesInside(id)) {
        const line = contentsLine(G, id);
        if (line) G.say(line);
        else if (G.is(id, 'container') && G.is(id, 'openable')) G.say(`${cap(G.the(id))} is empty.`);
      }
      return true;
    },
  },

  search: {
    run(G, a) {
      const id = a.noun;
      if (G.is(id, 'npc')) return G.fail(`${cap(G.the(id))} might object to that.`);
      if (G.is(id, 'container') && !G.seesInside(id)) return G.fail(`${cap(G.the(id))} is closed.`);
      if (G.seesInside(id)) {
        const line = contentsLine(G, id);
        G.say(line ?? `${cap(G.the(id))} is empty.`);
        return true;
      }
      return G.fail('You find nothing of interest.');
    },
  },
  lookunder: { run: (G) => G.fail('You find nothing of interest.') },
  lookbehind: { run: (G) => G.fail('You find nothing of interest.') },

  read: {
    run(G, a) {
      const d = G.defs[a.noun];
      if (d.text === undefined) return G.fail(`There is nothing written on ${G.the(a.noun)}.`);
      G.say(G.text(d.text, a));
      return true;
    },
  },

  take: {
    run(G, a) {
      const id = a.noun;
      if (id === 'self') return G.fail('You are always self-possessed.');
      if (G.carried(id)) return G.fail('You already have that.');
      if (G.is(id, 'npc')) return G.fail(`I don't suppose ${G.the(id)} would care for that.`);
      if (G.is(id, 'scenery')) return G.fail("That's hardly portable.");
      if (G.is(id, 'fixed')) return G.fail("That's fixed in place.");
      if (a.second && G.loc(id) !== a.second) return G.fail(`${cap(G.the(id))} isn't ${G.is(a.second, 'supporter') ? 'on' : 'in'} ${G.the(a.second)}.`);
      const blocked = G.closedAncestor(id);
      if (blocked) return G.fail(`You can't reach into ${G.the(blocked)}; it's closed.`);
      const cap_ = G.spec.capacity;
      if (cap_ && !G.holds(id) && G.topCount() >= cap_) return G.fail("You're carrying too many things already.");
      const wasInside = G.holds(id) ? G.loc(id) : null;
      G.move(id, 'player');
      G.say(wasInside ? `You take ${G.the(id)} out of ${G.the(wasInside)}.` : 'Taken.');
      return true;
    },
  },

  drop: {
    run(G, a) {
      const id = a.noun;
      if (!G.holds(id)) return G.fail("You aren't holding that.");
      G.move(id, G.state.room);
      G.say('Dropped.');
      return true;
    },
  },

  put: {
    run(G, a) {
      const n = a.noun;
      const s = a.second;
      const on = a.prep === 'on';
      if (!s) return G.fail(`What do you want to put ${G.the(n)} in or on?`);
      if (n === s) return G.fail(on ? "You can't put something on top of itself." : "You can't put something inside itself.");
      if (G.is(s, 'npc')) return G.doAction({ ...a, verb: 'give' });
      if (on) {
        if (!G.is(s, 'supporter')) return G.fail(`Putting things on ${G.the(s)} would achieve nothing.`);
      } else {
        if (!G.is(s, 'container')) return G.fail("That can't contain things.");
        if (!G.isOpen(s)) return G.fail(`${cap(G.the(s))} is closed.`);
      }
      if (G.loc(n) === s) return G.fail(`${cap(G.the(n))} is already there.`);
      if (!G.ensureHeld(n)) return false;
      const capy = G.defs[s].capacity;
      if (capy && G.children(s).length >= capy) return G.fail(`There is no more room ${on ? 'on' : 'in'} ${G.the(s)}.`);
      G.move(n, s);
      G.say(`You put ${G.the(n)} ${on ? 'on' : 'into'} ${G.the(s)}.`);
      return true;
    },
  },

  give: {
    run(G, a) {
      if (!a.second) return G.fail(`Who do you want to give ${G.the(a.noun)} to?`);
      if (!G.is(a.second, 'npc')) return G.fail(ANIMATE);
      if (a.noun === 'self') return G.fail("You can't give yourself away.");
      if (!G.ensureHeld(a.noun)) return false;
      return G.fail(`${cap(G.the(a.second))} doesn't seem interested.`);
    },
  },
  show: {
    run(G, a) {
      if (!a.second) return G.fail(`Who do you want to show ${G.the(a.noun)} to?`);
      if (!G.is(a.second, 'npc')) return G.fail(ANIMATE);
      if (!G.ensureHeld(a.noun)) return false;
      return G.fail(`${cap(G.the(a.second))} is not impressed.`);
    },
  },

  open: {
    run(G, a) {
      const id = a.noun;
      if (!G.is(id, 'openable')) return G.fail("That's not something you can open.");
      if (G.is(id, 'open')) return G.fail("That's already open.");
      if (G.is(id, 'locked')) {
        if (a.second && keysOf(G, id).includes(a.second)) {
          if (!G.holds(a.second)) return G.fail(`You aren't holding ${G.the(a.second)}.`);
          G.set(id, 'locked', false);
          G.say(`You unlock ${G.the(id)}.`);
        } else return G.fail(G.text(G.defs[id].lockedMsg) ?? `${cap(G.the(id))} is locked.`);
      }
      G.set(id, 'open', true);
      const inside = G.is(id, 'container') ? G.children(id).filter((c) => !G.is(c, 'hidden') && !G.is(c, 'scenery')) : [];
      G.say(inside.length ? `You open ${G.the(id)}, revealing ${G.listA(inside)}.` : `You open ${G.the(id)}.`);
      return true;
    },
  },
  close: {
    run(G, a) {
      const id = a.noun;
      if (!G.is(id, 'openable')) return G.fail("That's not something you can close.");
      if (!G.is(id, 'open')) return G.fail("That's already closed.");
      G.set(id, 'open', false);
      G.say(`You close ${G.the(id)}.`);
      return true;
    },
  },
  unlock: { run: (G, a) => lockOp(G, a, false) },
  lock: { run: (G, a) => lockOp(G, a, true) },

  switchon: { run: (G, a) => switchOp(G, a, true) },
  switchoff: { run: (G, a) => switchOp(G, a, false) },
  light: {
    run(G, a) {
      if (G.is(a.noun, 'lightSource') || G.is(a.noun, 'switchable')) return switchOp(G, a, true);
      return G.fail(`You can't light ${G.the(a.noun)}.`);
    },
  },
  toggle: {
    run(G, a) {
      if (G.is(a.noun, 'lightSource') || G.is(a.noun, 'switchable')) return switchOp(G, a, !(G.is(a.noun, 'lit') || G.is(a.noun, 'on')));
      return G.doAction({ ...a, verb: 'pull' });
    },
  },

  push: {
    run(G, a) {
      if (G.is(a.noun, 'npc')) return G.fail('Keep your hands to yourself.');
      if (G.is(a.noun, 'scenery') || G.is(a.noun, 'fixed')) return G.fail(`You push ${G.the(a.noun)}, but nothing obvious happens.`);
      return G.fail('Nothing obvious happens.');
    },
  },
  pull: {
    run(G, a) {
      if (G.is(a.noun, 'npc')) return G.fail('Keep your hands to yourself.');
      return G.fail(`You pull ${G.the(a.noun)}, but nothing obvious happens.`);
    },
  },
  turn: {
    run(G, a) {
      if (G.is(a.noun, 'npc')) return G.fail('Keep your hands to yourself.');
      return G.fail(`You turn ${G.the(a.noun)}, but nothing obvious happens.`);
    },
  },
  type: {
    run(G, a) {
      if (a.second) return G.fail(`Typing that on ${G.the(a.second)} has no obvious effect.`);
      return G.fail("There's nothing here that takes that sort of input.");
    },
  },
  say: {
    run(G, a) {
      if (a.noun && G.is(a.noun, 'npc')) return G.doAction({ ...a, verb: 'talk' });
      G.say(`You say "${a.text}" aloud. Nobody answers.`);
      return true;
    },
  },

  enter: {
    run(G, a) {
      const d = G.defs[a.noun];
      if (d.leadsTo) { const from = G.state.room; G.goto(d.leadsTo); G.arrive(from); return true; }
      const ex = G.rooms[G.state.room].exits ?? {};
      const key = Object.keys(ex).find((k) => ex[k] && typeof ex[k] === 'object' && ex[k].door === a.noun);
      if (key) return travel(G, DIR_WORDS[key] ?? key);
      return G.fail("You can't enter that.");
    },
  },
  climb: {
    run(G, a) {
      const d = G.defs[a.noun];
      if (d.leadsTo) { const from = G.state.room; G.goto(d.leadsTo); G.arrive(from); return true; }
      return G.fail("You can't climb that.");
    },
  },
  go: { run: (G, a) => travel(G, a.dir) },
  wait: { run: (G) => { G.say('Time passes.'); return true; } },

  again: { meta: true, run: (G) => G.fail("You can't repeat that.") },
  score: {
    meta: true,
    run(G) {
      const st = G.state;
      const max = G.spec.maxScore;
      G.say(`You have so far scored ${st.score}${max ? ` out of a possible ${max}` : ''}, in ${st.moves} move${st.moves === 1 ? '' : 's'}.`);
      return true;
    },
  },
  help: {
    meta: true,
    run(G) {
      G.say(
        'Commands are short imperative sentences: LOOK, EXAMINE LAMP, TAKE KEY, GO NORTH (or just N), OPEN DOOR,',
        'UNLOCK DOOR WITH KEY, PUT COIN IN BOX, GIVE BREAD TO MAN, ASK MAN ABOUT LAMP, READ NOTE, TURN ON LAMP.',
        'INVENTORY (I) lists what you carry, SCORE shows your score, UNDO takes back your last move, QUIT ends the game.',
        'You can chain commands with periods or THEN, and use IT or ALL (TAKE ALL).',
      );
      if (G.spec.help) G.say('', G.text(G.spec.help));
      return true;
    },
  },
  about: {
    meta: true,
    run(G) {
      const s = G.spec;
      G.say(`${s.title ?? 'Untitled'} -- an interactive fiction by ${s.author ?? 'Unknown'}.`);
      if (s.license) G.say(`License: ${s.license}.`);
      if (s.about) G.say('', G.text(s.about));
      return true;
    },
  },
  hint: {
    meta: true,
    run(G) {
      G.say(G.spec.hint !== undefined ? G.text(G.spec.hint) : "Sorry, there are no hints in this game. Examine everything, read everything, and think about what you've seen.");
      return true;
    },
  },
  undo: {
    meta: true,
    run(G) {
      if (!G.undoSnap) return G.fail("[You can't undo that far.]");
      G.state = G.undoSnap;
      G.undoSnap = null;
      G.say('[Previous turn undone.]');
      return true;
    },
  },
  save: refuse('Saving is not supported on this server.'),
  restore: refuse('Saving is not supported on this server.'),
  restart: refuse('Restarting is not supported on this server.'),
  quit: {
    meta: true,
    run(G) {
      G.state.pending = { kind: 'quit' };
      G.say('Do you really want to quit? (y/n)');
      return true;
    },
  },

  eat: {
    run(G, a) {
      const id = a.noun;
      if (G.is(id, 'npc')) return G.fail(`I don't suppose ${G.the(id)} would like that.`);
      if (!G.is(id, 'edible')) return G.fail("That's plainly inedible.");
      if (!G.ensureHeld(id)) return false;
      G.move(id, null);
      G.say(`You eat ${G.the(id)}. Not bad.`);
      return true;
    },
  },
  drink: {
    run(G, a) {
      const id = a.noun;
      if (!G.is(id, 'drinkable')) return G.fail("That's not something you can drink.");
      if (!G.ensureHeld(id)) return false;
      G.move(id, null);
      G.say(`You drink ${G.the(id)}. Refreshing.`);
      return true;
    },
  },
  wear: {
    run(G, a) {
      const id = a.noun;
      if (!G.is(id, 'wearable')) return G.fail("You can't wear that!");
      if (G.is(id, 'worn')) return G.fail('You are already wearing that.');
      if (!G.ensureHeld(id)) return false;
      if (G.loc(id) !== 'player') G.move(id, 'player');
      G.set(id, 'worn', true);
      G.say(`You put on ${G.the(id)}.`);
      return true;
    },
  },
  remove: {
    run(G, a) {
      const id = a.noun;
      if (!G.is(id, 'worn')) return G.doAction({ ...a, verb: 'take', second: null });
      G.set(id, 'worn', false);
      G.say(`You take off ${G.the(id)}.`);
      return true;
    },
  },

  ask: { run: (G, a) => talkTo(G, a, 'ask') },
  tell: { run: (G, a) => talkTo(G, a, 'tell') },
  talk: {
    run(G, a) {
      const id = a.noun;
      if (!G.is(id, 'npc')) return G.fail(ANIMATE);
      const d = G.defs[id];
      if (d.greeting !== undefined) { G.say(G.text(d.greeting, a)); return true; }
      G.say(`${cap(G.the(id))} regards you patiently. Try ASK ${G.name(id).toUpperCase()} ABOUT something, or TELL ${G.name(id).toUpperCase()} ABOUT something.`);
      return true;
    },
  },
  hello: {
    run(G, a) {
      const npc = G.visibleIds().find((id) => G.is(id, 'npc'));
      if (npc) return G.doAction({ ...a, verb: 'talk', noun: npc, nouns: [npc] });
      G.say('Hello to you too. Nobody here answers.');
      return true;
    },
  },

  attack: {
    run(G, a) {
      if (a.noun === 'self') return G.fail('Violence against yourself is not the answer.');
      return G.fail("Violence isn't the answer to this one.");
    },
  },
  listen: { run: (G) => G.fail('You hear nothing unexpected.') },
  smell: { run: (G) => G.fail('You smell nothing unexpected.') },
  touch: {
    run(G, a) {
      if (G.is(a.noun, 'npc')) return G.fail('Keep your hands to yourself.');
      return G.fail('You feel nothing unexpected.');
    },
  },
  rub: { run: (G) => G.fail('You achieve nothing by this.') },
  knock: { run: (G) => G.fail('Nobody answers.') },
  jump: { run: (G) => G.fail('You jump on the spot, fruitlessly.') },
  sing: { run: (G) => G.fail('You sing a few bars. Nobody applauds.') },
  sleep: { run: (G) => G.fail("You aren't tired.") },
  wake: { run: (G) => G.fail('The dreadful truth is, this is not a dream.') },
  swim: { run: (G) => G.fail("There's no water deep enough here to swim in.") },
  xyzzy: { run: (G) => G.fail('Nothing happens. Those words belong to older caves than this one.') },
  yesno: { run: (G) => G.fail('That was a rhetorical question.') },
  think: { run: (G) => G.fail("Time to think. Perhaps examining things more closely would help.") },
  fill: { run: (G, a) => G.fail(`You can't fill ${G.the(a.noun)} with that.`) },
  pour: { run: (G, a) => G.fail(`There's nothing to pour out of ${G.the(a.noun)}.`) },
  cut: { run: (G, a) => G.fail(`Cutting ${G.the(a.noun)} up would achieve nothing.`) },
  oil: { run: (G, a) => G.fail(`${cap(G.the(a.noun))} doesn't need oiling.`) },
  tie: { run: (G) => G.fail("You can't tie that to anything useful.") },
  untie: { run: (G) => G.fail("There's nothing to undo there.") },
  dig: { run: (G) => G.fail('Digging here would achieve nothing.') },
  throw: { run: (G) => G.fail('You lack the nerve when it comes to the crucial moment.') },
  wave: { run: (G, a) => G.fail(`You wave ${G.the(a.noun)} around. Nothing obvious happens.`) },
  shake: { run: (G, a) => G.fail(`You shake ${G.the(a.noun)}. Nothing obvious happens.`) },
  burn: { run: (G) => G.fail('This dangerous act would achieve little.') },
  use: { run: (G, a) => useDefault(G, a) },
};
