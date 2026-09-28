import { v } from './validate.js';

export const COMPETITOR_FIELDS = {
  brand: v.text({ label: 'Brand', required: true, max: 100 }),
  name: v.text({ label: 'Name', required: true, max: 200 }),
  model: v.text({ label: 'Model', max: 100 }),
  category: v.text({ label: 'Category', max: 100 }),
  price: (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw Object.assign(new Error('Price must be a number'), { status: 400 });
    return Math.round(n * 100) / 100;
  },
  url: v.url({ label: 'Link' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

export const COMPARISON_FIELDS = {
  name: v.text({ label: 'Name', required: true, max: 200 }),
  product_id: v.id({ label: 'Luna product' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

/** Rows a new comparison starts with; the team adds, renames or removes them. */
export const STARTER_ATTRIBUTES = [
  'Price',
  'Video resolution',
  'Field of view',
  'Night vision',
  'Power',
  'Local storage',
  'Subscription needed',
  'Smart detection',
  'Wi-Fi',
  'Amazon rating',
];

/** The whole grid: comparison, Luna product, competitor columns, attribute rows and cell values. */
export async function getComparisonGrid(db, id) {
  const { rows: c } = await db.query(
    `SELECT c.*, p.name AS product_name, p.model AS product_model
       FROM comparisons c LEFT JOIN products p ON p.id = c.product_id WHERE c.id = $1`,
    [id],
  );
  if (!c[0]) return null;
  const [competitors, attributes, values] = await Promise.all([
    db.query(
      `SELECT k.*, cc.position FROM comparison_competitors cc JOIN competitors k ON k.id = cc.competitor_id
        WHERE cc.comparison_id = $1 ORDER BY cc.position, k.brand, k.name`,
      [id],
    ),
    db.query('SELECT * FROM comparison_attributes WHERE comparison_id = $1 ORDER BY position, name', [id]),
    db.query(
      `SELECT v.attribute_id, v.competitor_id, v.value FROM comparison_values v
         JOIN comparison_attributes a ON a.id = v.attribute_id WHERE a.comparison_id = $1`,
      [id],
    ),
  ]);
  return { comparison: c[0], competitors: competitors.rows, attributes: attributes.rows, values: values.rows };
}

export async function addAttribute(db, comparisonId, name) {
  const { rows } = await db.query(
    `INSERT INTO comparison_attributes (comparison_id, name, position)
     VALUES ($1, $2, (SELECT COALESCE(max(position), -1) + 1 FROM comparison_attributes WHERE comparison_id = $1))
     RETURNING *`,
    [comparisonId, name],
  );
  return rows[0];
}
