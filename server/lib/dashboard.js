import { BLOCKED_SQL, listProjects } from './projects.js';
import { listActivity } from './activity.js';
import { EXPIRY_WARNING_DAYS } from '../../shared/workflow.js';

const ITEM_SELECT = `
  SELECT i.id, i.title, i.state, i.category, i.due_date, i.project_id,
         p.name AS project_name, u.name AS owner_name,
         ARRAY(
           SELECT b.title FROM item_dependencies d
             JOIN checklist_items b ON b.id = d.blocked_by_id
            WHERE d.item_id = i.id AND b.state <> 'done'
            ORDER BY b.position
         ) AS waiting_on,
         (SELECT count(*)::int FROM item_dependencies d
            JOIN checklist_items w ON w.id = d.item_id
           WHERE d.blocked_by_id = i.id AND w.state <> 'done') AS holds_up
    FROM checklist_items i
    JOIN projects p ON p.id = i.project_id
    LEFT JOIN users u ON u.id = i.owner_id`;

/** Everything the boss view needs in one call. */
export async function getDashboard(db) {
  const [projects, counts, blocked, overdue, dueSoon, activity] = await Promise.all([
    listProjects(db, { open: true }),
    db.query(`
      SELECT
        (SELECT count(*)::int FROM projects WHERE state <> 'done') AS open_projects,
        (SELECT count(*)::int FROM checklist_items i JOIN projects p ON p.id = i.project_id
          WHERE p.state <> 'done' AND ${BLOCKED_SQL('i')}) AS blocked_items,
        (SELECT count(*)::int FROM checklist_items i JOIN projects p ON p.id = i.project_id
          WHERE p.state <> 'done' AND i.state <> 'done' AND i.due_date < current_date) AS overdue_items,
        (SELECT count(*)::int FROM checklist_items i JOIN projects p ON p.id = i.project_id
          WHERE p.state <> 'done' AND i.state <> 'done' AND i.due_date BETWEEN current_date AND current_date + 7) AS due_soon_items
    `),
    db.query(`${ITEM_SELECT}
      WHERE p.state <> 'done' AND ${BLOCKED_SQL('i')}
      ORDER BY holds_up DESC, i.due_date NULLS LAST, p.name, i.position
      LIMIT 25`),
    db.query(`${ITEM_SELECT}
      WHERE p.state <> 'done' AND i.state <> 'done' AND i.due_date < current_date
      ORDER BY i.due_date, p.name
      LIMIT 25`),
    db.query(`${ITEM_SELECT}
      WHERE p.state <> 'done' AND i.state <> 'done' AND i.due_date BETWEEN current_date AND current_date + 7
      ORDER BY i.due_date, p.name
      LIMIT 25`),
    listActivity(db, { limit: 15 }),
  ]);
  const phase2 = await getDashboardPhase2(db);

  return {
    counts: { ...counts.rows[0], ...phase2.counts },
    certAlerts: phase2.certAlerts,
    inReview: phase2.inReview,
    openRequests: phase2.openRequests,
    projects,
    blocked: blocked.rows,
    overdue: overdue.rows,
    dueSoon: dueSoon.rows,
    activity,
  };
}

/** Phase 2 additions: certifications needing attention, work awaiting review, open design requests. */
export async function getDashboardPhase2(db) {
  const [expiring, inReview, requests, counts] = await Promise.all([
    db.query(`
      SELECT c.id, c.mark, c.expiry_date, c.state, p.name AS product_name, m.code AS market_code,
             CASE WHEN c.state = 'certified' AND c.expiry_date < current_date THEN 'expired' ELSE 'expiring' END AS expiry_status
        FROM certifications c JOIN products p ON p.id = c.product_id JOIN markets m ON m.id = c.market_id
       WHERE (c.state = 'certified' AND c.expiry_date < current_date + ${EXPIRY_WARNING_DAYS}) OR c.state = 'rejected'
       ORDER BY c.expiry_date NULLS FIRST
       LIMIT 25`),
    db.query(`
      SELECT d.id, d.title, d.kind, p.name AS product_name, m.code AS market_code, lv.version, lv.updated_at
        FROM documents d
        JOIN products p ON p.id = d.product_id
        LEFT JOIN markets m ON m.id = d.market_id
        JOIN LATERAL (SELECT version, state, updated_at FROM document_versions v WHERE v.document_id = d.id
                       ORDER BY v.created_at DESC, v.id DESC LIMIT 1) lv ON lv.state = 'in_review'
       ORDER BY lv.updated_at
       LIMIT 25`),
    db.query(`
      SELECT r.id, r.title, r.type, r.state, r.due_date, p.name AS product_name, au.name AS assignee_name
        FROM design_requests r
        LEFT JOIN products p ON p.id = r.product_id
        LEFT JOIN users au ON au.id = r.assignee_id
       WHERE r.state IN ('requested', 'in_progress', 'delivered')
       ORDER BY (r.state = 'delivered') DESC, r.due_date NULLS LAST
       LIMIT 25`),
    db.query(`
      SELECT
        (SELECT count(*)::int FROM certifications WHERE state = 'certified' AND expiry_date < current_date + ${EXPIRY_WARNING_DAYS}) AS expiring_certs,
        (SELECT count(*)::int FROM design_requests WHERE state IN ('requested', 'in_progress', 'delivered')) AS open_requests`),
  ]);
  return { certAlerts: expiring.rows, inReview: inReview.rows, openRequests: requests.rows, counts: counts.rows[0] };
}
