/** The returns codebook: categories and their sub-reasons, shared by every channel. */

/** Every category in display order, each with its sub-reasons. */
export async function getCodebook(db) {
  // One after the other: this also runs inside import transactions, on a single client.
  const categories = await db.query(
    `SELECT id, key, name, description, sort_order, tie_break_rank, in_share, set_aside
       FROM return_categories ORDER BY sort_order, name`,
  );
  const subreasons = await db.query(
    `SELECT s.id, s.category_id, s.key, s.name, s.sort_order
       FROM return_subreasons s ORDER BY s.sort_order, s.name`,
  );
  const byCategory = new Map(categories.rows.map((c) => [c.id, { ...c, subreasons: [] }]));
  for (const { category_id, ...s } of subreasons.rows) byCategory.get(category_id)?.subreasons.push(s);
  return [...byCategory.values()];
}
