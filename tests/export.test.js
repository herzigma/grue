// Client report (POST /api/sessions/:id/report), the CSV/JSONL export, and the featured backfill script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { testServer } from './helpers.js';
import { EXPORT_COLUMNS, exportRow, exportRows, toCsv, toJsonl, exportFilename } from '../lib/export.js';
import {
  loadRuns, buildClientReport, buildMetaAdditions, backfillResult, backfillDir, mismatch,
} from '../scripts/backfill-client-reports.mjs';

const KEY_A = 'test-key-a';
const KEY_B = 'test-key-b';
const A = { Authorization: `Bearer ${KEY_A}` };
const B = { Authorization: `Bearer ${KEY_B}` };
const FSID = '22222222-3333-4444-8555-666666666666';
const REPORT = {
  input_tokens: 65890, output_tokens: 1062, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.00712,
  cost_source: 'provider', model_time_s: 19.88, parse_failures: 1, provider_errors: 0, stop_reason: 'completed',
  status: 'completed', client_version: '0.2.0',
};

let s;
let featuredDir;

/** Minimal RFC 4180 parser (quoted cells, doubled quotes, CRLF) so the tests check round-trips. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += c;
  }
  assert.equal(cell, '', 'CSV ends with CRLF');
  assert.equal(row.length, 0, 'CSV ends with CRLF');
  return rows;
}

/** Start a session with `meta`, end it, return the session id. */
async function finished(meta, headers = A, game = 'lantern-lane') {
  const o = await s.post('/api/sessions', { game, meta }, headers);
  assert.equal(o.status, 201);
  assert.equal((await s.del(`/api/sessions/${o.json.session_id}`, headers)).status, 200);
  return o.json.session_id;
}

before(async () => {
  featuredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-featured-'));
  const c = path.join(featuredDir, 'demo-collection');
  fs.mkdirSync(path.join(c, 'results'), { recursive: true });
  fs.writeFileSync(path.join(c, 'results', `${FSID}.json`), JSON.stringify({
    session_id: FSID, game_id: 'skerrin-light', started_at: '2026-11-13T00:00:00Z', ended_at: '2026-11-13T00:05:00Z',
    turn: 40, max_turns: 150, score: 25, max_score: 50, ending: 'turn_limit', invalid_commands: 4, unique_locations: 9,
    meta: { model: 'openrouter:z-ai/glm-5.3-flash', effort: 'low', temperature: 0.7 },
    client_report: { input_tokens: 1000, output_tokens: 50, cost_usd: 0.0123, cost_source: 'provider' },
  }));
  s = await testServer({ API_KEYS: [KEY_A, KEY_B], FEATURED_DIR: featuredDir });
});
after(async () => { await s.close(); });

// -- POST /api/sessions/:id/report ---------------------------------------------------------------

test('report: needs a key, and only the owning key can report', async () => {
  const id = await finished({ model: 'mock-owner:x' }, A);
  assert.equal((await s.post(`/api/sessions/${id}/report`, { client_report: REPORT })).status, 401);
  const other = await s.post(`/api/sessions/${id}/report`, { client_report: REPORT }, B);
  assert.equal(other.status, 404);
  assert.equal(other.json.error, 'unknown_session');
  assert.equal((await s.get(`/api/results/${id}`)).json.client_report, undefined, 'a rejected report changes nothing');
  assert.equal((await s.post(`/api/sessions/${id}/report`, { client_report: REPORT }, A)).status, 200);
});

test('report: unknown session is 404, wrong method is 405', async () => {
  const r = await s.post('/api/sessions/99999999-aaaa-4bbb-8ccc-dddddddddddd/report', { client_report: REPORT }, A);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'unknown_session');
  const id = await finished({});
  assert.equal((await s.get(`/api/sessions/${id}/report`, A)).status, 405);
});

test('report: only after the session has finished, and only once', async () => {
  const o = await s.post('/api/sessions', { game: 'lantern-lane', meta: { model: 'mock-once:x' } }, A);
  const id = o.json.session_id;
  const early = await s.post(`/api/sessions/${id}/report`, { client_report: REPORT }, A);
  assert.equal(early.status, 409);
  assert.equal(early.json.error, 'session_active');
  await s.del(`/api/sessions/${id}`, A);

  const ok = await s.post(`/api/sessions/${id}/report`, { client_report: REPORT }, A);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.session_id, id);
  assert.deepEqual(ok.json.client_report, REPORT);
  assert.match(ok.json.client_report_at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.equal(ok.json.ending, 'aborted', 'the rest of the result is untouched');

  const again = await s.post(`/api/sessions/${id}/report`, { client_report: { input_tokens: 1 } }, A);
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'already_reported');
  assert.deepEqual((await s.get(`/api/results/${id}`)).json.client_report, REPORT, 'the first report stands');
  // DELETE on a finished session returns the same, updated result
  assert.deepEqual((await s.del(`/api/sessions/${id}`, A)).json.client_report, REPORT);
});

test('report: validates size and shape', async () => {
  const id = await finished({});
  const bad = async (body) => {
    const r = await s.post(`/api/sessions/${id}/report`, body, A);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(r.json.error, 'bad_request');
  };
  await bad({});
  await bad({ client_report: null });
  await bad({ client_report: 'x' });
  await bad({ client_report: [1, 2] });
  await bad({ client_report: { nested: { a: 1 } } });
  await bad({ client_report: { list: [1] } });
  await bad({ client_report: { note: 'x'.repeat(201) } });
  await bad({ client_report: { filler: 'y'.repeat(200), more: 'y'.repeat(200), again: Array(20).fill('z'.repeat(200)).join('') } });
  const many = {};
  for (let i = 0; i < 700; i++) many[`k${i}`] = i; // flat and tiny values, but over 4096 bytes in total
  await bad({ client_report: many });
  assert.equal((await s.post(`/api/sessions/${id}/report`, '{not json', A)).status, 400);
  // none of the failures used up the one report
  assert.equal((await s.get(`/api/results/${id}`)).json.client_report, undefined);
  const edge = { s: 'x'.repeat(200), n: -1.5, b: false, z: null };
  const ok = await s.post(`/api/sessions/${id}/report`, { client_report: edge }, A);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.client_report, edge);
});

test('report: shows up at once in the results API, is written to disk, and survives a restart', async () => {
  const id = await finished({ model: 'mock-persist:x' });
  await s.post(`/api/sessions/${id}/report`, { client_report: REPORT }, A);
  const listed = (await s.get('/api/results?include_tests=1')).json.results.find((r) => r.session_id === id);
  assert.deepEqual(listed.client_report, REPORT);
  assert.deepEqual((await s.get(`/api/results/${id}`)).json.client_report, REPORT);

  const file = path.join(s.dir, 'results', `${id}.json`);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.client_report, REPORT);
  assert.equal(onDisk.client_report_at, listed.client_report_at);
  assert.ok(!fs.existsSync(`${file}.tmp`), 'temporary file renamed away');

  const again = await testServer({ API_KEYS: [KEY_A], RESULTS_DIR: path.join(s.dir, 'results'), FEATURED_DIR: '' });
  try {
    assert.deepEqual((await again.get(`/api/results/${id}`)).json.client_report, REPORT, 'reloaded from disk');
    // the live session is gone with the old process: nothing to report on any more
    const late = await again.post(`/api/sessions/${id}/report`, { client_report: REPORT }, A);
    assert.equal(late.status, 404);
    assert.equal(late.json.error, 'unknown_session');
  } finally {
    await again.close();
  }
});

test('report: featured results are read-only', async () => {
  const r = await s.post(`/api/sessions/${FSID}/report`, { client_report: REPORT }, A);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'read_only');
  assert.equal((await s.get(`/api/results/${FSID}`)).json.client_report.input_tokens, 1000, 'unchanged');
});

test('report: works without API keys (no owner scoping)', async () => {
  const open = await testServer();
  try {
    const o = await open.post('/api/sessions', { game: 'lantern-lane' });
    await open.del(`/api/sessions/${o.json.session_id}`);
    assert.equal((await open.post(`/api/sessions/${o.json.session_id}/report`, { client_report: REPORT })).status, 200);
  } finally {
    await open.close();
  }
});

// -- export -------------------------------------------------------------------------------------

test('export: row mapping, derived columns and column order', () => {
  const row = exportRow({
    session_id: 'sid', collection: 'c1', game_id: 'skerrin-light', started_at: 'a', ended_at: 'b', turn: 40, max_turns: 150,
    score: 25, max_score: 50, max_score_reached: 30, ending: 'won', invalid_commands: 10, unique_locations: 9,
    meta: { model: 'openrouter:z-ai/glm', effort: 'high', format: 'text', cache: false, history: 30, notes: true, max_tokens: 1024,
      temperature: 0.7, agent: 'brass-lantern/0.2.0', run_id: 'r1', bench: 'budget', repeat: 2, ignored: 'x' },
    client_report: { ...REPORT, extra: 'ignored' },
  });
  assert.deepEqual(Object.keys(row), EXPORT_COLUMNS);
  assert.equal(EXPORT_COLUMNS.length, 38);
  assert.deepEqual(row, {
    session_id: 'sid', collection: 'c1', game_id: 'skerrin-light', started_at: 'a', ended_at: 'b', model: 'openrouter:z-ai/glm',
    provider: 'openrouter', effort: 'high', format: 'text', cache: false, history: 30, notes: true, max_tokens: 1024, temperature: 0.7,
    agent: 'brass-lantern/0.2.0', run_id: 'r1', bench: 'budget', repeat: 2, max_turns: 150, turns: 40, score: 25, max_score: 50,
    score_pct: 50, peak_score: 30, peak_pct: 60, ending: 'won', won: true, invalid_commands: 10, invalid_rate: 0.25, unique_locations: 9,
    input_tokens: 65890, output_tokens: 1062, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.00712, cost_source: 'provider',
    model_time_s: 19.88, parse_failures: 1,
  });
});

test('export: missing values, odd inputs, rounding', () => {
  const bare = exportRow({ session_id: 'x', turn: 0, ending: 'aborted', score: null, max_score: null, invalid_commands: 0 });
  assert.equal(bare.provider, null);
  assert.equal(bare.score_pct, null);
  assert.equal(bare.invalid_rate, null, 'no turns, no rate');
  assert.equal(bare.won, false);
  assert.equal(bare.model, null);
  assert.equal(bare.cost_usd, null);
  assert.equal(exportRow({ meta: { model: 'no-colon' } }).provider, null);
  assert.equal(exportRow({ meta: { model: ':x' } }).provider, null);
  assert.equal(exportRow({ score: 1, max_score: 3 }).score_pct, 33.3);
  assert.equal(exportRow({ score: 5, max_score: 0 }).score_pct, null);
  // peak falls back to the final score, and is never below it
  assert.equal(exportRow({ score: 7, max_score: 10 }).peak_pct, 70);
  assert.equal(exportRow({ score: 7, max_score: 10, max_score_reached: 4 }).peak_score, 7);
  assert.equal(bare.peak_score, null);
  assert.equal(exportRow({ turn: 3, invalid_commands: 1 }).invalid_rate, 0.3333);
  // objects in meta or the report never leak into a cell
  const odd = exportRow({ meta: { model: { a: 1 }, effort: ['x'], notes: null }, client_report: 'nope' });
  assert.equal(odd.model, null);
  assert.equal(odd.effort, null);
  assert.equal(odd.notes, null);
  assert.equal(odd.input_tokens, null);
  assert.equal(exportRow(null).session_id, null);
});

test('export: CSV quoting, header, CRLF and nulls', () => {
  const rows = exportRows([
    { session_id: 's1', game_id: 'g', meta: { model: 'p:a,b', run_id: 'say "hi"', agent: 'line1\nline2', bench: ' x ' }, turn: 2, score: 1, max_score: 2 },
    { session_id: 's2', game_id: 'g', meta: {} },
  ]);
  const csv = toCsv(rows);
  assert.ok(csv.startsWith(EXPORT_COLUMNS.join(',') + '\r\n'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(csv.includes('"p:a,b"'));
  assert.ok(csv.includes('"say ""hi"""'));
  assert.ok(csv.includes('"line1\nline2"'));
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 3);
  assert.ok(parsed.every((r) => r.length === EXPORT_COLUMNS.length));
  const col = (name) => parsed[0].indexOf(name);
  assert.equal(parsed[1][col('model')], 'p:a,b');
  assert.equal(parsed[1][col('run_id')], 'say "hi"');
  assert.equal(parsed[1][col('agent')], 'line1\nline2');
  assert.equal(parsed[1][col('score_pct')], '50');
  assert.equal(parsed[1][col('won')], 'false');
  assert.equal(parsed[2][col('model')], '', 'missing is an empty cell');
  assert.equal(toCsv([]), EXPORT_COLUMNS.join(',') + '\r\n');
});

test('export: JSONL has one object per line with null for missing', () => {
  const out = toJsonl(exportRows([{ session_id: 'a', turn: 1 }, { session_id: 'b' }]));
  const lines = out.split('\n');
  assert.equal(lines.pop(), '');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(first), EXPORT_COLUMNS);
  assert.equal(first.turns, 1);
  assert.equal(first.model, null);
  assert.equal(toJsonl([]), '');
});

test('export: filename uses the UTC date', () => {
  assert.equal(exportFilename('csv', new Date('2026-11-13T23:59:00Z')), 'grue-results-20261113.csv');
  assert.equal(exportFilename('jsonl', new Date('2026-01-02T00:00:00Z')), 'grue-results-20260102.jsonl');
});

test('export: endpoints, headers, filters, include_tests, newest first', async () => {
  const meta = { model: 'openrouter:acme/x, "y"', effort: 'high', format: 'text', cache: false, history: 30, run_id: 'run,1' };
  const id1 = await finished(meta);
  await s.post(`/api/sessions/${id1}/report`, { client_report: REPORT }, A);
  const id2 = await finished({ model: 'openrouter:acme/z', effort: null }, A, 'lantern-lane');
  const idMock = await finished({ model: 'mock:walkthrough.txt' });

  const res = await s.get('/api/export.csv'); // no key: public read
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="grue-results-\d{8}\.csv"$/);
  const table = parseCsv(res.text);
  assert.deepEqual(table[0], EXPORT_COLUMNS);
  const col = (r, name) => r[table[0].indexOf(name)];
  const byId = Object.fromEntries(table.slice(1).map((r) => [col(r, 'session_id'), r]));
  assert.ok(byId[id1] && byId[id2], 'finished runs are listed');
  assert.ok(!byId[idMock], 'harness runs are left out by default');
  assert.equal(col(byId[id1], 'model'), meta.model);
  assert.equal(col(byId[id1], 'provider'), 'openrouter');
  assert.equal(col(byId[id1], 'effort'), 'high');
  assert.equal(col(byId[id1], 'run_id'), 'run,1');
  assert.equal(col(byId[id1], 'cache'), 'false');
  assert.equal(col(byId[id1], 'input_tokens'), '65890');
  assert.equal(col(byId[id1], 'cost_usd'), '0.00712');
  assert.equal(col(byId[id1], 'ending'), 'aborted');
  assert.equal(col(byId[id1], 'won'), 'false');
  assert.equal(col(byId[id2], 'effort'), '');
  assert.equal(col(byId[id2], 'input_tokens'), '', 'not reported');
  const ended = table.slice(1).map((r) => col(r, 'ended_at'));
  assert.deepEqual(ended, [...ended].sort().reverse(), 'newest first');

  const game = parseCsv((await s.get('/api/export.csv?game=lantern-lane')).text).slice(1);
  assert.ok(game.length >= 1 && game.every((r) => col(r, 'game_id') === 'lantern-lane'));
  assert.ok(game.some((r) => col(r, 'session_id') === id2));

  const withTests = parseCsv((await s.get('/api/export.csv?include_tests=1')).text).slice(1);
  assert.ok(withTests.some((r) => col(r, 'session_id') === idMock));

  const jsonl = await s.get('/api/export.jsonl');
  assert.equal(jsonl.status, 200);
  assert.match(jsonl.headers.get('content-type'), /^application\/x-ndjson/);
  assert.match(jsonl.headers.get('content-disposition'), /filename="grue-results-\d{8}\.jsonl"/);
  const objs = jsonl.text.trim().split('\n').map((l) => JSON.parse(l));
  const o1 = objs.find((o) => o.session_id === id1);
  assert.deepEqual(Object.keys(o1), EXPORT_COLUMNS);
  assert.equal(o1.cache, false);
  assert.equal(o1.cost_usd, 0.00712);
  assert.equal(objs.find((o) => o.session_id === id2).effort, null);
  assert.ok(!objs.some((o) => o.session_id === idMock));
  assert.equal((await s.get('/api/export.jsonl?game=lantern-lane&include_tests=1')).text.trim().split('\n')
    .every((l) => JSON.parse(l).game_id === 'lantern-lane'), true);

  assert.equal((await s.post('/api/export.csv', {}, A)).status, 405);
  assert.equal((await s.get('/api/export.csv/extra')).status, 404);
});

test('export: featured results appear with their collection, client_report included', async () => {
  const rows = (await s.get('/api/export.jsonl')).text.trim().split('\n').map((l) => JSON.parse(l));
  const f = rows.find((r) => r.session_id === FSID);
  assert.ok(f, 'featured run exported');
  assert.equal(f.collection, 'demo-collection');
  assert.equal(f.model, 'openrouter:z-ai/glm-5.3-flash');
  assert.equal(f.effort, 'low');
  assert.equal(f.score_pct, 50);
  assert.equal(f.invalid_rate, 0.1);
  assert.equal(f.input_tokens, 1000);
  assert.equal(f.cost_usd, 0.0123);
  assert.equal(f.cost_source, 'provider');
  assert.equal(f.cache, null);

  const only = (await s.get('/api/export.jsonl?collection=demo-collection')).text.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(only.map((r) => r.session_id), [FSID]);
  assert.equal((await s.get('/api/export.jsonl?collection=nope')).text, '');
  const csv = parseCsv((await s.get('/api/export.csv?collection=nope')).text);
  assert.equal(csv.length, 1, 'header only');
});

test('export: public like results, and PUBLIC_READ=false closes it', async () => {
  assert.equal((await s.get('/api/export.csv')).status, 200);
  assert.equal((await s.get('/api/export.jsonl')).status, 200);
  const closed = await testServer({ API_KEYS: [KEY_A], PUBLIC_READ: false, FEATURED_DIR: '' });
  try {
    for (const p of ['/api/export.csv', '/api/export.jsonl']) {
      const r = await closed.get(p);
      assert.equal(r.status, 401);
      assert.equal(r.json.error, 'unauthorized');
      assert.equal((await closed.get(p, A)).status, 200);
    }
  } finally {
    await closed.close();
  }
});

// -- backfill script ----------------------------------------------------------------------------

const RUN = {
  run_id: 'r-1', version: '0.2.0', status: 'completed', stop_reason: 'game_over', model: 'openrouter:acme/x',
  game: 'lantern-lane', session_id: '33333333-4444-4555-8666-777777777777',
  config: { history: 30, notes: false, temperature: 0.7, max_tokens: 1024, reasoning: 'low', meta: {} },
  totals: { turns: 27, score: 10, max_score: 10, input_tokens: 65890, output_tokens: 1062, cost_usd: 0.00712, model_time_s: 19.88, parse_failures: 0 },
};
const RESULT = {
  session_id: RUN.session_id, game_id: 'lantern-lane', turn: 27, score: 10, max_score: 10, ending: 'won',
  meta: { agent: 'brass-lantern/0.2.0', model: 'openrouter:acme/x', temperature: 0.7, bench: 'budget' },
};

test('backfill: client_report has the contract keys, cost_source provider, unknowns null', () => {
  const r = buildClientReport(RUN);
  assert.deepEqual(Object.keys(r), ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd',
    'cost_source', 'model_time_s', 'parse_failures', 'provider_errors', 'stop_reason', 'status', 'client_version']);
  assert.equal(r.input_tokens, 65890);
  assert.equal(r.cost_source, 'provider');
  assert.equal(r.cache_read_tokens, null);
  assert.equal(r.provider_errors, null);
  assert.equal(r.stop_reason, 'game_over');
  assert.equal(r.status, 'completed');
  assert.equal(r.client_version, '0.2.0');
  assert.equal(buildClientReport({ ...RUN, totals: { ...RUN.totals, cost_usd: null } }).cost_source, null);
});

test('backfill: meta additions come from run settings and never overwrite existing keys', () => {
  assert.deepEqual(buildMetaAdditions(RUN, RESULT.meta), {
    format: 'text', cache: false, history: 30, notes: false, max_tokens: 1024, effort: 'low',
  });
  assert.deepEqual(buildMetaAdditions(RUN, { format: 'tools', effort: 'high', history: 5 }), {
    cache: false, notes: false, max_tokens: 1024, temperature: 0.7,
  });
  assert.deepEqual(buildMetaAdditions({ config: {} }, {}), { format: 'text', cache: false }, 'no reasoning setting, no effort');
});

test('backfill: backfillResult leaves scores and existing fields alone, and is one-shot', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const out = backfillResult(RESULT, RUN, now);
  assert.equal(out.score, 10);
  assert.equal(out.turn, 27);
  assert.equal(out.ending, 'won');
  assert.equal(out.meta.model, RESULT.meta.model);
  assert.equal(out.meta.temperature, 0.7);
  assert.equal(out.meta.effort, 'low');
  assert.equal(out.client_report_at, '2026-11-13T12:00:00.000Z');
  assert.equal(out.client_report.cost_usd, 0.00712);
  assert.equal(RESULT.client_report, undefined, 'input not mutated');
  assert.equal(RESULT.meta.effort, undefined);
  assert.equal(backfillResult(out, RUN, now), null, 'already has a client_report');
});

test('backfill: mismatch guards against the wrong run', () => {
  assert.equal(mismatch(RESULT, RUN), null);
  assert.match(mismatch({ ...RESULT, score: 9 }, RUN), /score/);
  assert.match(mismatch({ ...RESULT, turn: 28 }, RUN), /turns/);
  assert.match(mismatch({ ...RESULT, game_id: 'zork1' }, RUN), /game/);
});

test('backfill: backfillDir matches by session id across nested run folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-backfill-'));
  const runsDir = path.join(dir, 'runs');
  const resultsDir = path.join(dir, 'results');
  fs.mkdirSync(path.join(runsDir, 'budget', 'run-a'), { recursive: true });
  fs.mkdirSync(path.join(runsDir, 'frontier', 'run-b'), { recursive: true });
  fs.mkdirSync(resultsDir);
  const second = { ...RUN, session_id: '44444444-5555-4666-8777-888888888888', game: 'skerrin-light', totals: { ...RUN.totals, score: 20, turns: 50 } };
  fs.writeFileSync(path.join(runsDir, 'budget', 'run-a', 'run.json'), JSON.stringify(RUN));
  fs.writeFileSync(path.join(runsDir, 'frontier', 'run-b', 'run.json'), JSON.stringify(second));
  fs.writeFileSync(path.join(runsDir, 'frontier', 'run-b', 'transcript.jsonl'), '');
  const put = (r) => fs.writeFileSync(path.join(resultsDir, `${r.session_id}.json`), JSON.stringify(r, null, 2));
  put(RESULT);
  put({ ...RESULT, session_id: second.session_id, game_id: 'skerrin-light', score: 20, turn: 50 });
  put({ ...RESULT, session_id: '55555555-6666-4777-8888-999999999999' }); // no run for this one
  put({ ...RESULT, session_id: '66666666-7777-4888-8999-aaaaaaaaaaaa', score: 3 }); // disagrees with the run below
  fs.writeFileSync(path.join(runsDir, 'x.json'), '{}');
  fs.mkdirSync(path.join(runsDir, 'c'));
  fs.writeFileSync(path.join(runsDir, 'c', 'run.json'), JSON.stringify({ ...RUN, session_id: '66666666-7777-4888-8999-aaaaaaaaaaaa' }));
  fs.mkdirSync(path.join(runsDir, 'bad'));
  fs.writeFileSync(path.join(runsDir, 'bad', 'run.json'), '{'); // unreadable run.json is skipped

  const runs = loadRuns(runsDir);
  assert.equal(runs.size, 3);
  const stats = backfillDir(resultsDir, runs, { now: new Date('2026-11-13T00:00:00Z') });
  assert.equal(stats.files, 4);
  assert.equal(stats.matched, 2);
  assert.equal(stats.updated, 2);
  assert.equal(stats.unmatched.length, 1);
  assert.equal(stats.mismatched.length, 1);
  const written = JSON.parse(fs.readFileSync(path.join(resultsDir, `${RESULT.session_id}.json`), 'utf8'));
  assert.equal(written.client_report.input_tokens, 65890);
  assert.equal(written.meta.effort, 'low');
  assert.equal(written.score, 10);
  assert.ok(!fs.readdirSync(resultsDir).some((n) => n.endsWith('.tmp')));
  const untouched = JSON.parse(fs.readFileSync(path.join(resultsDir, '66666666-7777-4888-8999-aaaaaaaaaaaa.json'), 'utf8'));
  assert.equal(untouched.client_report, undefined, 'a disagreeing run is not applied');

  const again = backfillDir(resultsDir, runs);
  assert.equal(again.updated, 0);
  assert.equal(again.already, 2);
  const dry = fs.mkdtempSync(path.join(os.tmpdir(), 'grue-backfill-dry-'));
  fs.writeFileSync(path.join(dry, `${RESULT.session_id}.json`), JSON.stringify(RESULT));
  assert.equal(backfillDir(dry, runs, { dryRun: true }).updated, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dry, `${RESULT.session_id}.json`), 'utf8')).client_report, undefined);
});
