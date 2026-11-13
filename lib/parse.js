/**
 * Parsing heuristics for interactive-fiction output (PROTOCOL.md section 7).
 * Pure functions, no I/O -- unit tested against realistic Inform 6/7 and Infocom strings.
 */

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty-five': 25, fifty: 50, hundred: 100,
};

function toInt(word) {
  if (word === undefined || word === null) return null;
  if (/^-?\d+$/.test(word)) return parseInt(word, 10);
  const n = NUMBER_WORDS[String(word).toLowerCase()];
  return n === undefined ? null : n;
}

const LABEL = '(?:Score|Moves?|Turns?|Time)';

/**
 * Parse a status-line (grid window) string.
 * @param {string|null} statusLine  possibly multi-line; only the first non-blank line is used
 * @returns {{location: string|null, score: number|null, max_score: number|null, moves: number|null}}
 */
export function parseStatusLine(statusLine) {
  const out = { location: null, score: null, max_score: null, moves: null };
  if (!statusLine) return out;
  const line = String(statusLine).split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return out;

  // Labelled forms: "Score: 10  Moves: 20", "Score: 10/350", "Turns: 5"
  const scoreM = line.match(/\bScore\s*:\s*(-?\d+)(?:\s*\/\s*(\d+))?/i);
  const movesM = line.match(/\b(?:Moves?|Turns?)\s*:\s*(\d+)/i);
  if (scoreM) {
    out.score = parseInt(scoreM[1], 10);
    if (scoreM[2] !== undefined) out.max_score = parseInt(scoreM[2], 10);
  }
  if (movesM) out.moves = parseInt(movesM[1], 10);

  // Inform 7 default: "Location        0/12"  (score/turns, right-aligned)
  let tail = null;
  if (!scoreM && !movesM) {
    const i7 = line.match(/\s{2,}(-?\d+)\s*\/\s*(\d+)\s*$/);
    if (i7) {
      out.score = parseInt(i7[1], 10);
      out.moves = parseInt(i7[2], 10);
      tail = i7.index;
    } else {
      // Bare trailing turn counter: "Location        12"
      const bare = line.match(/\s{3,}(\d+)\s*$/);
      if (bare) {
        out.moves = parseInt(bare[1], 10);
        tail = bare.index;
      }
    }
  }

  // Location = everything before the first label/number block.
  let cut = tail;
  const labelAt = line.search(new RegExp(`\\s*\\b${LABEL}\\s*:`, 'i'));
  if (labelAt !== -1 && (cut === null || labelAt < cut)) cut = labelAt;
  let loc = cut === null ? line.split(/\s{2,}/)[0] : line.slice(0, cut);
  // Trim decorations some games put around the room name, e.g. "<< Chief's office >>".
  loc = loc.trim().replace(/^[<>*=\-~|\[\]\s]+|[<>*=\-~|\[\]\s]+$/g, '');
  out.location = loc && !new RegExp(`^${LABEL}\\b`, 'i').test(loc) ? loc : null;
  return out;
}

/**
 * Find score information in free text.
 * @returns {{score?: number, max_score?: number, delta?: number}|null}
 */
export function parseScoreFromText(text) {
  if (!text) return null;
  const out = {};

  // [Your score has just gone up by two points.] / "has just gone down by 1 point"
  const delta = text.match(/\bscore has (?:just )?(?:gone|risen|fallen|dropped|changed)?\s*(up|down)?\s*by\s+([\w-]+)\s+points?/i);
  if (delta) {
    const n = toInt(delta[2]);
    if (n !== null) out.delta = /down/i.test(delta[1] || '') ? -n : n;
  }

  // Zork: "Your score is 0 (total of 350 points), in 3 moves."
  let m = text.match(/\bYour score is\s+(-?\d+)\s*\(\s*total of\s+(\d+)\s+points?\s*\)/i);
  // Inform: "You have so far scored 0 out of a possible 100, in 3 turns"
  if (!m) m = text.match(/\bYou(?:'ve| have)?\s+(?:so far\s+)?scored\s+(-?\d+)\s+(?:points?\s+)?(?:out of|of)\s+(?:a possible\s+)?(\d+)/i);
  // "Your score is 5 out of a possible 20" / "... of a possible 20"
  if (!m) m = text.match(/\bYour score is\s+(-?\d+)\s+(?:out of|of)\s+(?:a possible\s+)?(\d+)/i);
  if (m) {
    out.score = parseInt(m[1], 10);
    out.max_score = parseInt(m[2], 10);
  } else {
    const s = text.match(/\bYou(?:'ve| have)?\s+(?:so far\s+)?scored\s+(-?\d+)\s+points?\b/i)
      || text.match(/\bYour score is\s+(-?\d+)\b/i);
    if (s) out.score = parseInt(s[1], 10);
    const mx = text.match(/\b(?:out of|of)\s+a possible\s+(\d+)\b/i);
    if (mx) out.max_score = parseInt(mx[1], 10);
  }
  return Object.keys(out).length ? out : null;
}

const BANNER_RE = /\*{3,4}\s*([^*\n]+?)\s*\*{3,4}/g;
const END_WORD_RE = /\b(restart|restore|quit|undo|end this session)\b/gi;
/** A real ending banner closes the turn: at most this many non-blank lines may follow it. */
const MAX_LINES_AFTER_BANNER = 6;

/**
 * Are `lines` (the last lines of a turn) the "RESTART, RESTORE or QUIT?" question an ending prints?
 * Needs two or more of the option words and a final line that ends like a question or prompt, so prose
 * such as "You may want to restore your strength" is not mistaken for it.
 */
function isEndQuestion(lines) {
  const last = lines[lines.length - 1] || '';
  if (!/[?:][\s"')\]]*$/.test(last)) return false;
  const tail = lines.join(' ');
  if (/\b(?:play again|start over)\b/i.test(tail)) return true;
  const words = new Set([...tail.matchAll(END_WORD_RE)].map((m) => {
    const w = m[1].toLowerCase();
    return w === 'end this session' ? 'quit' : w;
  }));
  return words.size >= 2;
}

function lastBanner(text) {
  let last = null;
  for (const m of text.matchAll(BANNER_RE)) last = m;
  return last;
}

/** Map banner wording to an ending kind. */
export function classifyBanner(banner, score = null, max_score = null) {
  if (/\b(won|win|victory|victorious|triumph|success|solved|completed?)\b/i.test(banner)) return 'won';
  if (/\b(died|dead|killed|lost|lose|destroyed|eaten|perished)\b/i.test(banner)) return 'died';
  if (max_score && score !== null && score >= max_score) return 'won';
  return 'ended';
}

/**
 * Detect a game-ending banner ("*** You have died ***") that closes the turn text and is followed,
 * in the final lines, by the RESTART/RESTORE/QUIT question. Zork-style death-with-reincarnation has
 * no such question, and a chapter banner in the middle of a turn is not near its end, so neither is
 * an ending.
 * @returns {{ending: 'won'|'died'|'ended', banner: string}|null}
 */
export function detectEndingBanner(text, { score = null, max_score = null } = {}) {
  if (!text) return null;
  const last = lastBanner(text);
  if (!last) return null;
  const after = text.slice(last.index + last[0].length)
    .split('\n').map((l) => l.trim()).filter(Boolean);
  if (after.length === 0 || after.length > MAX_LINES_AFTER_BANNER) return null;
  if (!isEndQuestion(after.slice(-2))) return null;
  return { ending: classifyBanner(last[1], score, max_score), banner: last[1] };
}

/** Text of the last "*** ... ***" banner, or null (used when the process exits on its own). */
export function findBanner(text) {
  if (!text) return null;
  const last = lastBanner(text);
  return last ? last[1] : null;
}

/**
 * Parser-failure messages, matched at the START of the response only (its first line), so NPC
 * dialogue or prose that merely contains the same words does not count. Real strings from Infocom
 * (Zork I), Inform 6/7 and Grue's native engine. Questions such as "What do you want to take?" and
 * "Which do you mean, ...?" are the parser asking for help, not failing, and are deliberately absent.
 */
const INVALID_PATTERNS = [
  /^I don'?t know the word\b/i, // Infocom, Inform 6: I don't know the word "xyzzyx".
  /^That'?s not a verb I recogni[sz]e\b/i, // Inform, native
  /^I (?:didn'?t|did not) understand (?:that|the) (?:sentence|number)\b/i,
  /^I don'?t understand (?:that|this)(?: (?:sentence|command))?\s*[.!?]/i,
  /^You can'?t see any (?:such thing|[^.!?\n]+ here)\s*[.!]/i, // Infocom: You can't see any sword here!
  /^I don'?t see any such thing\b/i,
  /^I beg your pardon\?/i, // empty command
  /^There was no verb in that sentence\b/i,
  /^There seems to be a noun missing in that sentence\b/i, // Infocom
  /^There (?:were|are) too many nouns in that sentence\b/i, // Infocom
  /^That sentence (?:isn'?t|is not) one I recogni[sz]e\b/i, // Infocom
  /^You used the word "[^"]*" in a way that I don'?t understand\b/i, // Infocom, Inform
  /^You can'?t use multiple (?:direct |indirect )?objects with\b/i, // Infocom, Inform, native
  /^It'?s not clear what you'?re referring to\b/i, // Infocom
  /^I only understood you as far as\b/i,
  /^That noun did not make sense in this context\b/i,
  /^That'?s not something you need to refer to\b/i,
  /^The word "[^"]*" (?:is not|isn'?t) necessary in this story\b/i,
  /^I'?m not sure what "[^"]*" refers to\b/i, // Inform 6
  /^You seem to have said too little\b/i, // Inform 6
  /^You must name something more substantial\b/i, // Inform 7
  /^You'?ll have to say which compass direction to go in\b/i, // native
];

/**
 * Did the game reject the last command as unparseable? Only the first line of the response counts:
 * a parser failure is the whole response (or its opening sentence), never mid-text prose.
 */
export function isInvalidCommandResponse(text) {
  if (!text) return false;
  const first = String(text).replace(/[\u2018\u2019]/g, "'").split('\n').map((l) => l.trim()).find(Boolean);
  if (!first) return false;
  return INVALID_PATTERNS.some((re) => re.test(first));
}

/** Did the player ask to quit? */
export function isQuitCommand(command) {
  return /^\s*(?:quit|q|exit|bye)\s*$/i.test(command || '');
}
