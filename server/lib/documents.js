import { DOCUMENT_KINDS, VERSION_STATES } from '../../shared/workflow.js';
import { updateRow } from './db.js';
import { v } from './validate.js';

export const DOCUMENT_FIELDS = {
  product_id: v.id({ label: 'Product', required: true }),
  market_id: v.id({ label: 'Market' }),
  variant_id: v.id({ label: 'Variant' }),
  kind: v.oneOf(DOCUMENT_KINDS, { label: 'Type' }),
  title: v.text({ label: 'Title', required: true, max: 200 }),
  languages: v.list({ label: 'Languages' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

export const VERSION_FIELDS = {
  version: v.text({ label: 'Version', required: true, max: 50 }),
  state: v.oneOf(VERSION_STATES, { label: 'State' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

const COLUMNS = Object.keys(DOCUMENT_FIELDS);

// Each document with its latest version (the one people care about).
const DOCUMENT_SELECT = `
  SELECT d.*,
         p.name AS product_name, p.model AS product_model,
         m.code AS market_code, m.name AS market_name,
         pv.name AS variant_name,
         lv.id AS latest_version_id, lv.version AS latest_version, lv.state AS latest_state,
         lv.updated_at AS latest_updated_at,
         (SELECT count(*)::int FROM document_versions x WHERE x.document_id = d.id) AS version_count
    FROM documents d
    JOIN products p ON p.id = d.product_id
    LEFT JOIN markets m ON m.id = d.market_id
    LEFT JOIN product_variants pv ON pv.id = d.variant_id
    LEFT JOIN LATERAL (
      SELECT * FROM document_versions dv WHERE dv.document_id = d.id ORDER BY dv.created_at DESC, dv.id DESC LIMIT 1
    ) lv ON true`;

export async function listDocuments(db, { productId, marketId, kind, state } = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (productId) add('d.product_id = ?', productId);
  if (marketId) add('(d.market_id = ? OR d.market_id IS NULL)', marketId);
  if (kind) add('d.kind = ?', kind);
  if (state) add('lv.state = ?', state);
  const { rows } = await db.query(
    `${DOCUMENT_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.name, d.kind, m.code NULLS FIRST, d.title`,
    params,
  );
  return rows;
}

export async function getDocument(db, id) {
  const { rows } = await db.query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  return rows[0] || null;
}

export async function listVersions(db, documentId) {
  const { rows } = await db.query(
    `SELECT dv.*, cu.name AS created_by_name, au.name AS approved_by_name
       FROM document_versions dv
       LEFT JOIN users cu ON cu.id = dv.created_by
       LEFT JOIN users au ON au.id = dv.approved_by
      WHERE dv.document_id = $1
      ORDER BY dv.created_at DESC, dv.id DESC`,
    [documentId],
  );
  return rows;
}

export async function getVersion(db, id) {
  const { rows } = await db.query('SELECT * FROM document_versions WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createDocument(db, f, userId) {
  const { rows } = await db.query(
    `INSERT INTO documents (product_id, market_id, variant_id, kind, title, languages, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [f.product_id, f.market_id ?? null, f.variant_id ?? null, f.kind ?? 'manual', f.title, f.languages ?? [], f.notes ?? '', userId],
  );
  return rows[0].id;
}

export const updateDocument = (db, id, fields) => updateRow(db, 'documents', id, fields, COLUMNS);

export async function deleteDocument(db, id) {
  const { rowCount } = await db.query('DELETE FROM documents WHERE id = $1', [id]);
  return rowCount > 0;
}

/** Next version label: v1, v2… based on how many versions exist. */
export async function nextVersionLabel(db, documentId) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [documentId]);
  return `v${rows[0].n + 1}`;
}

export async function createVersion(db, documentId, f, userId) {
  const approved = ['approved', 'sent'].includes(f.state);
  const { rows } = await db.query(
    `INSERT INTO document_versions (document_id, version, state, notes, created_by, approved_by, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [documentId, f.version, f.state ?? 'draft', f.notes ?? '', userId, approved ? userId : null, approved ? new Date() : null],
  );
  await db.query('UPDATE documents SET updated_at = now() WHERE id = $1', [documentId]);
  return rows[0];
}

/** Update a version; moving it to Approved records who approved it and when. */
export async function updateVersion(db, version, fields, userId) {
  const sets = [];
  const params = [];
  for (const key of Object.keys(VERSION_FIELDS)) {
    if (key in fields) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (fields.state && fields.state !== version.state) {
    const nowApproved = ['approved', 'sent'].includes(fields.state);
    const wasApproved = ['approved', 'sent'].includes(version.state);
    if (nowApproved && !wasApproved) {
      params.push(userId);
      sets.push(`approved_by = $${params.length}`, 'approved_at = now()');
    } else if (!nowApproved) {
      sets.push('approved_by = NULL', 'approved_at = NULL');
    }
  }
  if (!sets.length) return version;
  params.push(version.id);
  const { rows } = await db.query(
    `UPDATE document_versions SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  await db.query('UPDATE documents SET updated_at = now() WHERE id = $1', [version.document_id]);
  return rows[0];
}

export async function deleteVersion(db, id) {
  const { rowCount } = await db.query('DELETE FROM document_versions WHERE id = $1', [id]);
  return rowCount > 0;
}
