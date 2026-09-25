import { ITEM_CATEGORIES, STATES } from '../../shared/workflow.js';
import { HttpError } from './http.js';
import { v } from './validate.js';

export const ITEM_FIELDS = {
  title: v.text({ label: 'Title', required: true, max: 300 }),
  stage: v.text({ label: 'Stage', max: 100 }),
  category: v.oneOf(ITEM_CATEGORIES, { label: 'Category' }),
  owner_id: v.id({ label: 'Owner' }),
  state: v.oneOf(STATES, { label: 'State' }),
  due_date: v.date({ label: 'Due date' }),
  evidence_url: v.url({ label: 'Evidence link' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
  position: v.int({ label: 'Position' }),
};

const COLUMNS = Object.keys(ITEM_FIELDS);

export async function getItem(db, id) {
  const { rows } = await db.query('SELECT * FROM checklist_items WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Items this item waits on that are not done yet. */
export async function openBlockers(db, itemId) {
  const { rows } = await db.query(
    `SELECT b.id, b.title, b.state
       FROM item_dependencies d
       JOIN checklist_items b ON b.id = d.blocked_by_id
      WHERE d.item_id = $1 AND b.state <> 'done'
      ORDER BY b.position`,
    [itemId],
  );
  return rows;
}

async function assertCanComplete(db, itemId) {
  const blockers = await openBlockers(db, itemId);
  if (blockers.length) {
    throw new HttpError(409, `Can't mark as done while waiting on: ${blockers.map((b) => b.title).join(', ')}`);
  }
}

export async function createItem(db, projectId, fields, userId) {
  const { rows: pos } = await db.query(
    'SELECT COALESCE(max(position), -1) + 1 AS next FROM checklist_items WHERE project_id = $1',
    [projectId],
  );
  const state = fields.state ?? 'not_started';
  const { rows } = await db.query(
    `INSERT INTO checklist_items
       (project_id, title, stage, category, owner_id, state, due_date, evidence_url, notes, position, completed_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      projectId,
      fields.title,
      fields.stage ?? '',
      fields.category ?? 'other',
      fields.owner_id ?? null,
      state,
      fields.due_date ?? null,
      fields.evidence_url ?? '',
      fields.notes ?? '',
      fields.position ?? pos[0].next,
      state === 'done' ? new Date() : null,
      userId,
    ],
  );
  return rows[0];
}

export async function updateItem(db, item, fields) {
  if (fields.state === 'done' && item.state !== 'done') await assertCanComplete(db, item.id);

  const sets = [];
  const params = [];
  for (const key of COLUMNS) {
    if (key in fields) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if ('state' in fields && fields.state !== item.state) {
    sets.push(fields.state === 'done' ? 'completed_at = now()' : 'completed_at = NULL');
  }
  if (!sets.length) return item;
  params.push(item.id);
  const { rows } = await db.query(
    `UPDATE checklist_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0];
}

export async function deleteItem(db, id) {
  const { rowCount } = await db.query('DELETE FROM checklist_items WHERE id = $1', [id]);
  return rowCount > 0;
}

/** Would "itemId waits on blockerId" create a loop? True if blockerId already (indirectly) waits on itemId. */
async function createsCycle(db, itemId, blockerId) {
  const { rows } = await db.query(
    `WITH RECURSIVE chain(id) AS (
       SELECT blocked_by_id FROM item_dependencies WHERE item_id = $1
       UNION
       SELECT d.blocked_by_id FROM item_dependencies d JOIN chain c ON d.item_id = c.id
     )
     SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
    [blockerId, itemId],
  );
  return rows.length > 0;
}

export async function addDependency(db, item, blocker) {
  if (item.id === blocker.id) throw new HttpError(400, "An item can't wait on itself");
  if (item.state === 'done' && blocker.state !== 'done') {
    throw new HttpError(409, 'This item is already done. Reopen it before adding something it waits on.');
  }
  if (await createsCycle(db, item.id, blocker.id)) {
    throw new HttpError(409, `"${blocker.title}" already waits on this item, directly or indirectly`);
  }
  const { rowCount } = await db.query(
    'INSERT INTO item_dependencies (item_id, blocked_by_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [item.id, blocker.id],
  );
  return rowCount > 0;
}

export async function removeDependency(db, itemId, blockerId) {
  const { rowCount } = await db.query('DELETE FROM item_dependencies WHERE item_id = $1 AND blocked_by_id = $2', [
    itemId,
    blockerId,
  ]);
  return rowCount > 0;
}

/**
 * Create a template's items and their dependencies for a project.
 * `db` should be a transaction client so a partial checklist is never left behind.
 */
export async function createItemsFromTemplate(db, projectId, templateItems, userId) {
  const idByKey = new Map();
  for (const [position, t] of templateItems.entries()) {
    const item = await createItem(db, projectId, { title: t.title, stage: t.stage, category: t.category, position }, userId);
    idByKey.set(t.key, item.id);
  }
  for (const t of templateItems) {
    for (const key of t.blockedBy || []) {
      const blockerId = idByKey.get(key);
      if (blockerId) {
        await db.query('INSERT INTO item_dependencies (item_id, blocked_by_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
          idByKey.get(t.key),
          blockerId,
        ]);
      }
    }
  }
  return idByKey.size;
}
