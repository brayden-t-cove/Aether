import { LIFECYCLES } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const PRODUCT_FIELDS = {
  name: v.text({ label: 'Name', required: true, max: 200 }),
  model: v.nullableText({ label: 'Model', max: 100 }),
  sku: v.nullableText({ label: 'SKU', max: 100 }),
  category: v.text({ label: 'Category', max: 100 }),
  manufacturer: v.text({ label: 'Manufacturer', max: 200 }),
  lifecycle: v.oneOf(LIFECYCLES, { label: 'Lifecycle' }),
  launch_date: v.date({ label: 'Launch date' }),
  sunset_date: v.date({ label: 'Sunset date' }),
  channels: v.list({ label: 'Channels' }),
  replaces_id: v.id({ label: 'Replaces' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

/** Markets are stored in product_markets, not on the product row. */
export const PRODUCT_MARKETS_FIELD = { market_ids: v.idList({ label: 'Markets' }) };

const COLUMNS = Object.keys(PRODUCT_FIELDS);

// Market codes, what this replaces, and what replaces it, for list and detail views.
const PRODUCT_SELECT = `
  SELECT p.*,
         ARRAY(SELECT m.code FROM product_markets pm JOIN markets m ON m.id = pm.market_id
                WHERE pm.product_id = p.id ORDER BY m.code) AS market_codes,
         ARRAY(SELECT pm.market_id FROM product_markets pm JOIN markets m ON m.id = pm.market_id
                WHERE pm.product_id = p.id ORDER BY m.code) AS market_ids,
         r.name  AS replaces_name,
         r.model AS replaces_model,
         (SELECT json_agg(json_build_object('id', n.id, 'name', n.name, 'model', n.model, 'lifecycle', n.lifecycle) ORDER BY n.name)
            FROM products n WHERE n.replaces_id = p.id) AS replaced_by,
         (SELECT count(*)::int FROM projects pr WHERE pr.product_id = p.id) AS project_count,
         (SELECT count(*)::int FROM projects pr WHERE pr.product_id = p.id AND pr.state <> 'done') AS open_project_count
    FROM products p
    LEFT JOIN products r ON r.id = p.replaces_id`;

export async function listProducts(db, { lifecycle, q } = {}) {
  const where = [];
  const params = [];
  if (lifecycle) {
    params.push(lifecycle);
    where.push(`p.lifecycle = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR p.model ILIKE $${n} OR p.category ILIKE $${n})`);
  }
  const { rows } = await db.query(
    `${PRODUCT_SELECT}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE p.lifecycle WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, p.name`,
    params,
  );
  return rows;
}

export async function getProduct(db, id) {
  const { rows } = await db.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

export async function createProduct(db, fields, userId) {
  const { rows } = await db.query(
    `INSERT INTO products
       (name, model, sku, category, manufacturer, lifecycle, launch_date, sunset_date, channels, replaces_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      fields.name,
      fields.model ?? null,
      fields.sku ?? null,
      fields.category ?? '',
      fields.manufacturer ?? '',
      fields.lifecycle ?? 'upcoming',
      fields.launch_date ?? null,
      fields.sunset_date ?? null,
      fields.channels ?? [],
      fields.replaces_id ?? null,
      fields.notes ?? '',
      userId,
    ],
  );
  return rows[0];
}

export const updateProduct = (db, id, fields) => updateRow(db, 'products', id, fields, COLUMNS);

/** Replace the set of markets a product sells in. Returns the sorted market codes. */
export async function setProductMarkets(db, productId, marketIds) {
  await db.query('DELETE FROM product_markets WHERE product_id = $1', [productId]);
  if (marketIds.length) {
    await db.query(
      `INSERT INTO product_markets (product_id, market_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [productId, marketIds],
    );
  }
  const { rows } = await db.query(
    `SELECT m.code FROM product_markets pm JOIN markets m ON m.id = pm.market_id WHERE pm.product_id = $1 ORDER BY m.code`,
    [productId],
  );
  return rows.map((r) => r.code);
}

export async function deleteProduct(db, id) {
  const { rowCount } = await db.query('DELETE FROM products WHERE id = $1', [id]);
  return rowCount > 0;
}
