import { REQUEST_STATES, REQUEST_TYPES } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const REQUEST_FIELDS = {
  title: v.text({ label: 'Title', required: true, max: 300 }),
  type: v.oneOf(REQUEST_TYPES, { label: 'Type' }),
  product_id: v.id({ label: 'Product' }),
  document_id: v.id({ label: 'Document' }),
  description: v.text({ label: 'Description', max: 5000 }),
  assignee_id: v.id({ label: 'Assignee' }),
  due_date: v.date({ label: 'Due date' }),
  state: v.oneOf(REQUEST_STATES, { label: 'State' }),
};

const COLUMNS = Object.keys(REQUEST_FIELDS);

const REQUEST_SELECT = `
  SELECT r.*,
         p.name AS product_name,
         d.title AS document_title,
         ru.name AS requested_by_name,
         au.name AS assignee_name
    FROM design_requests r
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN documents d ON d.id = r.document_id
    LEFT JOIN users ru ON ru.id = r.requested_by
    LEFT JOIN users au ON au.id = r.assignee_id`;

export async function listRequests(db, { state, assigneeId, productId, documentId, open } = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (state) add('r.state = ?', state);
  if (assigneeId) add('r.assignee_id = ?', assigneeId);
  if (productId) add('r.product_id = ?', productId);
  if (documentId) add('r.document_id = ?', documentId);
  if (open) where.push(`r.state IN ('requested', 'in_progress', 'delivered')`);
  const { rows } = await db.query(
    `${REQUEST_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE r.state WHEN 'delivered' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'requested' THEN 2 ELSE 3 END,
              r.due_date NULLS LAST, r.created_at DESC`,
    params,
  );
  return rows;
}

export async function getRequest(db, id) {
  const { rows } = await db.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

export async function createRequest(db, f, userId) {
  const { rows } = await db.query(
    `INSERT INTO design_requests (title, type, product_id, document_id, description, requested_by, assignee_id, due_date, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      f.title,
      f.type ?? 'image',
      f.product_id ?? null,
      f.document_id ?? null,
      f.description ?? '',
      userId,
      f.assignee_id ?? null,
      f.due_date ?? null,
      f.state ?? 'requested',
    ],
  );
  return rows[0].id;
}

export const updateRequest = (db, id, fields) => updateRow(db, 'design_requests', id, fields, COLUMNS);

export async function deleteRequest(db, id) {
  const { rowCount } = await db.query('DELETE FROM design_requests WHERE id = $1', [id]);
  return rowCount > 0;
}
