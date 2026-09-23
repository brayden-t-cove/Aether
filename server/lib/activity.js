/**
 * Audit trail. Call logActivity for every create, update or state change so
 * the dashboard and record histories can show who changed what, and when.
 */
export async function logActivity(db, { entityType, entityId, action, changes = {}, userId = null }) {
  await db.query(
    `INSERT INTO activity_log (entity_type, entity_id, action, changes, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [entityType, String(entityId), action, JSON.stringify(changes), userId],
  );
}

export async function listActivity(db, { entityType, entityId, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (entityType) {
    params.push(entityType);
    where.push(`a.entity_type = $${params.length}`);
  }
  if (entityId) {
    params.push(String(entityId));
    where.push(`a.entity_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const { rows } = await db.query(
    `SELECT a.id, a.entity_type, a.entity_id, a.action, a.changes, a.created_at,
            u.id AS user_id, u.name AS user_name
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}
