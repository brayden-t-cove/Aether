import { PROJECT_TYPES, STATES } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const PROJECT_FIELDS = {
  name: v.text({ label: 'Name', required: true, max: 200 }),
  type: v.oneOf(PROJECT_TYPES, { label: 'Type' }),
  product_id: v.id({ label: 'Product' }),
  market_id: v.id({ label: 'Market' }),
  owner_id: v.id({ label: 'Owner' }),
  state: v.oneOf(STATES, { label: 'State' }),
  target_date: v.date({ label: 'Target date' }),
  description: v.text({ label: 'Description', max: 5000 }),
};

const COLUMNS = Object.keys(PROJECT_FIELDS);

// An item is "waiting" when it is not done and at least one item it depends on is not done.
export const WAITING_SQL = (alias) => `EXISTS (
  SELECT 1 FROM item_dependencies d
    JOIN checklist_items b ON b.id = d.blocked_by_id
   WHERE d.item_id = ${alias}.id AND b.state <> 'done'
)`;

// Items someone has marked Blocked (an external problem). Items that are only
// waiting on an earlier step are normal sequencing and shown as "Waiting" instead.
export const BLOCKED_SQL = (alias) => `${alias}.state = 'blocked'`;

const PROJECT_SUMMARY_SQL = `
  SELECT p.*,
         pr.name AS product_name,
         m.code  AS market_code,
         m.name  AS market_name,
         u.name  AS owner_name,
         count(i.id)::int                                                          AS item_count,
         count(i.id) FILTER (WHERE i.state = 'done')::int                          AS done_count,
         count(i.id) FILTER (WHERE i.state <> 'done' AND i.due_date < current_date)::int AS overdue_count,
         count(i.id) FILTER (WHERE ${BLOCKED_SQL('i')})::int                       AS blocked_count,
         count(i.id) FILTER (WHERE i.state NOT IN ('done', 'blocked') AND ${WAITING_SQL('i')})::int AS waiting_count,
         min(i.due_date) FILTER (WHERE i.state <> 'done')                          AS next_due_date
    FROM projects p
    LEFT JOIN products pr ON pr.id = p.product_id
    LEFT JOIN markets m   ON m.id = p.market_id
    LEFT JOIN users u     ON u.id = p.owner_id
    LEFT JOIN checklist_items i ON i.project_id = p.id`;

const PROJECT_GROUP_BY = 'GROUP BY p.id, pr.name, m.code, m.name, u.name';

export async function listProjects(db, { state, type, productId, marketId, ownerId, open } = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (state) add('p.state = ?', state);
  if (type) add('p.type = ?', type);
  if (productId) add('p.product_id = ?', productId);
  if (marketId) add('p.market_id = ?', marketId);
  if (ownerId) add('p.owner_id = ?', ownerId);
  if (open) where.push(`p.state <> 'done'`);

  const { rows } = await db.query(
    `${PROJECT_SUMMARY_SQL}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ${PROJECT_GROUP_BY}
     ORDER BY (p.state = 'done'), p.target_date NULLS LAST, p.name`,
    params,
  );
  return rows;
}

export async function getProjectSummary(db, id) {
  const { rows } = await db.query(`${PROJECT_SUMMARY_SQL} WHERE p.id = $1 ${PROJECT_GROUP_BY}`, [id]);
  return rows[0] || null;
}

export async function getProject(db, id) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Items of one project, each with the items it waits on and the items waiting on it. */
export async function listProjectItems(db, projectId) {
  const { rows: items } = await db.query(
    `SELECT i.*, u.name AS owner_name
       FROM checklist_items i
       LEFT JOIN users u ON u.id = i.owner_id
      WHERE i.project_id = $1
      ORDER BY i.position, i.created_at`,
    [projectId],
  );
  if (!items.length) return [];

  const ids = items.map((i) => i.id);
  const { rows: deps } = await db.query(
    `SELECT d.item_id, d.blocked_by_id,
            a.title AS item_title, a.state AS item_state, a.project_id AS item_project_id, ap.name AS item_project_name,
            b.title AS blocker_title, b.state AS blocker_state, b.project_id AS blocker_project_id, bp.name AS blocker_project_name
       FROM item_dependencies d
       JOIN checklist_items a ON a.id = d.item_id
       JOIN checklist_items b ON b.id = d.blocked_by_id
       JOIN projects ap ON ap.id = a.project_id
       JOIN projects bp ON bp.id = b.project_id
      WHERE d.item_id = ANY($1) OR d.blocked_by_id = ANY($1)`,
    [ids],
  );

  const byId = new Map(items.map((i) => [i.id, { ...i, blocked_by: [], blocks: [] }]));
  for (const d of deps) {
    byId.get(d.item_id)?.blocked_by.push({
      id: d.blocked_by_id,
      title: d.blocker_title,
      state: d.blocker_state,
      project_id: d.blocker_project_id,
      project_name: d.blocker_project_name,
    });
    byId.get(d.blocked_by_id)?.blocks.push({
      id: d.item_id,
      title: d.item_title,
      state: d.item_state,
      project_id: d.item_project_id,
      project_name: d.item_project_name,
    });
  }
  return [...byId.values()].map((item) => ({
    ...item,
    waiting: item.state !== 'done' && item.blocked_by.some((b) => b.state !== 'done'),
  }));
}

export async function createProject(db, fields, userId) {
  const { rows } = await db.query(
    `INSERT INTO projects (name, type, product_id, market_id, owner_id, state, target_date, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      fields.name,
      fields.type ?? 'launch',
      fields.product_id ?? null,
      fields.market_id ?? null,
      fields.owner_id ?? null,
      fields.state ?? 'not_started',
      fields.target_date ?? null,
      fields.description ?? '',
      userId,
    ],
  );
  return rows[0];
}

export const updateProject = (db, id, fields) => updateRow(db, 'projects', id, fields, COLUMNS);

export async function deleteProject(db, id) {
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id]);
  return rowCount > 0;
}
