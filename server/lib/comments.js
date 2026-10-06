/** Updates (comments) on checklist items. */
import { v } from './validate.js';

/** An update's text: trimmed, at most 5,000 characters. Blank comes back as ''. */
export const COMMENT_BODY = v.text({ label: 'Update', max: 5000 });

const SELECT = `SELECT c.id, c.item_id, c.body, c.state, c.state_from, c.created_by, c.created_at, c.edited_at,
                       u.name AS author_name, u.email AS author_email
                  FROM item_comments c LEFT JOIN users u ON u.id = c.created_by`;

/** An item's updates, oldest first. */
export async function listComments(db, itemId) {
  const { rows } = await db.query(`${SELECT} WHERE c.item_id = $1 ORDER BY c.created_at, c.id`, [itemId]);
  return rows;
}

export async function getComment(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

/** Add an update. With stateFrom, it's the reason for a state change from stateFrom to the item's state. */
export async function addComment(db, { item, body, stateFrom = null, userId }) {
  const { rows } = await db.query(
    `INSERT INTO item_comments (item_id, body, state, state_from, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [item.id, body, item.state, stateFrom && stateFrom !== item.state ? stateFrom : null, userId],
  );
  return getComment(db, rows[0].id);
}

export async function editComment(db, id, body) {
  await db.query('UPDATE item_comments SET body = $2, edited_at = now() WHERE id = $1', [id, body]);
  return getComment(db, id);
}

export async function deleteComment(db, id) {
  await db.query('DELETE FROM item_comments WHERE id = $1', [id]);
}

/**
 * SQL columns giving an item's latest update and how many it has, for lists. `alias` is the checklist_items alias.
 * latest_comment is { body, author_name, created_at, state, state_from } or null.
 */
export const LATEST_COMMENT_SQL = (alias) => `
  (SELECT json_build_object('body', c.body, 'author_name', COALESCE(u.name, u.email), 'created_at', c.created_at,
                            'state', c.state, 'state_from', c.state_from)
     FROM item_comments c LEFT JOIN users u ON u.id = c.created_by
    WHERE c.item_id = ${alias}.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS latest_comment,
  (SELECT count(*)::int FROM item_comments c WHERE c.item_id = ${alias}.id) AS comment_count`;
