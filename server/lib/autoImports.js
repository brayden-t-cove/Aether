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
    return { ...done[0], from, to, created, rows: rows.length };
  } catch (err) {
    if (runId) await pool.query('UPDATE sync_runs SET finished_at = now(), ok = false, error = $2 WHERE id = $1', [runId, String(err.message).slice(0, 500)]);
    return { ok: false, error: err.message };
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [src.lock]).catch(() => {});
    lockClient.release();
  }
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
