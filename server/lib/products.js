import { LIFECYCLES } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const PRODUCT_FIELDS = {
  name: v.text({ label: 'Name', required: true, max: 200 }),
  sku: v.nullableText({ label: 'SKU', max: 100 }),
  category: v.text({ label: 'Category', max: 100 }),
  lifecycle: v.oneOf(LIFECYCLES, { label: 'Lifecycle' }),
  launch_date: v.date({ label: 'Launch date' }),
  sunset_date: v.date({ label: 'Sunset date' }),
  channels: v.list({ label: 'Channels' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

const COLUMNS = Object.keys(PRODUCT_FIELDS);

export async function listProducts(db, { lifecycle, q } = {}) {
  const where = [];
  const params = [];
  if (lifecycle) {
    params.push(lifecycle);
    where.push(`p.lifecycle = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.category ILIKE $${params.length})`);
  }
  const { rows } = await db.query(
    `SELECT p.*,
            (SELECT count(*)::int FROM projects pr WHERE pr.product_id = p.id) AS project_count,
            (SELECT count(*)::int FROM projects pr WHERE pr.product_id = p.id AND pr.state <> 'done') AS open_project_count
       FROM products p
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE p.lifecycle WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, p.name`,
    params,
  );
  return rows;
}

export async function getProduct(db, id) {
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createProduct(db, fields, userId) {
  const { rows } = await db.query(
    `INSERT INTO products (name, sku, category, lifecycle, launch_date, sunset_date, channels, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      fields.name,
      fields.sku ?? null,
      fields.category ?? '',
      fields.lifecycle ?? 'upcoming',
      fields.launch_date ?? null,
      fields.sunset_date ?? null,
      fields.channels ?? [],
      fields.notes ?? '',
      userId,
    ],
  );
  return rows[0];
}

export const updateProduct = (db, id, fields) => updateRow(db, 'products', id, fields, COLUMNS);

export async function deleteProduct(db, id) {
  const { rowCount } = await db.query('DELETE FROM products WHERE id = $1', [id]);
  return rowCount > 0;
}
