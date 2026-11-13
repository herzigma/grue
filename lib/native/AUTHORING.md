# Writing a native game

A native game is a plain ES module. Its `default` export is a **spec object** (or a function returning one,
which is called afresh for every session). No compiler, no dependencies.

```js
// games/original/mini.js
export default {
  title: 'Mini',
  author: 'You',
  maxScore: 2,
  start: 'cellar',
  intro: 'You wake in a cellar.',
  rooms: {
    cellar: {
      name: 'Cellar',
      desc: 'A damp cellar with a locked door to the north. A shelf is nailed to the wall.',
      exits: { n: { to: 'garden', door: 'door' } },
    },
    garden: { name: 'Garden', desc: 'Sunlight! You are free.', enter: (g) => { g.award('out', 1); g.win('You step outside.'); } },
  },
  objects: {
    door: { name: 'iron door', syn: ['door'], loc: 'cellar', also: [], scenery: true, fixed: true, openable: true, locked: true, lockKey: 'key' },
    shelf: { name: 'shelf', loc: 'cellar', scenery: true, fixed: true, supporter: true, desc: 'A rough wooden shelf.' },
    key: { name: 'rusty key', adj: ['rusty'], syn: ['key'], loc: 'shelf', after: { take: (g) => { g.award('key', 1); } } },
  },
};
```

Load it with `loadNativeGame('games/original/mini.js')`; call `game.start()` and `game.send('take key')`.
Both return `{ text, statusLine, inputType: 'line' | null, ended, ending: null | 'won' | 'died' | 'quit', score, moves }`.

**Rules for authors**

* All mutable state lives in the engine (object locations, attributes, `g.vars`). Never keep state in module
  variables; two sessions share the module. Put your own counters and flags in `vars`.
* Be deterministic: no `Math.random`, no `Date`.
* Hooks run synchronously and may throw nothing; an exception is reported as `[Internal error ...]`.

## Spec fields

| Field | Meaning |
|---|---|
| `title`, `author`, `release`, `license` | banner and `about` |
| `intro` | text (or `(g) => text`) shown before the first room |
| `start` | id of the first room |
| `maxScore` | shown in `score` and the final summary |
| `capacity` | optional: max separate items carried (a container counts as one) |
| `vars` | initial author state, deep-copied per session |
| `rooms`, `objects` | see below |
| `help`, `about`, `hint` | extra text (or functions) for HELP, ABOUT and HINT |
| `turn(g)` | runs after every turn that takes game time |
| `timers` | `{ name(g) {} }` for `g.schedule(name, n)` fuses |
| `before`, `instead`, `after` | game-wide hooks (see Hooks) |
| `onStart(g)` | runs once after the opening text |

## Rooms

```js
rooms: {
  id: {
    name: 'Room Name',                    // string or (g) => string; used as heading and status line
    desc: 'text' | (g) => 'text',
    dark: true | (g) => boolean,          // dark unless a lit light source is in scope
    exits: {
      n: 'otherRoom',                     // a room id
      s: 'A wall blocks the way.',        // any string that is not a room id is a refusal message
      e: { to: 'room', door: 'doorId',    // door object must be unlocked; a closed one is opened automatically
           when: (g) => boolean,          // condition, else `blocked` (string or fn) or "You can't go that way."
           blocked: 'text', say: 'text shown on the way' },
      u: (g) => /* any of the above, computed */,
    },
    enter: (g, from) => {},               // runs on arrival, before the description. Return true to suppress it.
    turn: (g) => {},                      // every turn while the player is here
    before / instead / after: { verb: ... },   // see Hooks
  },
}
```

Exit keys: `n s e w ne nw se sw u d in out` (full words work too) or any single custom word.

## Objects

```js
id: {
  name: 'brass lamp',      // article is derived ('a'); override with article: 'some' | 'the' | ''; proper: true; plural: true
  adj: ['old'],            // extra adjectives. Every word of `name` is understood too.
  syn: ['lantern'],        // extra nouns (may contain spaces; each word is added)
  loc: 'room' | 'otherObject' | 'player' | null,   // where it starts (null = nowhere yet)
  also: ['roomB'],         // fixed objects (doors, scenery) that are also present in these rooms
  desc: 'text' | (g, a) => 'text',
  initial: 'text',         // shown in the room description until the object is first moved
  text: 'what you see when you READ it',
  ...flags
}
```

Flags (all booleans, all changeable at run time with `g.set(id, flag, value)`):

`scenery` (never listed, cannot be taken) - `fixed` (listed but cannot be taken) - `hidden` (not in scope until
`g.reveal(id)`) - `container`, `openable`, `open`, `locked`, `transparent` (contents visible when closed) - `lockKey`
(an object id or array of ids that unlock/lock it; `lockable` for code locks you handle yourself; `lockedMsg` custom
"locked" text) - `supporter` - `lightSource` + `lit` (+ `switchable` if the player may switch it on and off) -
`switchable`/`on` (non-light devices) - `wearable`/`worn` - `edible`, `drinkable` - `npc` (animate: can be talked to,
given things).
`capacity: n` limits how many things a container/supporter holds. `attrs: { ... }` adds your own per-object state
(`g.get(id, 'fueled')`). `leadsTo: 'room'` lets `ENTER`/`CLIMB` take the player to a room. `quietState: true`
suppresses the automatic "It is closed." line in EXAMINE.

### People

```js
topics: [                                   // or an object { 'key|keys': 'text' }
  { keys: 'ladder|ladders', say: '"..."', when: (g, a) => true },   // keys: words; all words of one alternative must appear
],
tellTopics: [...],                          // optional; TELL uses `topics` if absent
noTopic: '"No idea."',                      // fallback
greeting: '"Hello."',                       // for TALK TO
instead: { give(g, a) { /* a.noun is the item */ } },   // GIVE / SHOW hooks
```

`ask X about Y`, `tell X about Y`, `talk to X about Y` and `ask X for Y` all go through the topics.

## Hooks

Objects, rooms and the game can define `instead`, `before` and `after`, each a table keyed by **verb name**.
A value is a string (printed, action stops) or `function (g, a)` where `a` is
`{ verb, noun, second, text, dir, prep, self }`; `noun`/`second` are object ids, `text` is free text (topics,
`turn dial to 3`, typed codes), `self` is the id of the hook's owner (`'room'` or `'game'` for those tables).

For an action that mentions objects, tables are consulted in this order: the noun, the second object, the room, the game.

| Phase | Runs | Return value |
|---|---|---|
| `instead` | before the default action | handled unless it returns `false` |
| `before` | before the default action | handled only if it returns `true` or a string (a string is printed) |
| `after` | after the default action succeeded | `true` or a string replaces the default message; otherwise the default message stays and your text follows it |

Verb names: `look examine search lookunder lookbehind read inventory take drop put give show open close lock unlock
switchon switchoff light toggle push pull turn type say enter climb go wait eat drink wear remove ask tell talk hello
attack listen smell touch rub knock jump sing sleep wake swim xyzzy think fill pour oil cut tie untie dig throw wave
shake burn use`. Synonyms are folded into these (`pry` is `open`, `set X to N` is `turn` with `a.text = 'N'`,
`type 2718 on keypad` is `type`, `put X in/on Y` is `put` with `a.prep = 'in' | 'on'`, `go north` is `go` with
`a.dir = 'n'`).

## The `g` API

State: `g.vars`, `g.room`, `g.moves`, `g.score`.
Output: `g.say(...paragraphs)`.
Objects: `g.is(id, flag)`, `g.get(id, flag)`, `g.set(id, flag, value)`, `g.loc(id)`, `g.move(id, whereId | 'player' | null)`,
`g.destroy(id)`, `g.holds(id)` (carried at any depth), `g.here(id)` (in scope), `g.contents(id)`, `g.carriedCount()`,
`g.reveal(id)`, `g.hide(id)`, `g.open/close/lock/unlock(id)`.
Score: `g.award(key, points, msg?)` (once per key; the engine prints `[Your score has just gone up by N points.]`),
`g.awarded(key)`.
World: `g.goto(room)`, `g.go(dir)` (a normal move through the exits), `g.look()`, `g.visited(room)`, `g.dark()`.
Endings: `g.win(text)`, `g.die(text)`.
Time: `g.schedule(name, turns)` runs `spec.timers[name]` later; `g.cancel(name)`.
Text: `g.name(id)`, `g.the(id)`, `g.a(id)`, `g.digits('twenty-seven eighteen')` -> `'2718'`, `g.cap(s)`.

## What the engine gives you for free

* Parser: articles, adjectives, synonyms, `it`/`them`, `all` (with `but`), `and` lists, `.`/`then` chaining,
  `again`, "Which do you mean ...?" follow-ups, "What do you want to take?" follow-ups, classic Inform error wording.
* Containers, supporters, locks and keys (implicit key use: `unlock door` works when you hold the one right key),
  implicit taking (`put key in box` takes the key first), doors that open as you walk through them.
* Darkness: a dark room is only visible with a lit light source carried (in an open container is fine) or in the room.
* Light source switching, wearing, eating, inventory capacity, undo (one level), score bookkeeping, quit confirmation.
* Ending banners: `*** You have won ***` / `*** You have died ***` followed by the RESTART/RESTORE/QUIT prompt.

## Checklist before shipping a game

1. Write `games/src/<id>/walkthrough.txt` (one command per line) that reaches the maximum score and the win.
2. Add the game to `GAMES` in `games/src/verify.mjs` and run `node games/src/verify.mjs`.
3. Give every noun mentioned in a description its own scenery object with an EXAMINE text.
4. Make every puzzle clued in play, give obvious verbs synonyms, and make sure no state is unwinnable.
5. Run `node --test test/native/` (the robustness test loads every game in `games/original/`; add yours to its list).
