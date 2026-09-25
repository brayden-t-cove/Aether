/** Run fn(client) inside a transaction on a pooled client. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * UPDATE table SET <fields> WHERE id = $id RETURNING *.
 * Only keys listed in `columns` are written; callers validate values first.
 */
export async function updateRow(db, table, id, fields, columns) {
  const sets = [];
  const params = [];
  for (const key of columns) {
    if (key in fields) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) {
    const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return rows[0] || null;
  }
  params.push(id);
  const { rows } = await db.query(
    `UPDATE ${table} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** { key: { from, to } } for every key whose value changed. Arrays compare by content. */
export function diff(before, after, keys) {
  const changes = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const a = before?.[key] ?? null;
    const b = after[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}
