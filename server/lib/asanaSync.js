/**
 * Pull comments from Asana tasks linked to checklist items into the items' updates. Read-only: nothing goes back.
 *
 * Each Asana comment is copied once (keyed by its ID), follows edits made in Asana, and is removed if it was deleted
 * there. Its writer is matched to an Aether user by email; otherwise their Asana name is kept. Copies can't be edited
 * in Aether. A task Aether can no longer see is skipped and reported, and the others still pull.
 */
import { logActivity } from './activity.js';

const LOCK_ID = 7_310_444;
const MAX_BODY = 5000;

/** Copy one item's comments from its task. → { added, updated, removed } */
async function pullItem(db, client, item, usersByEmail) {
  const comments = await client.listComments(item.asana_task_gid);
  const stats = { added: 0, updated: 0, removed: 0 };
  const seen = [];
  for (const c of comments) {
    const body = String(c.text ?? '').trim().slice(0, MAX_BODY);
    if (!body) continue; // e.g. a comment that is only an attachment
    seen.push(c.gid);
    const author = usersByEmail.get(String(c.created_by?.email ?? '').toLowerCase()) ?? null;
    const { rows } = await db.query(
      `INSERT INTO item_comments (item_id, body, state, created_by, created_at, source, external_id, author_label)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), 'asana', $6, $7)
       ON CONFLICT (external_id) DO UPDATE
         SET body = EXCLUDED.body, created_by = EXCLUDED.created_by, author_label = EXCLUDED.author_label,
             edited_at = CASE WHEN item_comments.body <> EXCLUDED.body THEN now() ELSE item_comments.edited_at END
       RETURNING (xmax = 0) AS inserted, COALESCE(edited_at = now(), false) AS changed`,
      [item.id, body, item.state, author, c.created_at ?? null, c.gid, String(c.created_by?.name ?? '')],
    );
    if (rows[0].inserted) stats.added++;
    else if (rows[0].changed) stats.updated++;
  }
  const { rowCount } = await db.query(
    `DELETE FROM item_comments WHERE item_id = $1 AND source = 'asana' AND NOT (external_id = ANY($2::text[]))`,
    [item.id, seen],
  );
  stats.removed = rowCount;
  await db.query('UPDATE checklist_items SET asana_pulled_at = now() WHERE id = $1', [item.id]);
  return stats;
}

/**
 * Pull comments for every linked item, or only those of `projectId` / `itemIds`. Only one pull runs at a time across
 * app instances; a second caller gets { skipped: true }. → the sync_runs row, plus { added, updated, removed, failed }.
 */
export async function pullAsanaComments(pool, client, { trigger = 'schedule', userId = null, projectId, itemIds } = {}) {
  if (!client) return { skipped: true, reason: 'not_configured' };
  const lockClient = await pool.connect();
  let runId = null;
  try {
    const { rows: lock } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!lock[0].ok) return { skipped: true, reason: 'already_running' };

    const { rows: run } = await pool.query("INSERT INTO sync_runs (source, trigger, started_by) VALUES ('asana', $1, $2) RETURNING id", [trigger, userId]);
    runId = run[0].id;
    const where = ['i.asana_task_gid IS NOT NULL'];
    const params = [];
    if (projectId) where.push(`i.project_id = $${params.push(projectId)}`);
    if (itemIds) where.push(`i.id = ANY($${params.push(itemIds)}::uuid[])`);
    const { rows: items } = await pool.query(
      `SELECT i.id, i.title, i.state, i.project_id, i.asana_task_gid FROM checklist_items i WHERE ${where.join(' AND ')} ORDER BY i.project_id, i.position`,
      params,
    );
    const { rows: users } = await pool.query('SELECT id, lower(email) AS email FROM users');
    const usersByEmail = new Map(users.map((u) => [u.email, u.id]));

    const totals = { added: 0, updated: 0, removed: 0 };
    const failed = [];
    for (const item of items) {
      try {
        const s = await pullItem(pool, client, item, usersByEmail);
        for (const k of Object.keys(totals)) totals[k] += s[k];
        if (s.added) {
          await logActivity(pool, {
            entityType: 'project',
            entityId: item.project_id,
            action: 'asana_comments',
            changes: { label: item.title, item_id: item.id, count: s.added },
            userId,
          });
        }
      } catch (err) {
        // A token problem stops the whole pull; a task that is gone or hidden only skips that item.
        if (err.status === 401) throw err;
        failed.push({ item_id: item.id, title: item.title, error: err.message });
      }
    }

    const error = failed.length ? `${failed.length} linked task${failed.length === 1 ? '' : 's'} couldn't be read: ${failed[0].title}: ${failed[0].error}` : null;
    const { rows: done } = await pool.query(
      'UPDATE sync_runs SET finished_at = now(), ok = $2, error = $3, comments_synced = $4 WHERE id = $1 RETURNING *',
      [runId, !failed.length, error, totals.added],
    );
    return { ...done[0], ...totals, items: items.length, failed };
  } catch (err) {
    if (runId) await pool.query('UPDATE sync_runs SET finished_at = now(), ok = false, error = $2 WHERE id = $1', [runId, String(err.message).slice(0, 500)]);
    return { ok: false, error: err.message };
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

/** The latest pulls, newest first, and when one last succeeded. */
export async function lastAsanaPulls(db, limit = 5) {
  const { rows } = await db.query(
    `SELECT r.id, r.trigger, r.started_at, r.finished_at, r.ok, r.error, r.comments_synced, u.name AS started_by_name
       FROM sync_runs r LEFT JOIN users u ON u.id = r.started_by
      WHERE r.source = 'asana' ORDER BY r.started_at DESC LIMIT $1`,
    [limit],
  );
  const { rows: ok } = await db.query("SELECT max(finished_at) AS at FROM sync_runs WHERE source = 'asana' AND ok");
  return { runs: rows, lastSuccessAt: ok[0].at };
}
