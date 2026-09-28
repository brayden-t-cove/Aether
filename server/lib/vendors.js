import { VENDOR_STATUSES, VENDOR_TYPES } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const VENDOR_FIELDS = {
  name: v.text({ label: 'Name', required: true, max: 200 }),
  type: v.oneOf(VENDOR_TYPES, { label: 'Type' }),
  status: v.oneOf(VENDOR_STATUSES, { label: 'Status' }),
  website: v.url({ label: 'Website' }),
  country: v.text({ label: 'Country', max: 100 }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

/** Fields Odyssey owns for synced vendors. */
export const SYNCED_VENDOR_FIELDS = ['name', 'status', 'website', 'notes'];

export const CONTACT_FIELDS = {
  name: v.text({ label: 'Name', required: true, max: 200 }),
  role: v.text({ label: 'Role', max: 200 }),
  email: v.text({ label: 'Email', max: 200 }),
  phone: v.text({ label: 'Phone', max: 100 }),
  messaging: v.text({ label: 'Messaging', max: 200 }),
  notes: v.text({ label: 'Notes', max: 2000 }),
};

const COLUMNS = Object.keys(VENDOR_FIELDS);

export async function listVendors(db, { type, status, q } = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (type) add('v.type = ?', type);
  if (status) add('v.status = ?', status);
  if (q) add('(v.name ILIKE ? OR v.country ILIKE ?)', `%${q}%`);
  const { rows } = await db.query(
    `SELECT v.*,
            (SELECT count(*)::int FROM vendor_contacts c WHERE c.vendor_id = v.id) AS contact_count,
            ARRAY(SELECT p.name FROM vendor_products vp JOIN products p ON p.id = vp.product_id
                   WHERE vp.vendor_id = v.id ORDER BY p.name) AS product_names
       FROM vendors v
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE v.status WHEN 'active' THEN 0 WHEN 'prospect' THEN 1 ELSE 2 END, v.name`,
    params,
  );
  return rows;
}

export async function getVendor(db, id) {
  const { rows } = await db.query('SELECT * FROM vendors WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function vendorDetails(db, id) {
  const [contacts, products, certs] = await Promise.all([
    db.query('SELECT * FROM vendor_contacts WHERE vendor_id = $1 ORDER BY name', [id]),
    db.query(
      `SELECT vp.role, p.id, p.name, p.model, p.lifecycle FROM vendor_products vp JOIN products p ON p.id = vp.product_id
        WHERE vp.vendor_id = $1 ORDER BY p.name`,
      [id],
    ),
    db.query(
      `SELECT c.id, c.mark, c.state, p.name AS product_name, m.code AS market_code
         FROM certifications c JOIN products p ON p.id = c.product_id JOIN markets m ON m.id = c.market_id
        WHERE c.lab_vendor_id = $1 ORDER BY p.name, c.mark`,
      [id],
    ),
  ]);
  return { contacts: contacts.rows, products: products.rows, certifications: certs.rows };
}

export async function vendorsForProduct(db, productId) {
  const { rows } = await db.query(
    `SELECT vp.role, v.id, v.name, v.type, v.status FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id
      WHERE vp.product_id = $1 ORDER BY v.name`,
    [productId],
  );
  return rows;
}

export async function createVendor(db, f, userId) {
  const { rows } = await db.query(
    `INSERT INTO vendors (name, type, status, website, country, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [f.name, f.type ?? 'manufacturer', f.status ?? 'active', f.website ?? '', f.country ?? '', f.notes ?? '', userId],
  );
  return rows[0];
}

export const updateVendor = (db, id, fields) => updateRow(db, 'vendors', id, fields, COLUMNS);

export async function deleteVendor(db, id) {
  const { rowCount } = await db.query('DELETE FROM vendors WHERE id = $1', [id]);
  return rowCount > 0;
}
