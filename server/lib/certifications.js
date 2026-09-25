import { CERT_STATES, EXPIRY_WARNING_DAYS } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const CERT_FIELDS = {
  product_id: v.id({ label: 'Product', required: true }),
  market_id: v.id({ label: 'Market', required: true }),
  variant_id: v.id({ label: 'Variant' }),
  mark: (value) => v.text({ label: 'Mark', required: true, max: 50 })(value).toUpperCase(),
  state: v.oneOf(CERT_STATES, { label: 'State' }),
  lab: v.text({ label: 'Lab', max: 200 }),
  lab_vendor_id: v.id({ label: 'Lab vendor' }),
  cert_number: v.text({ label: 'Certificate number', max: 200 }),
  issued_date: v.date({ label: 'Issued date' }),
  expiry_date: v.date({ label: 'Expiry date' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

const COLUMNS = Object.keys(CERT_FIELDS);

// expiry_status: 'expired' | 'expiring' (within the warning window) | null
const CERT_SELECT = `
  SELECT c.*,
         p.name AS product_name, p.model AS product_model,
         m.code AS market_code, m.name AS market_name,
         pv.name AS variant_name,
         lv.name AS lab_vendor_name,
         CASE
           WHEN c.state = 'certified' AND c.expiry_date < current_date THEN 'expired'
           WHEN c.state = 'certified' AND c.expiry_date < current_date + ${EXPIRY_WARNING_DAYS} THEN 'expiring'
         END AS expiry_status
    FROM certifications c
    JOIN products p ON p.id = c.product_id
    JOIN markets m ON m.id = c.market_id
    LEFT JOIN product_variants pv ON pv.id = c.variant_id
    LEFT JOIN vendors lv ON lv.id = c.lab_vendor_id`;

export async function listCertifications(db, { productId, marketId, state, expiring } = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (productId) add('c.product_id = ?', productId);
  if (marketId) add('c.market_id = ?', marketId);
  if (state) add('c.state = ?', state);
  if (expiring) where.push(`c.state = 'certified' AND c.expiry_date < current_date + ${EXPIRY_WARNING_DAYS}`);
  const { rows } = await db.query(
    `${CERT_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.name, m.code, c.mark`,
    params,
  );
  return rows;
}

export async function getCertification(db, id) {
  const { rows } = await db.query(`${CERT_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

export async function createCertification(db, f, userId) {
  const { rows } = await db.query(
    `INSERT INTO certifications
       (product_id, market_id, variant_id, mark, state, lab, lab_vendor_id, cert_number, issued_date, expiry_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      f.product_id,
      f.market_id,
      f.variant_id ?? null,
      f.mark,
      f.state ?? 'not_started',
      f.lab ?? '',
      f.lab_vendor_id ?? null,
      f.cert_number ?? '',
      f.issued_date ?? null,
      f.expiry_date ?? null,
      f.notes ?? '',
      userId,
    ],
  );
  return rows[0].id;
}

export const updateCertification = (db, id, fields) => updateRow(db, 'certifications', id, fields, COLUMNS);

export async function deleteCertification(db, id) {
  const { rowCount } = await db.query('DELETE FROM certifications WHERE id = $1', [id]);
  return rowCount > 0;
}
