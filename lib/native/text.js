// Text helpers: tokenising, command splitting, number words, list formatting.

export const ARTICLES = new Set(['a', 'an', 'the', 'some']);
const MAX_INPUT = 1000;

/** Split one input line into separate commands ("." / ";" / "!" / "then"). */
export function splitCommands(line) {
  const s = String(line ?? '').slice(0, MAX_INPUT);
  return s
    .split(/[.;!]+|\s+then\s+/i)
    .map((x) => x.trim())
    .filter((x) => /[\p{L}\p{N}]/u.test(x));
}

/** Lowercase word tokens. Commas become "and"; "out of" becomes one token. */
export function tokenize(segment) {
  let s = String(segment ?? '').slice(0, MAX_INPUT).normalize('NFKC').toLowerCase();
  s = s.replace(/[‘’`]/g, "'").replace(/,/g, ' and ');
  s = s.replace(/[^\p{L}\p{N}'\-\s]/gu, ' ');
  s = s.replace(/\bout\s+of\b/g, 'outof');
  return s.split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
}

const UNITS = Object.assign(Object.create(null), { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 });
const TEENS = Object.assign(Object.create(null), { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 });
const TENS = Object.assign(Object.create(null), { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });

/**
 * Turn text such as "1724", "1 7 2 4", "seventeen twenty-four" or "one seven two four"
 * into a digit string ("1724"). Returns '' if the text holds anything else.
 */
export function digitsFrom(text) {
  const toks = String(text ?? '').toLowerCase().split(/[\s-]+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d+$/.test(t)) out += t;
    else if (t in UNITS) out += UNITS[t];
    else if (t in TEENS) out += TEENS[t];
    else if (t in TENS) {
      const next = toks[i + 1];
      if (next in UNITS && UNITS[next] > 0) { out += TENS[t] + UNITS[next]; i++; } else out += TENS[t];
    } else return '';
  }
  return out;
}

export function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function joinList(items, conj = 'and') {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ` ${conj} ` + items[items.length - 1];
}
