/** Files and links attached to certifications, document versions, design requests and checklist items. */

export const ATTACHABLE = {
  certification: 'certifications',
  document_version: 'document_versions',
  design_request: 'design_requests',
  checklist_item: 'checklist_items',
};

export async function listAttachments(db, entityType, entityIds) {
  if (!entityIds.length) return [];
  const { rows } = await db.query(
    `SELECT a.id, a.entity_type, a.entity_id, a.kind, a.name, a.url, a.content_type, a.size_bytes, a.created_at,
            u.name AS uploaded_by_name
       FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.entity_type = $1 AND a.entity_id = ANY($2)
      ORDER BY a.created_at`,
    [entityType, entityIds],
  );
  return rows;
}

/** Attach attachments to each record as `record.attachments`. */
export async function withAttachments(db, entityType, records) {
  const all = await listAttachments(db, entityType, records.map((r) => r.id));
  return records.map((r) => ({ ...r, attachments: all.filter((a) => a.entity_id === r.id) }));
}

export async function getAttachment(db, id) {
  const { rows } = await db.query('SELECT * FROM attachments WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function entityExists(db, entityType, entityId) {
  const table = ATTACHABLE[entityType];
  if (!table) return false;
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [entityId]);
  return rows.length > 0;
}

export async function createAttachment(db, fields) {
  const { rows } = await db.query(
    `INSERT INTO attachments (entity_type, entity_id, kind, name, url, storage_key, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      fields.entity_type,
      fields.entity_id,
      fields.kind,
      fields.name,
      fields.url ?? null,
      fields.storage_key ?? null,
      fields.content_type ?? null,
      fields.size_bytes ?? null,
      fields.uploaded_by ?? null,
    ],
  );
  return rows[0];
}

/**
 * Remove attachment rows whose record no longer exists (deletes cascade, e.g.
 * a product takes its certifications with it). Returns the storage keys of
 * orphaned files so the caller can delete them from disk.
 */
export async function pruneOrphanAttachments(db) {
  const orphaned = Object.entries(ATTACHABLE)
    .map(([type, table]) => `(a.entity_type = '${type}' AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = a.entity_id))`)
    .join(' OR ');
  const { rows } = await db.query(`DELETE FROM attachments a WHERE ${orphaned} RETURNING storage_key`);
  return rows.map((r) => r.storage_key).filter(Boolean);
}
