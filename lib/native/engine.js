// The native interactive-fiction engine: world state, scope/light, hooks, turn loop.

import { splitCommands, tokenize, ARTICLES, cap, joinList, digitsFrom } from './text.js';
import { DIR_WORDS } from './grammar.js';
import { parseCommand, applyPending, MSG } from './parser.js';
import { ACTIONS } from './actions.js';

const ATTR_KEYS = [
  'scenery', 'fixed', 'container', 'supporter', 'openable', 'open', 'locked', 'lockable', 'transparent',
  'lightSource', 'lit', 'switchable', 'on', 'wearable', 'worn', 'edible', 'drinkable', 'npc', 'hidden',
];

const SELF_DEF = {
  name: 'yourself', syn: ['me', 'self', 'myself', 'yourself', 'player'], scenery: true, fixed: true,
  desc: 'As good-looking as ever.',
};

const WIDTH = 80;

export class NativeGame {
  constructor(spec) {
    if (!spec || typeof spec !== 'object' || !spec.rooms || !spec.start) throw new Error('Invalid native game: needs rooms and start');
    this.spec = spec;
    this.rooms = spec.rooms;
    this.defs = { self: { ...SELF_DEF, ...(spec.objects?.self ?? {}) }, ...spec.objects };
    if (!this.rooms[spec.start]) throw new Error(`Unknown start room "${spec.start}"`);
    this.vocab = {};
    for (const [id, d] of Object.entries(this.defs)) this.vocab[id] = buildVocab(d);
    this.state = this.initState();
    this.out = [];
    this.scoreGain = 0;
    this.looked = false;
    this.undoSnap = null;
    this.g = this.makeApi();
  }

  // ---------------------------------------------------------------- state
  initState() {
    const objs = {};
    for (const [id, d] of Object.entries(this.defs)) {
      const attrs = {};
      for (const k of ATTR_KEYS) if (d[k] !== undefined) attrs[k] = d[k];
      if (d.lightSource && d.lit === undefined) attrs.lit = false;
      if (d.openable && attrs.open === undefined) attrs.open = false;
      Object.assign(attrs, structuredClone(d.attrs ?? {}));
      objs[id] = { loc: d.loc ?? null, attrs };
    }
    const rooms = {};
    for (const id of Object.keys(this.rooms)) rooms[id] = { visited: false };
    return {
      room: this.spec.start, moves: 0, score: 0, awarded: {}, vars: structuredClone(this.spec.vars ?? {}),
      objs, rooms, it: [], them: [], pending: null, last: null, timers: {}, ending: null,
    };
  }

  loc(id) { return this.state.objs[id]?.loc ?? null; }
  get(id, k) { return this.state.objs[id]?.attrs[k]; }
  is(id, k) { return !!this.state.objs[id]?.attrs[k]; }
  set(id, k, v) { if (this.state.objs[id]) this.state.objs[id].attrs[k] = v; }

  move(id, to) {
    const o = this.state.objs[id];
    if (!o) throw new Error(`move: unknown object "${id}"`);
    if (to !== 'player' && o.attrs.worn) o.attrs.worn = false;
    if (o.loc !== to) o.attrs.moved = true;
    o.loc = to ?? null;
  }

  children(holder) {
    const st = this.state;
    const out = [];
    for (const id of Object.keys(st.objs)) {
      const o = st.objs[id];
      if (o.loc === holder) out.push(id);
      else if (this.rooms[holder] && o.loc === this.defs[id].loc && this.defs[id].also?.includes(holder)) out.push(id);
    }
    return out;
  }

  isOpen(id) { return this.is(id, 'container') && (!this.is(id, 'openable') || this.is(id, 'open')); }
  seesInside(id) { return this.is(id, 'supporter') || (this.is(id, 'container') && (this.isOpen(id) || this.is(id, 'transparent'))); }

  /** true if id is carried at any depth (hands or inside carried containers) */
  holds(id) {
    let cur = this.loc(id);
    for (let n = 0; cur && n < 20; n++) {
      if (cur === 'player') return true;
      cur = this.loc(cur);
    }
    return false;
  }
  carried(id) { return this.loc(id) === 'player'; }
  heldAny() { return this.children('player').length > 0; }
  topCount() { return this.children('player').filter((id) => !this.is(id, 'worn')).length; }

  closedAncestor(id) {
    let cur = this.loc(id);
    for (let n = 0; cur && cur !== 'player' && n < 20; n++) {
      if (this.state.objs[cur] && this.is(cur, 'container') && !this.isOpen(cur)) return cur;
      cur = this.loc(cur);
    }
    return null;
  }

  /** objects currently in scope (visible); the player can always see held things */
  visibleIds() {
    const set = new Set(['self']);
    const add = (holder) => {
      for (const id of this.children(holder)) {
        if (this.is(id, 'hidden')) continue;
        set.add(id);
        if (this.seesInside(id)) add(id);
      }
    };
    add('player');
    if (this.isLit()) add(this.state.room);
    return [...set];
  }

  here(id) { return this.visibleIds().includes(id); }

  scanLight(holder) {
    for (const id of this.children(holder)) {
      if (this.is(id, 'lightSource') && this.is(id, 'lit')) return true;
      if (this.seesInside(id) && this.scanLight(id)) return true;
    }
    return false;
  }

  isDarkRoom() {
    const r = this.rooms[this.state.room];
    return typeof r.dark === 'function' ? !!r.dark(this.g) : !!r.dark;
  }
  isLit() { return !this.isDarkRoom() || this.scanLight('player') || this.scanLight(this.state.room); }

  /** which objects "all" stands for */
  allCandidates(action, second) {
    const st = this.state;
    if (action === 'take') {
      return this.visibleIds().filter((id) => {
        const holder = this.loc(id);
        return !this.holds(id) && (holder === st.room || this.defs[id].also?.includes(st.room) || this.is(holder, 'supporter'))
          && !this.is(id, 'scenery') && !this.is(id, 'fixed') && !this.is(id, 'npc') && id !== 'self';
      });
    }
    return this.children('player').filter((id) => !this.is(id, 'worn'));
  }

  applicable(action, id) {
    const is = (k) => this.is(id, k);
    switch (action) {
      case 'take': return !this.carried(id) && !is('scenery');
      case 'drop': case 'put': case 'give': case 'show': return this.holds(id);
      case 'open': return is('openable') && !is('open');
      case 'close': return is('openable') && is('open');
      case 'unlock': return is('locked');
      case 'lock': return !is('locked') && (is('lockable') || is('openable'));
      case 'switchon': case 'light': return (is('switchable') || is('lightSource')) && !is('lit') && !is('on');
      case 'switchoff': return is('lit') || is('on');
      case 'wear': return is('wearable') && !is('worn');
      case 'remove': return is('worn');
      case 'eat': return is('edible');
      case 'drink': return is('drinkable');
      case 'read': return this.defs[id].text !== undefined;
      case 'ask': case 'tell': case 'talk': return is('npc');
      default: return true;
    }
  }

  // ---------------------------------------------------------------- naming
  name(id) { return this.text(this.defs[id]?.name ?? id); }
  the(id) {
    const d = this.defs[id];
    if (!d) return String(id);
    if (d.proper || d.article === '') return this.name(id);
    return `${d.article === 'a' || d.article === 'an' || d.article === 'some' || !d.article ? 'the' : d.article} ${this.name(id)}`;
  }
  a(id) {
    const d = this.defs[id];
    if (!d) return String(id);
    if (d.proper || d.article === '') return this.name(id);
    if (d.article) return `${d.article} ${this.name(id)}`;
    if (d.plural) return `some ${this.name(id)}`;
    return `${/^[aeiou]/i.test(this.name(id)) ? 'an' : 'a'} ${this.name(id)}`;
  }
  listA(ids) { return joinList(ids.map((id) => this.a(id))); }
  /** a(id) plus state suffix for lists */
  tagged(id) {
    const bits = [];
    if (this.is(id, 'worn')) bits.push('being worn');
    if (this.is(id, 'lightSource') && this.is(id, 'lit')) bits.push('providing light');
    if (this.is(id, 'container') && this.is(id, 'openable')) bits.push(this.is(id, 'open') ? 'open' : 'closed');
    return this.a(id) + (bits.length ? ` (${bits.join(', ')})` : '');
  }
  text(v, a) { return typeof v === 'function' ? v(this.g, a) : v; }
  exitKeys() {
    const ex = this.rooms[this.state.room]?.exits ?? {};
    return Object.keys(ex).map((k) => DIR_WORDS[k] ?? k);
  }

  // ---------------------------------------------------------------- output
  say(...parts) { for (const p of parts) if (p !== undefined && p !== null && p !== '') this.out.push(String(p)); }
  fail(msg) { this.say(msg); return false; }

  award(key, points, msg) {
    const st = this.state;
    if (st.awarded[key] !== undefined) return false;
    st.awarded[key] = points;
    st.score += points;
    this.scoreGain += points;
    if (msg) this.say(msg);
    return true;
  }

  win(msg) { if (!this.state.ending) this.state.ending = { type: 'won', msg }; }
  die(msg) { if (!this.state.ending) this.state.ending = { type: 'died', msg }; }

  reveal(id) { this.set(id, 'hidden', false); }

  look(full = true) {
    const st = this.state;
    this.looked = true;
    if (!this.isLit()) { this.say(MSG.dark); st.rooms[st.room].visited = true; return; }
    const r = this.rooms[st.room];
    const lines = [this.text(r.name), this.text(r.desc)];
    this.say(lines.filter(Boolean).join('\n'));
    this.listRoom();
    st.rooms[st.room].visited = true;
  }

  listRoom() {
    const st = this.state;
    const kids = this.children(st.room).filter((id) => !this.is(id, 'hidden'));
    const plain = [];
    const extra = [];
    let anyInitial = false;
    for (const id of kids) {
      const d = this.defs[id];
      if (!this.is(id, 'scenery')) {
        if (d.initial !== undefined && !this.get(id, 'moved')) { this.say(this.text(d.initial)); anyInitial = true; } else plain.push(id);
      }
      if (this.seesInside(id)) {
        const inside = this.children(id).filter((c) => !this.is(c, 'hidden') && !this.is(c, 'scenery'));
        if (inside.length) extra.push(`${this.is(id, 'supporter') ? 'On' : 'In'} ${this.the(id)} you can see ${joinList(inside.map((c) => this.tagged(c)))}.`);
      }
    }
    if (plain.length) this.say(`${anyInitial ? 'You can also see' : 'You can see'} ${joinList(plain.map((id) => this.tagged(id)))} here.`);
    this.say(...extra);
  }

  goto(room) {
    if (!this.rooms[room]) throw new Error(`goto: unknown room "${room}"`);
    this.state.room = room;
  }

  arrive(from) {
    const r = this.rooms[this.state.room];
    let handled = false;
    if (r.enter) handled = r.enter(this.g, from) === true;
    if (!handled) this.look();
  }

  // ---------------------------------------------------------------- actions & hooks
  hookTables(a) {
    const t = [];
    if (a.noun && this.defs[a.noun]) t.push([this.defs[a.noun], a.noun]);
    if (a.second && this.defs[a.second]) t.push([this.defs[a.second], a.second]);
    t.push([this.rooms[this.state.room], 'room']);
    t.push([this.spec, 'game']);
    return t;
  }

  runHooks(phase, a) {
    for (const [tbl, owner] of this.hookTables(a)) {
      const h = tbl[phase]?.[a.verb];
      if (h === undefined) continue;
      a.self = owner;
      const r = typeof h === 'string' ? h : h(this.g, a);
      if (typeof r === 'string') { this.say(r); return true; }
      if (r === true || (phase === 'instead' && r !== false)) return true;
    }
    return false;
  }

  /** Run one action through instead/before hooks, default behaviour and after hooks. */
  doAction(a) {
    const A = ACTIONS[a.verb];
    if (!A) return this.fail(MSG.noVerb);
    if (this.runHooks('instead', a) || this.runHooks('before', a)) return true;
    const mark = this.out.length;
    const ok = A.run(this, a);
    if (ok) {
      const mark2 = this.out.length;
      for (const [tbl, owner] of this.hookTables(a)) {
        const h = tbl.after?.[a.verb];
        if (h === undefined) continue;
        a.self = owner;
        const r = typeof h === 'string' ? h : h(this.g, a);
        if (typeof r === 'string') { this.out.splice(mark, mark2 - mark, r); break; }
        if (r === true) { this.out.splice(mark, mark2 - mark); break; }
      }
    }
    return ok;
  }

  /** Make sure the player is holding id, taking it implicitly if needed. */
  ensureHeld(id) {
    if (this.holds(id)) return true;
    const mark = this.out.length;
    this.doAction({ verb: 'take', noun: id, nouns: [id], second: null, text: '', dir: null, prep: null, implicit: true });
    if (this.holds(id)) {
      const i = this.out.indexOf('Taken.', mark);
      if (i >= 0) this.out[i] = `(first taking ${this.the(id)})`;
      return true;
    }
    return false;
  }

  endTurn() {
    const st = this.state;
    st.moves++;
    for (const name of Object.keys(st.timers)) {
      if (--st.timers[name] <= 0) { delete st.timers[name]; this.spec.timers?.[name]?.(this.g); }
    }
    this.spec.turn?.(this.g);
    this.rooms[st.room].turn?.(this.g);
    for (const id of this.visibleIds()) this.defs[id].turn?.(this.g);
  }

  // ---------------------------------------------------------------- public API
  start() {
    this.out = [];
    this.scoreGain = 0;
    const s = this.spec;
    this.say(`${(s.title ?? 'Untitled').toUpperCase()}`);
    this.say(`An interactive fiction by ${s.author ?? 'Unknown'}`);
    if (s.release) this.say(s.release);
    if (s.intro) this.say('', this.text(s.intro), '');
    this.arrive(null);
    s.onStart?.(this.g);
    return this.finish();
  }

  send(line) {
    const st = this.state;
    if (st.ending) { this.out = ['The game is over. The game cannot accept further commands.']; return this.observe(this.out.join('\n'), true); }
    this.out = [];
    this.scoreGain = 0;
    try {
      this.process(line);
    } catch (e) {
      this.out.push(`[Internal error: ${e && e.message ? e.message : e}]`);
    }
    return this.finish();
  }

  finish() {
    const st = this.state;
    if (this.scoreGain > 0) {
      const n = this.scoreGain;
      this.out.push(`\n[Your score has just gone up by ${n} point${n === 1 ? '' : 's'}.]`);
      this.scoreGain = 0;
    }
    if (st.ending) {
      const e = st.ending;
      const max = this.spec.maxScore;
      if (e.msg) this.out.push('', this.text(e.msg));
      this.out.push('', `In that game you scored ${st.score}${max ? ` out of a possible ${max}` : ''}, in ${st.moves} move${st.moves === 1 ? '' : 's'}.`);
      this.out.push('', e.type === 'won' ? '*** You have won ***' : e.type === 'died' ? '*** You have died ***' : '*** You have quit ***');
      this.out.push('', 'Would you like to RESTART, RESTORE a saved game or QUIT?');
    }
    return this.observe(this.out.join('\n'));
  }

  observe(text) {
    const st = this.state;
    return {
      text: text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd(),
      statusLine: this.statusLine(),
      inputType: st.ending ? null : 'line',
      ended: !!st.ending,
      ending: st.ending ? st.ending.type : null,
      score: st.score,
      moves: st.moves,
    };
  }

  statusLine() {
    const st = this.state;
    const where = this.isLit() ? this.text(this.rooms[st.room].name) : 'Darkness';
    const right = `Score: ${st.score}  Moves: ${st.moves} `;
    const left = ` ${where}`.slice(0, WIDTH - right.length - 1);
    return left.padEnd(WIDTH - right.length) + right;
  }

  process(line) {
    const st = this.state;
    const segs = splitCommands(line);
    if (!segs.length) { this.say(MSG.pardon); return; }
    for (const seg of segs) {
      if (st.ending) break;
      if (!this.runSegment(seg)) break;
    }
  }

  runSegment(seg) {
    const st = this.state;
    let words = tokenize(seg);
    if (!words.length) { this.say(MSG.pardon); return false; }
    const pend = st.pending;
    st.pending = null;
    if (pend?.kind === 'quit') {
      if (['y', 'yes'].includes(words[0])) { st.ending = { type: 'quit', msg: '' }; } else this.say('Ok, carrying on.');
      return false;
    }
    if (pend) {
      const r = applyPending(this, pend, words);
      if (r && r.again) {
        const names = pend.cands.map((id) => this.the(id));
        this.say(`Which do you mean, ${joinList(names, 'or')}?`);
        st.pending = pend;
        return false;
      }
      if (r) words = r;
    }
    if (words[0] === 'again' || words[0] === 'g') {
      if (!st.last) { this.say("You can't repeat that."); return false; }
      words = st.last;
    }
    const res = parseCommand(this, words);
    if (res.message) {
      this.say(res.message);
      if (res.pending) st.pending = res.pending;
      return false;
    }
    const a = res.action;
    const A = ACTIONS[a.verb];
    if (a.verb !== 'again') st.last = words.map((w) => (w.startsWith('\u0000') ? this.name(w.slice(1)) : w));
    if (!A.free && !A.meta) this.undoSnap = structuredClone(st);
    const wasLit = this.isLit();
    this.looked = false;
    if (a.nouns.length > 1) {
      for (const id of a.nouns) {
        const mark = this.out.length;
        this.doAction({ ...a, noun: id, nouns: [id] });
        if (this.out.length > mark) this.out[mark] = `${cap(this.name(id))}: ${this.out[mark]}`;
        if (st.ending) break;
      }
    } else {
      this.doAction(a);
    }
    if (!A.free && !A.meta) { if (st.ending) st.moves++; else this.endTurn(); }
    if (!st.ending && !this.looked && !A.meta) {
      const nowLit = this.isLit();
      if (!wasLit && nowLit) this.look();
      else if (wasLit && !nowLit) this.say('It is now pitch dark in here!');
    }
    return true;
  }

  // ---------------------------------------------------------------- author API
  makeApi() {
    const G = this;
    return {
      get vars() { return G.state.vars; },
      get room() { return G.state.room; },
      get moves() { return G.state.moves; },
      get score() { return G.state.score; },
      say: (...t) => G.say(...t),
      is: (id, k) => G.is(id, k),
      get: (id, k) => G.get(id, k),
      set: (id, k, v) => G.set(id, k, v),
      loc: (id) => G.loc(id),
      move: (id, to) => G.move(id, to),
      destroy: (id) => G.move(id, null),
      holds: (id) => G.holds(id),
      here: (id) => G.here(id),
      contents: (id) => G.children(id),
      carriedCount: () => G.topCount(),
      reveal: (id) => G.reveal(id),
      hide: (id) => G.set(id, 'hidden', true),
      open: (id) => G.set(id, 'open', true),
      close: (id) => G.set(id, 'open', false),
      lock: (id) => G.set(id, 'locked', true),
      unlock: (id) => G.set(id, 'locked', false),
      award: (key, pts, msg) => G.award(key, pts, msg),
      awarded: (key) => G.state.awarded[key] !== undefined,
      goto: (room) => G.goto(room),
      go: (dir) => G.doAction({ verb: 'go', noun: null, nouns: [], second: null, text: '', dir, prep: null }),
      look: () => G.look(),
      visited: (room) => !!G.state.rooms[room]?.visited,
      dark: () => !G.isLit(),
      win: (msg) => G.win(msg),
      die: (msg) => G.die(msg),
      schedule: (name, turns) => { G.state.timers[name] = turns; },
      cancel: (name) => { delete G.state.timers[name]; },
      name: (id) => G.name(id),
      the: (id) => G.the(id),
      a: (id) => G.a(id),
      digits: (text) => digitsFrom(text),
      cap,
    };
  }
}

function buildVocab(d) {
  const nameWords = String(typeof d.name === 'function' ? '' : d.name ?? '').toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter((w) => w && !ARTICLES.has(w));
  const syn = (d.syn ?? []).flatMap((s) => String(s).toLowerCase().split(/\s+/));
  const adj = (d.adj ?? []).map((s) => String(s).toLowerCase());
  const noun = new Set([...nameWords, ...syn]);
  return { noun, all: new Set([...noun, ...adj]), name: nameWords, syn };
}
