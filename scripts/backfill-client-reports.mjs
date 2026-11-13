#!/usr/bin/env node
/**
 * One-off: add `client_report` / `client_report_at` and the run settings that were not sent as session
 * meta to the featured results, from the matching Brass Lantern run folders (run.json).
 *
 *   node scripts/backfill-client-reports.mjs [--runs <dir>] [--featured <results dir>] [--dry-run]
 *
 * Defaults: ../brass-lantern/runs/official-2026-11-13 and data/featured/2026-11-benchmark/results.
 * Results are matched by session id (and must agree with run.json on game, turns and score). Scores and
 * every other existing field are left alone; existing meta keys are never overwritten. Safe to re-run:
 * a result that already has a client_report is skipped.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every run.json under `dir`, parsed, keyed by Grue session id. */
export function loadRuns(dir) {
  const runs = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== 'run.json') continue;
      try {
        const run = JSON.parse(fs.readFileSync(p, 'utf8'));
        const id = run.session_id || run.result?.session_id;
        if (id) runs.set(id, run);
      } catch { /* unreadable run.json */ }
    }
  };
  walk(dir);
  return runs;
}

const orNull = (v) => (v === undefined ? null : v);

/** The contract's client_report keys from a run.json. Values run.json does not carry are null. */
export function buildClientReport(run) {
  const t = run.totals || {};
  return {
    input_tokens: orNull(t.input_tokens),
    output_tokens: orNull(t.output_tokens),
    cache_read_tokens: orNull(t.cache_read_tokens),
    cache_write_tokens: orNull(t.cache_write_tokens),
    cost_usd: orNull(t.cost_usd),
    cost_source: typeof t.cost_usd === 'number' ? 'provider' : null, // these runs went through OpenRouter
    model_time_s: orNull(t.model_time_s),
    parse_failures: orNull(t.parse_failures),
    provider_errors: orNull(t.provider_errors),
    stop_reason: orNull(run.stop_reason),
    status: orNull(run.status),
    client_version: orNull(run.version),
  };
}

/** Meta keys known from run.json settings (not the ones the result's meta already has). */
export function buildMetaAdditions(run, existingMeta = {}) {
  const c = run.config || {};
  const known = {
    format: 'text',
    cache: false,
    history: c.history,
    notes: c.notes,
    max_tokens: c.max_tokens,
    temperature: c.temperature,
    effort: typeof c.reasoning === 'string' ? c.reasoning : c.effort,
  };
  const out = {};
  for (const [k, v] of Object.entries(known)) {
    if (v !== undefined && v !== null && !(k in existingMeta)) out[k] = v;
  }
  return out;
}

/** Why a run cannot be used for a result, or null when it agrees with it. */
export function mismatch(result, run) {
  const t = run.totals || {};
  if (run.game !== undefined && run.game !== result.game_id) return `game ${run.game} != ${result.game_id}`;
  if (t.turns !== undefined && t.turns !== result.turn) return `turns ${t.turns} != ${result.turn}`;
  if (t.score !== undefined && t.score !== result.score) return `score ${t.score} != ${result.score}`;
  return null;
}

/**
 * The backfilled copy of a result, or null if it already has a client_report. Existing fields keep their
 * values and order; new meta keys and the two report fields are appended.
 */
export function backfillResult(result, run, now = new Date()) {
  if (result.client_report !== undefined) return null;
  return {
    ...result,
    meta: { ...result.meta, ...buildMetaAdditions(run, result.meta) },
    client_report: buildClientReport(run),
    client_report_at: now.toISOString(),
  };
}

/** Run the backfill over a results directory. Returns counts and the problems found. */
export function backfillDir(resultsDir, runs, { dryRun = false, now = new Date() } = {}) {
  const stats = { files: 0, matched: 0, updated: 0, already: 0, unmatched: [], mismatched: [] };
  for (const name of fs.readdirSync(resultsDir).filter((n) => n.endsWith('.json')).sort()) {
    stats.files++;
    const file = path.join(resultsDir, name);
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    const run = runs.get(result.session_id);
    if (!run) { stats.unmatched.push(name); continue; }
    const why = mismatch(result, run);
    if (why) { stats.mismatched.push(`${name}: ${why}`); continue; }
    stats.matched++;
    const next = backfillResult(result, run, now);
    if (!next) { stats.already++; continue; }
    if (!dryRun) {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    }
    stats.updated++;
  }
  return stats;
}

function main(argv) {
  const arg = (flag, fallback) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : fallback; };
  const runsDir = path.resolve(arg('--runs', path.join(ROOT, '..', 'brass-lantern', 'runs', 'official-2026-11-13')));
  const resultsDir = path.resolve(arg('--featured', path.join(ROOT, 'data', 'featured', '2026-11-benchmark', 'results')));
  const dryRun = argv.includes('--dry-run');
  const runs = loadRuns(runsDir);
  const s = backfillDir(resultsDir, runs, { dryRun });
  console.log(`${runs.size} run.json files under ${runsDir}`);
  console.log(`${s.matched} of ${s.files} featured results matched; ${s.updated} ${dryRun ? 'would be ' : ''}updated, ${s.already} already had a client_report`);
  for (const n of s.unmatched) console.log(`  no run found: ${n}`);
  for (const m of s.mismatched) console.log(`  skipped, run disagrees: ${m}`);
  if (s.unmatched.length || s.mismatched.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
