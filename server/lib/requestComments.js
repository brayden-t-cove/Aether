/** Comments on design requests. */

const SELECT = `SELECT c.id, c.request_id, c.body, c.state, c.created_by, c.created_at, c.edited_at,
                       u.name AS author_name, u.email AS author_email
                  FROM request_comments c LEFT JOIN users u ON u.id = c.created_by`;

/** A request's comments, oldest first. */
export async function listRequestComments(db, requestId) {
  const { rows } = await db.query(`${SELECT} WHERE c.request_id = $1 ORDER BY c.created_at, c.id`, [requestId]);
  return rows;
}

export async function getRequestComment(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

export async function addRequestComment(db, { request, body, userId }) {
  const { rows } = await db.query('INSERT INTO request_comments (request_id, body, state, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [
    request.id,
    body,
    request.state,
    userId,
  ]);
  return getRequestComment(db, rows[0].id);
}

export async function editRequestComment(db, id, body) {
  await db.query('UPDATE request_comments SET body = $2, edited_at = now() WHERE id = $1', [id, body]);
  return getRequestComment(db, id);
}

export async function deleteRequestComment(db, id) {
  await db.query('DELETE FROM request_comments WHERE id = $1', [id]);
}
