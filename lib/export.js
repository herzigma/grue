/**
 * Flat export of finished runs (GET /api/export.csv and /api/export.jsonl). Pure functions: a Result
 * (plus its meta and client_report) in, one flat row out. Column list and rules: PROTOCOL.md section 10.
 */

export const EXPORT_COLUMNS = [
  'session_id', 'collection', 'game_id', 'started_at', 'ended_at', 'model', 'provider', 'effort', 'format',
  'cache', 'history', 'notes', 'max_tokens', 'temperature', 'agent', 'run_id', 'bench', 'repeat', 'max_turns',
  'turns', 'score', 'max_score', 'score_pct', 'peak_score', 'peak_pct', 'ending', 'won', 'invalid_commands', 'invalid_rate',
  'unique_locations', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd',
  'cost_source', 'model_time_s', 'parse_failures',
];

const META_COLUMNS = ['model', 'effort', 'format', 'cache', 'history', 'notes', 'max_tokens', 'temperature',
  'agent', 'run_id', 'bench', 'repeat'];
const REPORT_COLUMNS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd',
  'cost_source', 'model_time_s', 'parse_failures'];

/** Strings, finite numbers and booleans pass through; anything else (missing, null, objects) is null. */
function scalar(v) {
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** One flat row (an object whose keys are EXPORT_COLUMNS, in order) for a Result. */
export function exportRow(result) {
  const r = result || {};
  const meta = r.meta && typeof r.meta === 'object' ? r.meta : {};
  const report = r.client_report && typeof r.client_report === 'object' ? r.client_report : {};
  const row = {
    session_id: scalar(r.session_id),
    collection: scalar(r.collection),
    game_id: scalar(r.game_id),
    started_at: scalar(r.started_at),
    ended_at: scalar(r.ended_at),
  };
  for (const k of META_COLUMNS) {
    row[k] = scalar(meta[k]);
    if (k === 'model') {
      const i = typeof row.model === 'string' ? row.model.indexOf(':') : -1;
      row.provider = i > 0 ? row.model.slice(0, i) : null;
    }
  }
  const turns = scalar(r.turn);
  const score = scalar(r.score);
  const maxScore = scalar(r.max_score);
  const invalid = scalar(r.invalid_commands);
  // Peak = the highest score the run ever reached (what TALES and TextQuests rank on); final score can be lower.
  const reached = scalar(r.max_score_reached);
  const peak = isNum(reached) ? Math.max(reached, isNum(score) ? score : reached) : score;
  const pctOf = (v) => (isNum(v) && isNum(maxScore) && maxScore > 0 ? Math.round((v / maxScore) * 1000) / 10 : null);
  Object.assign(row, {
    max_turns: scalar(r.max_turns),
    turns,
    score,
    max_score: maxScore,
    score_pct: pctOf(score),
    peak_score: peak,
    peak_pct: pctOf(peak),
    ending: scalar(r.ending),
    won: r.ending === 'won',
    invalid_commands: invalid,
    invalid_rate: isNum(invalid) && isNum(turns) && turns > 0 ? Math.round((invalid / turns) * 10000) / 10000 : null,
    unique_locations: scalar(r.unique_locations),
  });
  for (const k of REPORT_COLUMNS) row[k] = scalar(report[k]);
  // Key order is the column order, whatever order the pieces above were added in.
  return Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, row[c] ?? null]));
}

/** Rows for the export: Results (already newest first) filtered by `collection`, mapped to flat rows. */
export function exportRows(results, { collection } = {}) {
  const kept = collection ? results.filter((r) => r.collection === collection) : results;
  return kept.map(exportRow);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180: header row, CRLF line ends (also after the last row), null as an empty cell. */
export function toCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const row of rows) lines.push(EXPORT_COLUMNS.map((c) => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** One JSON object per line; missing values are null. */
export function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row) + '\n').join('');
}

/** `grue-results-YYYYMMDD.<ext>` (UTC date). */
export function exportFilename(ext, now = new Date()) {
  return `grue-results-${now.toISOString().slice(0, 10).replace(/-/g, '')}.${ext}`;
}
