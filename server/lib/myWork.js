/**
 * One person's work across every project: what's theirs, what's waiting on their teams with nobody on it yet, and
 * what their teammates have. People wear several hats, so "their teams" is every team they're on.
 */
import { ITEM_SELECT } from './dashboard.js';

const OPEN = "p.state <> 'done' AND i.state <> 'done'";
const ORDER = 'ORDER BY i.due_date NULLS LAST, p.name, i.position';

/** `teams` narrows to some of the person's teams (or any team, to look at another team's work). */
export async function getMyWork(db, { userId, teams }) {
  const { rows: [person] } = await db.query(
    `SELECT u.id, u.name, u.email, ARRAY(SELECT t.team FROM user_teams t WHERE t.user_id = u.id ORDER BY t.team) AS teams
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!person) return null;
  const scope = teams?.length ? teams : person.teams;

  const [mine, unclaimed, teammates, requests, projects] = await Promise.all([
    db.query(`${ITEM_SELECT} WHERE ${OPEN} AND i.owner_id = $1 ${ORDER} LIMIT 200`, [userId]),
    db.query(`${ITEM_SELECT} WHERE ${OPEN} AND i.owner_id IS NULL AND i.team = ANY($1::text[]) ${ORDER} LIMIT 200`, [scope]),
    db.query(`${ITEM_SELECT} WHERE ${OPEN} AND i.owner_id IS NOT NULL AND i.owner_id <> $1 AND i.team = ANY($2::text[]) ${ORDER} LIMIT 200`, [userId, scope]),
    // Design requests are Design's: the person's own, and, for Design, the ones nobody has taken yet.
    db.query(
      `SELECT r.id, r.title, r.type, r.state, r.due_date, r.assignee_id, p.name AS product_name, au.name AS assignee_name
         FROM design_requests r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN users au ON au.id = r.assignee_id
        WHERE r.state NOT IN ('approved', 'cancelled')
          AND (r.assignee_id = $1 OR (r.assignee_id IS NULL AND 'design' = ANY($2::text[])))
        ORDER BY r.due_date NULLS LAST, r.created_at`,
      [userId, scope],
    ),
    db.query(
      `SELECT p.id, p.name, p.state, p.target_date,
              count(i.id) FILTER (WHERE i.state <> 'done')::int AS open_items,
              count(i.id) FILTER (WHERE i.state <> 'done' AND i.owner_id = $1)::int AS my_items
         FROM project_members m JOIN projects p ON p.id = m.project_id LEFT JOIN checklist_items i ON i.project_id = p.id
        WHERE m.user_id = $1 AND p.state <> 'done'
        GROUP BY p.id ORDER BY p.target_date NULLS LAST, p.name`,
      [userId],
    ),
  ]);
  return { person, teams: scope, mine: mine.rows, unclaimed: unclaimed.rows, teammates: teammates.rows, requests: requests.rows, projects: projects.rows };
}
