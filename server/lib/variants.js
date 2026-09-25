import { updateRow } from './db.js';
import { v } from './validate.js';

export const VARIANT_FIELDS = {
  market_id: v.id({ label: 'Market' }),
  name: v.text({ label: 'Name', required: true, max: 200 }),
  sku: v.nullableText({ label: 'SKU', max: 100 }),
  model: v.nullableText({ label: 'Model', max: 100 }),
  differences: v.text({ label: 'Differences', max: 5000 }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

const COLUMNS = Object.keys(VARIANT_FIELDS);

export async function listVariants(db, productId) {
  const { rows } = await db.query(
    `SELECT pv.*, m.code AS market_code, m.name AS market_name
       FROM product_variants pv LEFT JOIN markets m ON m.id = pv.market_id
      WHERE pv.product_id = $1
      ORDER BY m.code NULLS FIRST, pv.name`,
    [productId],
  );
  return rows;
}

export async function getVariant(db, id) {
  const { rows } = await db.query('SELECT * FROM product_variants WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createVariant(db, productId, f, userId) {
  const { rows } = await db.query(
    `INSERT INTO product_variants (product_id, market_id, name, sku, model, differences, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [productId, f.market_id ?? null, f.name, f.sku ?? null, f.model ?? null, f.differences ?? '', f.notes ?? '', userId],
  );
  return rows[0];
}

export const updateVariant = (db, id, fields) => updateRow(db, 'product_variants', id, fields, COLUMNS);

export async function deleteVariant(db, id) {
  const { rowCount } = await db.query('DELETE FROM product_variants WHERE id = $1', [id]);
  return rowCount > 0;
}
