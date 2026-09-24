import { BLOCKED_SQL, listProjects } from './projects.js';
import { listActivity } from './activity.js';

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

  return {
    counts: counts.rows[0],
    projects,
    blocked: blocked.rows,
    overdue: overdue.rows,
    dueSoon: dueSoon.rows,
    activity,
  };
}
