/**
 * The daily Slack digest: what's overdue, blocked, expiring or waiting for
 * review. Sent once a day after the configured hour; the date it last went
 * out is kept in job_state so restarts and multiple instances don't repeat it.
 */
import { BLOCKED_SQL } from './projects.js';

const DIGEST_KEY = 'slack_digest_last_date';

export async function buildDigest(db, notifier) {
  const n = notifier;
  const [overdue, blocked, certs, review, dueSoon] = await Promise.all([
    db.query(`SELECT i.title, i.due_date::text, p.id AS project_id, p.name AS project FROM checklist_items i JOIN projects p ON p.id = i.project_id
               WHERE p.state <> 'done' AND i.state <> 'done' AND i.due_date < current_date ORDER BY i.due_date LIMIT 8`),
    db.query(`SELECT i.title, p.id AS project_id, p.name AS project FROM checklist_items i JOIN projects p ON p.id = i.project_id
               WHERE p.state <> 'done' AND ${BLOCKED_SQL('i')} ORDER BY p.name LIMIT 8`),
    db.query(`SELECT c.id, c.mark, c.expiry_date::text, pr.name AS product, m.code FROM certifications c
                JOIN products pr ON pr.id = c.product_id JOIN markets m ON m.id = c.market_id
               WHERE c.state = 'certified' AND c.expiry_date < current_date + 30 ORDER BY c.expiry_date LIMIT 8`),
    db.query(`SELECT d.id, d.title, lv.version, pr.name AS product FROM documents d JOIN products pr ON pr.id = d.product_id
                JOIN LATERAL (SELECT version, state FROM document_versions v WHERE v.document_id = d.id ORDER BY v.created_at DESC LIMIT 1) lv
                  ON lv.state = 'in_review' LIMIT 8`),
    db.query(`SELECT count(*)::int AS n FROM checklist_items i JOIN projects p ON p.id = i.project_id
               WHERE p.state <> 'done' AND i.state <> 'done' AND i.due_date BETWEEN current_date AND current_date + 7`),
  ]);

  const section = (title, rows, fmt) => (rows.length ? `*${title}*\n${rows.map((r) => `• ${fmt(r)}`).join('\n')}` : null);
  const parts = [
    section(`Overdue (${overdue.rows.length})`, overdue.rows, (r) => `${n.link(`/projects/${r.project_id}`, r.title)} — ${n.esc(r.project)}, due ${r.due_date}`),
    section(`Blocked (${blocked.rows.length})`, blocked.rows, (r) => `${n.link(`/projects/${r.project_id}`, r.title)} — ${n.esc(r.project)}`),
    section('Certifications expiring within 30 days', certs.rows, (r) => `${n.link(`/certifications/${r.id}`, `${r.mark} · ${r.product} (${r.code})`)} — ${r.expiry_date}`),
    section('Waiting for review', review.rows, (r) => `${n.link(`/manuals/${r.id}`, `${r.title} ${r.version}`)} — ${n.esc(r.product)}`),
  ].filter(Boolean);

  const due = dueSoon.rows[0].n;
  if (!parts.length && !due) return null;
  return [`☀️ *Aether daily digest*${due ? ` · ${due} items due in the next 7 days` : ''}`, ...parts, n.link('/', 'Open the dashboard')].join('\n\n');
}

/** Send today's digest if it's past the hour and it hasn't gone out yet. Returns true if sent. */
export async function maybeSendDigest(db, notifier, { hourUtc, now = new Date(), force = false } = {}) {
  if (!notifier.enabled) return false;
  if (!force && now.getUTCHours() < hourUtc) return false;
  const today = now.toISOString().slice(0, 10);
  if (!force) {
    // Claim today atomically so only one instance sends it.
    const { rowCount } = await db.query(
      `INSERT INTO job_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE job_state.value <> EXCLUDED.value`,
      [DIGEST_KEY, today],
    );
    if (!rowCount) return false;
  }
  const text = await buildDigest(db, notifier);
  if (!text) return false;
  if (force) await notifier.sendNow(text);
  else notifier.send(text);
  return true;
}
