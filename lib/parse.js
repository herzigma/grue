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
const END_QUESTION_RE = /\b(restart|restore|quit|undo|play again|start over|end this session)\b/i;

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
 * Detect a game-ending banner ("*** You have died ***") followed by the
 * RESTART/RESTORE/QUIT question. Zork-style death-with-reincarnation has no such
 * question and is not an ending.
 * @returns {{ending: 'won'|'died'|'ended', banner: string}|null}
 */
export function detectEndingBanner(text, { score = null, max_score = null } = {}) {
  if (!text) return null;
  const last = lastBanner(text);
  if (!last) return null;
  const after = text.slice(last.index + last[0].length);
  if (!END_QUESTION_RE.test(after)) return null;
  return { ending: classifyBanner(last[1], score, max_score), banner: last[1] };
}

/** Text of the last "*** ... ***" banner, or null (used when the process exits on its own). */
export function findBanner(text) {
  if (!text) return null;
  const last = lastBanner(text);
  return last ? last[1] : null;
}

const INVALID_PATTERNS = [
  /\bI don'?t know the word\b/i,
  /\bThat'?s not a verb I recogni[sz]e\b/i,
  /\bI (?:didn'?t|did not) understand (?:that|the) (?:sentence|number)\b/i,
  /\bI don'?t understand (?:that|this) (?:sentence|command)\b/i,
  /\bYou can'?t see any such thing\b/i,
  /\bI beg your pardon\b/i,
  /\bThere was no verb in that sentence\b/i,
  /\bI only understood you as far as\b/i,
  /\bThat noun did not make sense in this context\b/i,
  /\bThat'?s not something you need to refer to\b/i,
  /\bThe word "[^"]*" (?:is not|isn'?t) necessary in this story\b/i,
  /\bYou used the word "[^"]*" in a way that I don'?t understand\b/i,
  /\bThat sentence (?:isn'?t|is not) one I recogni[sz]e\b/i,
  /\bI don'?t see any such thing\b/i,
];

/** Did the game reject the last command as unparseable? */
export function isInvalidCommandResponse(text) {
  if (!text) return false;
  return INVALID_PATTERNS.some((re) => re.test(text));
}

/** Did the player ask to quit? */
export function isQuitCommand(command) {
  return /^\s*(?:quit|q|exit|bye)\s*$/i.test(command || '');
}
