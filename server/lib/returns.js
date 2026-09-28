/** Returns analytics: totals, monthly trend by channel, reasons, and per-product breakdown. */

function filters({ from, to, channel, productId, marketId }) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (from) add('r.return_date >= ?', from);
  if (to) add('r.return_date <= ?', to);
  if (channel) add('r.channel = ?', channel);
  if (productId) add('r.product_id = ?', productId);
  if (marketId) add('r.market_id = ?', marketId);
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function returnsSummary(db, opts = {}) {
  const { where, params } = filters(opts);
  const q = (sql) => db.query(sql, params).then((r) => r.rows);
  const [totals, byMonth, byGroup, topReasons, byProduct] = await Promise.all([
    q(`SELECT COALESCE(sum(r.quantity), 0)::int AS units, count(*)::int AS lines,
              count(DISTINCT r.product_id)::int AS products,
              COALESCE(sum(r.quantity) FILTER (WHERE r.product_id IS NULL), 0)::int AS unmatched_units,
              COALESCE(sum(r.quantity) FILTER (WHERE r.reason_group = 'defect'), 0)::int AS defect_units,
              min(r.return_date)::text AS first_date, max(r.return_date)::text AS last_date
         FROM returns r ${where}`),
    q(`SELECT to_char(date_trunc('month', r.return_date), 'YYYY-MM') AS month, r.channel, sum(r.quantity)::int AS units
         FROM returns r ${where} GROUP BY 1, 2 ORDER BY 1, 2`),
    q(`SELECT r.reason_group AS "group", sum(r.quantity)::int AS units FROM returns r ${where} GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT r.reason_code, min(r.reason) AS reason, min(r.reason_group) AS "group", sum(r.quantity)::int AS units
         FROM returns r ${where} GROUP BY r.reason_code ORDER BY units DESC LIMIT 10`),
    q(`WITH f AS (SELECT r.* FROM returns r ${where}),
            per AS (SELECT product_id, reason, sum(quantity) AS u FROM f GROUP BY 1, 2),
            top AS (SELECT DISTINCT ON (product_id) product_id, reason FROM per ORDER BY product_id, u DESC, reason)
       SELECT f.product_id, COALESCE(p.name, 'Unmatched') AS name, p.model, sum(f.quantity)::int AS units,
              COALESCE(sum(f.quantity) FILTER (WHERE f.reason_group = 'defect'), 0)::int AS defect_units,
              t.reason AS top_reason
         FROM f
         LEFT JOIN products p ON p.id = f.product_id
         LEFT JOIN top t ON t.product_id IS NOT DISTINCT FROM f.product_id
        GROUP BY f.product_id, p.name, p.model, t.reason
        ORDER BY units DESC`),
  ]);
  return { totals: totals[0], byMonth, byGroup, topReasons, byProduct };
}

export async function listReturns(db, { limit = 200, ...opts } = {}) {
  const { where, params } = filters(opts);
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const { rows } = await db.query(
    `SELECT r.*, r.return_date::text AS return_date, p.name AS product_name, m.code AS market_code
       FROM returns r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN markets m ON m.id = r.market_id
      ${where}
      ORDER BY r.return_date DESC, r.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Unmatched returns grouped by what identifies the product, largest first. */
export async function unmatchedReturns(db) {
  const { rows } = await db.query(
    `SELECT channel, external_id, sku, product_label, sum(quantity)::int AS units, count(*)::int AS lines
       FROM returns WHERE product_id IS NULL
      GROUP BY channel, external_id, sku, product_label
      ORDER BY units DESC LIMIT 100`,
  );
  return rows;
}

/**
 * Assign every unmatched return with this identifier to a product. With
 * createListing, also records the ASIN / SKU as a listing so future imports match.
 */
export async function assignReturns(db, { channel, external_id, sku, product_label, product_id, createListing }) {
  let condition;
  let value;
  if (external_id) [condition, value] = ['lower(external_id) = lower($3)', external_id];
  else if (sku) [condition, value] = ['lower(sku) = lower($3)', sku];
  else [condition, value] = ['product_label = $3', product_label];
  const { rowCount } = await db.query(
    `UPDATE returns SET product_id = $1 WHERE product_id IS NULL AND channel = $2 AND ${condition}`,
    [product_id, channel, value],
  );
  if (createListing && (external_id || sku)) {
    await db.query(
      `INSERT INTO product_listings (product_id, channel, external_id, sku, state) VALUES ($1, $2, $3, $4, 'live')
       ON CONFLICT DO NOTHING`,
      [product_id, channel, external_id || '', sku || ''],
    );
  }
  return rowCount;
}
