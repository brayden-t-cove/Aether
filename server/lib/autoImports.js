/**
 * Automatic returns imports from marketplace APIs. Each run fetches the last couple of weeks of returns and puts them
 * through the same import as an uploaded report: Amazon's units grouped per order, duplicates skipped (so overlapping
 * windows are safe), products matched, and notes sorted into mentions. New returns count straight away; the Review
 * page is where a person corrects a call.
 */
import { withTransaction } from './db.js';
import { planReturnsImport, runReturnsImport } from './returnsImport.js';
import { RETURNS_TZ } from './returns.js';
import { messages } from './notify.js';

export const AUTO_SOURCES = {
  amazon: { source: 'amazon_returns', label: 'Amazon', lock: 7_310_445 },
  tiktok: { source: 'tiktok_returns', label: 'TikTok', lock: 7_310_446 },
};
// How far back each run looks. Amazon adds returns to the report as they're processed, sometimes days later.
export const DEFAULT_DAYS = 14;

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Import one channel's returns for a date range (default: the last DEFAULT_DAYS days). One run at a time per channel
 * across app instances; a second caller gets { skipped: true }. → the sync_runs row with { created, rows }.
 */
export async function runAutoImport(pool, { channel, client, from, to, trigger = 'schedule', userId = null, notify = null }) {
  const src = AUTO_SOURCES[channel];
  if (!src) throw new Error(`No automatic import for ${channel}`);
  if (!client) return { skipped: true, reason: 'not_configured' };
  const lockClient = await pool.connect();
  let runId = null;
  try {
    const { rows: lock } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [src.lock]);
    if (!lock[0].ok) return { skipped: true, reason: 'already_running' };
    if (!to || !from) {
      const { rows } = await pool.query(`SELECT (now() AT TIME ZONE '${RETURNS_TZ}')::date::text AS today`);
      to = to || rows[0].today;
      from = from || addDays(to, -(DEFAULT_DAYS - 1));
    }
    const { rows: run } = await pool.query('INSERT INTO sync_runs (source, trigger, started_by) VALUES ($1, $2, $3) RETURNING id', [src.source, trigger, userId]);
    runId = run[0].id;

    const rows = await client.returnsReport({ from, to });
    let record = null;
    let units = 0;
    if (rows.length) {
      ({ record, units } = await withTransaction(pool, async (tx) => {
        const plan = await planReturnsImport(tx, { channel, rows });
        const imported = await runReturnsImport(tx, plan, { filename: `${src.label} API · ${from} to ${to}`, userId });
        return { record: imported, units: plan.summary.units };
      }));
    }
    const created = record?.created_count ?? 0;
    if (created) notify?.send(messages.returnsImported(notify, { count: created, units, channel: src.label, who: userId ? 'Someone' : 'Automatic import' }));
    // TikTok's client lists the fields its API sent (names only), to confirm the mapping against a live response.
    const detail = rows.fields?.length ? `Fields ${src.label} sent: ${rows.fields.join(', ')}`.slice(0, 2000) : '';
    const { rows: done } = await pool.query(
      'UPDATE sync_runs SET finished_at = now(), ok = true, rows_read = $2, returns_created = $3, import_id = $4, detail = $5 WHERE id = $1 RETURNING *',
      [runId, rows.length, created, record?.id ?? null, detail],
    );
    return { ...done[0], from, to, created, units: created ? units : 0, rows: rows.length };
  } catch (err) {
    if (runId) await pool.query('UPDATE sync_runs SET finished_at = now(), ok = false, error = $2 WHERE id = $1', [runId, String(err.message).slice(0, 500)]);
    return { ok: false, error: err.message };
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [src.lock]).catch(() => {});
    lockClient.release();
  }
}

// History: how far back the first connection reaches, in month-sized requests (one report per month keeps each within
// the marketplaces' range limits). A run that stops updating for this long was cut off (a restart) and picks up again.
export const HISTORY_MONTHS = 24;
const STALE_MS = 15 * 60_000;
const historyKey = (channel) => `${AUTO_SOURCES[channel].source}_history`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Month-sized windows covering from..to, oldest first: the first and last cut to the range. */
export function monthWindows(from, to) {
  const out = [];
  let start = from;
  while (start <= to) {
    const d = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const next = d.toISOString().slice(0, 10);
    const end = addDays(next, -1);
    out.push({ from: start, to: end < to ? end : to });
    start = next;
  }
  return out;
}

/** Where a channel's history import stands: null (never run), or { status, from, to, through, created, error, … }. */
export async function historyState(db, channel) {
  const { rows } = await db.query('SELECT value, updated_at FROM job_state WHERE key = $1', [historyKey(channel)]);
  if (!rows[0]) return null;
  let state;
  try {
    state = JSON.parse(rows[0].value);
  } catch {
    return null;
  }
  // Still marked running but not touched in a while: the server restarted part way through.
  if (state.status === 'running' && Date.now() - new Date(rows[0].updated_at).getTime() > STALE_MS) state.status = 'interrupted';
  return state;
}

async function saveHistory(db, channel, state) {
  await db.query(
    `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [historyKey(channel), JSON.stringify(state)],
  );
}

/**
 * Bring in a channel's past returns, one month at a time from `from` (default HISTORY_MONTHS back) to today, through
 * the same import as every run, so returns already uploaded or imported are skipped. Takes a while (Amazon builds a
 * report per month), so callers don't wait on it. Resumes after `resume.through` when picking up a cut-off run.
 * Posts one Slack message at the end, not one per month.
 */
export async function runHistoryImport(pool, { channel, client, from, userId = null, notify = null, resume = null, retryMs = 60_000 }) {
  const { rows } = await pool.query(`SELECT (now() AT TIME ZONE '${RETURNS_TZ}')::date::text AS today`);
  const to = rows[0].today;
  if (!from) {
    const d = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (HISTORY_MONTHS - 1));
    from = d.toISOString().slice(0, 10);
  }
  const state = resume
    ? { ...resume, status: 'running', error: null }
    : { status: 'running', from, to, through: null, created: 0, units: 0, error: null, started_at: new Date().toISOString(), started_by: userId };
  await saveHistory(pool, channel, state);
  const windows = monthWindows(state.from, state.to).filter((w) => !state.through || w.from > state.through);
  for (const w of windows) {
    let run;
    // A scheduled run holding the channel's lock: wait for it rather than skip the month.
    for (let tries = 0; tries < 10; tries++) {
      run = await runAutoImport(pool, { channel, client, from: w.from, to: w.to, trigger: 'history', userId });
      if (!run.skipped) break;
      await sleep(retryMs);
    }
    if (run.skipped || run.ok === false) {
      Object.assign(state, { status: 'failed', error: run.error || 'Another import kept running', finished_at: new Date().toISOString() });
      await saveHistory(pool, channel, state);
      return state;
    }
    state.created += run.created;
    state.units = (state.units ?? 0) + run.units;
    state.through = w.to;
    await saveHistory(pool, channel, state);
  }
  Object.assign(state, { status: 'done', finished_at: new Date().toISOString() });
  await saveHistory(pool, channel, state);
  if (state.created) {
    notify?.send(messages.returnsImported(notify, { count: state.created, units: state.units, channel: `${AUTO_SOURCES[channel].label} (history since ${state.from})`, who: 'Automatic import' }));
  }
  return state;
}

const running = new Set();

/**
 * Start a channel's history import in the background unless one is already going. `when`: 'always' (someone asked),
 * or 'first' (only if it has never run, or to pick up one a restart cut off). → { started, state }.
 */
export async function startHistoryImport(pool, { channel, client, from, userId = null, notify = null, when = 'always', log = console }) {
  const state = await historyState(pool, channel);
  if (running.has(channel) || state?.status === 'running') return { started: false, reason: 'running', state };
  const resume = state?.status === 'interrupted' ? state : null;
  if (when === 'first' && state && !resume) return { started: false, reason: 'done', state };
  running.add(channel);
  runHistoryImport(pool, { channel, client, from, userId, notify, resume: when === 'first' ? resume : null })
    .then((s) => s.status === 'failed' && log.error(`[jobs] ${channel} returns history: ${s.error}`))
    .catch((err) => log.error(`[jobs] ${channel} returns history failed:`, err.message))
    .finally(() => running.delete(channel));
  return { started: true };
}

/** A channel's latest runs, newest first, and when one last succeeded. */
export async function lastAutoImports(db, channel, limit = 5) {
  const { source } = AUTO_SOURCES[channel];
  const { rows } = await db.query(
    `SELECT r.id, r.trigger, r.started_at, r.finished_at, r.ok, r.error, r.rows_read, r.returns_created, r.import_id, r.detail, u.name AS started_by_name
       FROM sync_runs r LEFT JOIN users u ON u.id = r.started_by
      WHERE r.source = $1 ORDER BY r.started_at DESC LIMIT $2`,
    [source, limit],
  );
  const { rows: ok } = await db.query('SELECT max(finished_at) AS at FROM sync_runs WHERE source = $1 AND ok', [source]);
  return { runs: rows, lastSuccessAt: ok[0].at };
}
