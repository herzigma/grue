// Parser: matches grammar patterns against tokens and resolves noun phrases against scope.

import { GRAMMAR, DIR_WORDS, VERB_WORDS } from './grammar.js';
import { ARTICLES } from './text.js';

const MULTI_VERBS = new Set(['take', 'drop', 'put', 'give', 'show']);
const PRONOUNS = new Set(['it', 'them', 'him', 'her']);
const ORDINALS = Object.assign(Object.create(null), { first: 0, second: 1, third: 2, fourth: 3, last: -1 });

export const MSG = {
  noVerb: "That's not a verb I recognise.",
  noSee: "You can't see any such thing.",
  noSense: "I didn't understand that sentence.",
  pardon: 'I beg your pardon?',
  dark: "It is pitch dark, and you can't see a thing.",
  multi: "You can't use multiple objects with that verb.",
};

function dirOf(game, w) {
  if (DIR_WORDS[w]) return DIR_WORDS[w];
  const keys = game.exitKeys();
  return keys.includes(w) ? w : null;
}

/** Try one grammar pattern against the words. Returns a result or null. */
function matchPattern(game, p, words) {
  const els = p.els;
  const go = (pi, wi, slots, lits) => {
    if (pi === els.length) {
      return wi === words.length
        ? { status: 'full', slots, lits }
        : { status: 'partial', consumed: wi, slots, lits };
    }
    const el = els[pi];
    if (el.lit) {
      if (wi >= words.length) return null;
      if (!el.lit.includes(words[wi])) return null;
      return go(pi + 1, wi + 1, slots, [...lits, el.lit[0]]);
    }
    if (wi >= words.length) return { status: 'missing', slotName: el.slot, slots, lits, pi };
    if (el.slot === 'dir') {
      const d = dirOf(game, words[wi]);
      if (!d) return null;
      return go(pi + 1, wi + 1, { ...slots, dir: d }, lits);
    }
    const next = els[pi + 1];
    if (!next) return { status: 'full', slots: { ...slots, [el.slot]: [wi, words.length] }, lits };
    if (!next.lit) return null;
    let best = null;
    for (let k = wi + 1; k < words.length; k++) {
      if (!next.lit.includes(words[k])) continue;
      const r = go(pi + 1, k, { ...slots, [el.slot]: [wi, k] }, lits);
      if (r && r.status === 'full') return r;
      if (r && !best) best = r;
    }
    // the slot may run to the end and the following literal be missing -> not a match
    return best;
  };
  return go(0, 0, {}, []);
}

function vocabMatch(game, id, ws) {
  const v = game.vocab[id];
  if (!v) return false;
  let hasNoun = false;
  for (const w of ws) {
    const base = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
    if (v.noun.has(w) || v.noun.has(base)) hasNoun = true;
    else if (!(v.all.has(w) || v.all.has(base))) return false;
  }
  return hasNoun;
}

function phrase(game, p, resolved, upto = p.els.length) {
  const parts = [];
  for (const el of p.els.slice(0, upto)) {
    if (el.lit) parts.push(el.lit[0]);
    else if (resolved[el.slot] && resolved[el.slot].length) parts.push(resolved[el.slot].map((id) => game.the(id)).join(' and '));
  }
  return parts.join(' ');
}

/** Resolve one noun (no "and"). entries = [{w,i}] */
function resolveOne(game, entries, action, scope) {
  const ws = entries.map((e) => e.w);
  if (ws.length === 1 && PRONOUNS.has(ws[0])) {
    const ids = ws[0] === 'them' && game.state.them.length ? game.state.them : game.state.it;
    if (!ids.length) return { error: `I'm not sure what "${ws[0]}" refers to.` };
    const ok = ids.filter((id) => scope.includes(id));
    return ok.length ? { ids: ok } : { error: game.isLit() ? MSG.noSee : MSG.dark };
  }
  if (ws[0].startsWith('\u0000')) {
    const id = ws[0].slice(1);
    return scope.includes(id) ? { ids: [id] } : { error: MSG.noSee };
  }
  let c = scope.filter((id) => vocabMatch(game, id, ws));
  if (!c.length) return { notFound: true };
  if (c.length > 1) {
    const exact = c.filter((id) => game.vocab[id].name.every((n) => ws.includes(n)));
    if (exact.length) c = exact;
  }
  if (c.length > 1) {
    const last = ws[ws.length - 1];
    const head = c.filter((id) => game.vocab[id].name[game.vocab[id].name.length - 1] === last || game.vocab[id].syn.includes(last));
    if (head.length && head.length < c.length) c = head;
  }
  if (c.length > 1) {
    const ok = c.filter((id) => game.applicable(action, id));
    if (ok.length) c = ok;
  }
  if (c.length > 1) {
    return { ambig: { cands: c, start: entries[0].i, end: entries[entries.length - 1].i + 1 } };
  }
  return { ids: c };
}

/** Resolve a noun-phrase slot. Returns {ids} | {error} | {ambig} | {notFound} */
function resolveSlot(game, words, range, action, slot) {
  const [s, e] = range;
  const entries = [];
  for (let i = s; i < e; i++) if (!ARTICLES.has(words[i])) entries.push({ w: words[i], i });
  if (!entries.length) return { empty: true };
  const scope = game.visibleIds();
  const multiOk = slot === 'noun' && MULTI_VERBS.has(action);
  const first = entries[0].w;

  if (first === 'all' || first === 'everything') {
    if (!multiOk) return { error: MSG.multi };
    let ids = game.allCandidates(action, null);
    const bi = entries.findIndex((x) => x.w === 'but' || x.w === 'except');
    if (bi >= 0) {
      const ex = [];
      let cur = [];
      for (const x of entries.slice(bi + 1)) {
        if (x.w === 'and') { if (cur.length) ex.push(cur); cur = []; } else cur.push(x);
      }
      if (cur.length) ex.push(cur);
      for (const part of ex) {
        const r = resolveOne(game, part, action, scope);
        if (r.ids) ids = ids.filter((id) => !r.ids.includes(id));
      }
    }
    if (!ids.length) return { error: action === 'take' ? 'There is nothing to take.' : 'There is nothing to do that with.' };
    return { ids, multi: true };
  }

  const parts = [];
  let cur = [];
  for (const x of entries) {
    if (x.w === 'and') { if (cur.length) parts.push(cur); cur = []; } else cur.push(x);
  }
  if (cur.length) parts.push(cur);
  if (!parts.length) return { empty: true };
  if (parts.length > 1 && !multiOk) return { error: MSG.multi };
  const ids = [];
  for (const part of parts) {
    const r = resolveOne(game, part, action, scope);
    if (r.error || r.ambig) return r;
    if (r.notFound) return { notFound: true, entries: part };
    for (const id of r.ids) if (!ids.includes(id)) ids.push(id);
  }
  return { ids, multi: ids.length > 1 };
}

function notFoundMsg(game) {
  return game.isLit() || game.heldAny() ? MSG.noSee : MSG.dark;
}

/** Fully resolve one candidate pattern result into an action. */
function buildAction(game, p, m, words) {
  const a = { verb: p.action, noun: null, nouns: [], second: null, text: '', dir: null, prep: null, ...p.extras, raw: words };
  const made = {};
  for (const slotName of ['noun', 'second']) {
    const range = m.slots[slotName];
    if (!range) continue;
    const r = resolveSlot(game, words, range, p.action, slotName);
    if (r.empty) return { fail: MSG.noSense };
    if (r.error) return { fail: r.error };
    if (r.ambig) return { ambig: r.ambig };
    if (r.notFound) {
      // for a trailing slot, see whether a shorter phrase works -> "I only understood you as far as..."
      if (range[1] === words.length) {
        const [s, e] = range;
        for (let k = e - 1; k > s; k--) {
          const r2 = resolveSlot(game, words, [s, k], p.action, slotName);
          if (r2.ids && r2.ids.length) {
            return { fail: `I only understood you as far as wanting to ${phrase(game, p, { ...made, [slotName]: r2.ids })}.` };
          }
        }
      }
      return { fail: notFoundMsg(game) };
    }
    made[slotName] = r.ids;
    if (slotName === 'noun') { a.noun = r.ids[0]; a.nouns = r.ids; } else a.second = r.ids[0];
  }
  if (m.slots.text) a.text = words.slice(m.slots.text[0], m.slots.text[1]).filter((w) => !w.startsWith('\u0000')).join(' ');
  if (m.slots.dir) a.dir = m.slots.dir;
  if (a.second && a.nouns.length > 1) { a.nouns = a.nouns.filter((id) => id !== a.second); a.noun = a.nouns[0]; }
  // pronoun bookkeeping
  const st = game.state;
  if (a.nouns.length > 1) { st.them = [...a.nouns]; } else if (a.noun && a.noun !== 'self') { st.it = [a.noun]; }
  if (a.second && a.second !== 'self') st.it = [a.second];
  return { action: a };
}

export function knownVerb(w) {
  return VERB_WORDS.has(w);
}

/**
 * Parse tokens. Returns one of:
 *   { action }                      ready to execute
 *   { message }                     parser error text
 *   { message, pending }            question to the player + continuation state
 */
export function parseCommand(game, words) {
  if (!words.length) return { message: MSG.pardon };
  if (!VERB_WORDS.has(words[0]) && !dirOf(game, words[0])) return { message: MSG.noVerb };

  const cands = [];
  GRAMMAR.forEach((p, idx) => {
    const m = matchPattern(game, p, words);
    if (m) cands.push({ p, m, idx });
  });
  const rank = { full: 0, missing: 1, partial: 2 };
  cands.sort((x, y) => {
    if (rank[x.m.status] !== rank[y.m.status]) return rank[x.m.status] - rank[y.m.status];
    if (x.m.status === 'full' && x.p.litCount !== y.p.litCount) return y.p.litCount - x.p.litCount;
    if (x.m.status === 'partial' && x.m.consumed !== y.m.consumed) return y.m.consumed - x.m.consumed;
    return x.idx - y.idx;
  });

  let firstFail = null;
  for (const c of cands) {
    if (c.m.status === 'full') {
      const r = buildAction(game, c.p, c.m, words);
      if (r.action) return r;
      if (r.ambig) return askWhich(game, words, r.ambig);
      firstFail ??= r.fail;
    } else if (c.m.status === 'missing') {
      return missing(game, c, words, firstFail);
    } else {
      // partial: leftover words after a complete pattern
      const sub = { ...c.m, slots: c.m.slots };
      const r = buildAction(game, c.p, sub, words.slice(0, c.m.consumed));
      if (r.action || r.ambig) {
        const res = r.action ? { noun: r.action.nouns, second: r.action.second ? [r.action.second] : [] } : {};
        return { message: `I only understood you as far as wanting to ${phrase(game, c.p, res, c.p.els.length)}.` };
      }
      firstFail ??= r.fail;
    }
  }
  return { message: firstFail ?? MSG.noSense };
}

function askWhich(game, words, amb) {
  const names = amb.cands.map((id) => game.the(id));
  const list = names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return {
    message: `Which do you mean, ${list}?`,
    pending: { kind: 'disambig', words: [...words], start: amb.start, end: amb.end, cands: amb.cands },
  };
}

function missing(game, c, words, firstFail) {
  const { m, p } = c;
  if (m.slotName === 'dir') return { message: "You'll have to say which compass direction to go in." };
  const res = {};
  if (m.slots.noun) {
    const r = resolveSlot(game, words, m.slots.noun, p.action, 'noun');
    if (r.ambig) return askWhich(game, words, r.ambig);
    if (r.error) return { message: r.error };
    if (r.notFound) return { message: firstFail ?? notFoundMsg(game) };
    if (r.ids) res.noun = r.ids;
  }
  const q = `What do you want to ${phrase(game, p, res, m.pi)}?`;
  const last = m.pi === p.els.length - 1;
  if (last && (m.slotName === 'noun' || m.slotName === 'second')) return { message: q, pending: { kind: 'noun', words: [...words] } };
  return { message: q };
}

/** Apply a pending question's answer. Returns new words or null if it is a fresh command. */
export function applyPending(game, pend, words) {
  if (pend.kind === 'noun') {
    if (VERB_WORDS.has(words[0])) return null;
    return [...pend.words, ...words];
  }
  if (pend.kind === 'disambig') {
    const ws = words.filter((w) => !ARTICLES.has(w) && w !== 'one');
    if (!ws.length) return null;
    if (ws.length > 1 && VERB_WORDS.has(ws[0])) return null;
    let pick = null;
    if (ws.length === 1 && ws[0] in ORDINALS) {
      const i = ORDINALS[ws[0]];
      pick = pend.cands.at(i);
    } else {
      const hits = pend.cands.filter((id) => ws.every((w) => game.vocab[id].all.has(w) || game.vocab[id].all.has(w.replace(/s$/, ''))));
      if (hits.length === 1) pick = hits[0];
      else if (hits.length > 1) pick = false; // still ambiguous
    }
    if (pick === null) return null;
    if (pick === false) return { again: pend };
    const out = [...pend.words];
    out.splice(pend.start, pend.end - pend.start, '\u0000' + pick);
    return out;
  }
  return null;
}
