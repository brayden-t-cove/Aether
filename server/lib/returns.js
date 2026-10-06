/** Returns analytics: totals, monthly trend by channel, categories, platform reasons, and per-product breakdown. */

// The customer-match workbook rated the return Low, or couldn't match it for a reason that says nothing (order not
// found). "No activation found" stays in: no camera went online in the buyer's zip, which is worth counting.
const WEAK_MATCH = `EXISTS (SELECT 1 FROM return_matches m
   WHERE m.channel = r.channel AND m.return_ref = r.return_ref
     AND (m.confidence = 'low' OR (m.confidence = 'unmatched' AND m.unmatched_reason IS DISTINCT FROM 'no_activation')))`;

// Whether the workbook says the buyer's camera went online: 'online' (High or Medium match to an activation),
// 'never' (no activation found in their zip), or 'unknown' (Low, order not found, no workbook, or Amazon).
const ONLINE = `COALESCE((SELECT CASE WHEN m.confidence IN ('high', 'medium') THEN 'online'
                                     WHEN m.unmatched_reason = 'no_activation' THEN 'never' END
                            FROM return_matches m WHERE m.channel = r.channel AND m.return_ref = r.return_ref), 'unknown')`;

function filters({ from, to, channel, productId, marketId, flag, match, blank }, extra = []) {
  const where = [...extra];
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
  if (flag) add('EXISTS (SELECT 1 FROM return_flags f WHERE f.return_id = r.id AND f.flag = ? AND f.active)', flag);
  if (match === 'strong') where.push(`NOT ${WEAK_MATCH}`);
  // No buyer note. Set-aside returns are left out, as everywhere the dashboard counts returns.
  if (blank) where.push("r.note_clean = '' AND NOT EXISTS (SELECT 1 FROM return_categories sa WHERE sa.id = r.category_id AND sa.set_aside)");
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// A return's cause: its sub-reason's, except that "Points to a camera fault" moves an unclear one to fault.
const CAUSE = `CASE WHEN s.cause = 'unclear' AND EXISTS (SELECT 1 FROM return_flags pf
                    WHERE pf.return_id = r.id AND pf.flag = 'points_to_fault' AND pf.active) THEN 'fault'
                  ELSE COALESCE(s.cause, 'other') END`;

/**
 * Set-aside returns (samples, returns that never reached a customer) are left out of every figure but the
 * setAside breakdown and unmatched_units (returns still waiting to be assigned to a product). Shares and
 * causes use only categories that count toward them (not No Comment or unsorted returns).
 */
export async function returnsSummary(db, opts = {}) {
  const { where, params } = filters(opts, ['NOT COALESCE(c.set_aside, false)']);
  const from = `FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id
                LEFT JOIN return_subreasons s ON s.id = r.subreason_id`;
  const q = (sql, p = params) => db.query(sql, p).then((r) => r.rows);
  const units = (cond) => `COALESCE(sum(r.quantity) FILTER (WHERE ${cond}), 0)::int`;
  const cause = (key) => units(`c.in_share AND ${CAUSE} = '${key}'`);
  const all = filters(opts);
  const [totals, allTotals, setAside, byMonth, byCategory, topReasons, byProduct] = await Promise.all([
    q(`SELECT COALESCE(sum(r.quantity), 0)::int AS units, count(*)::int AS lines,
              count(DISTINCT r.product_id)::int AS products,
              ${units('c.in_share')} AS share_units,
              ${cause('fault')} AS fault_units, ${cause('conditions')} AS conditions_units,
              ${cause('unclear')} AS unclear_units, ${cause('other')} AS other_cause_units,
              ${units(`c.in_share AND ${CAUSE} = 'unclear' AND ${ONLINE} = 'online'`)} AS unclear_online_units,
              ${units(`c.in_share AND ${CAUSE} = 'unclear' AND ${ONLINE} = 'never'`)} AS unclear_never_units,
              ${units(`c.in_share AND ${CAUSE} = 'unclear' AND r.channel <> 'tiktok'`)} AS unclear_not_tiktok_units,
              ${units(`c.in_share AND ${CAUSE} = 'unclear' AND r.channel = 'tiktok'
                        AND NOT EXISTS (SELECT 1 FROM return_matches m WHERE m.channel = r.channel AND m.return_ref = r.return_ref)`)} AS unclear_not_in_workbook_units,
              ${units("c.key = 'no_comment'")} AS no_comment_units,
              ${units('r.category_id IS NULL')} AS unsorted_units,
              min(r.return_date)::text AS first_date, max(r.return_date)::text AS last_date
         ${from} ${where}`),
    q(`SELECT ${units('c.set_aside')} AS set_aside_units, ${units('r.product_id IS NULL')} AS unmatched_units ${from} ${all.where}`, all.params),
    q(`SELECT c.key AS category_key, s.key, s.name, sum(r.quantity)::int AS units
         ${from} ${all.where} ${all.where ? 'AND' : 'WHERE'} c.set_aside
        GROUP BY c.key, s.key, s.name, c.sort_order, s.sort_order ORDER BY c.sort_order, s.sort_order`, all.params),
    q(`SELECT to_char(date_trunc('month', r.return_date), 'YYYY-MM') AS month, r.channel, sum(r.quantity)::int AS units
         ${from} ${where} GROUP BY 1, 2 ORDER BY 1, 2`),
    q(`SELECT c.key, c.name, sum(r.quantity)::int AS units
         ${from} ${where} AND c.in_share
        GROUP BY c.key, c.name, c.sort_order ORDER BY units DESC, c.sort_order`),
    q(`SELECT r.reason_code, min(r.reason) AS reason, sum(r.quantity)::int AS units
         ${from} ${where} GROUP BY r.reason_code ORDER BY units DESC LIMIT 10`),
    q(`WITH f AS (SELECT r.*, c.name AS category_name, c.in_share, c.sort_order, ${CAUSE} AS cause ${from} ${where}),
            per AS (SELECT product_id, category_name, sort_order, sum(quantity) AS u FROM f WHERE in_share GROUP BY 1, 2, 3),
            top AS (SELECT DISTINCT ON (product_id) product_id, category_name FROM per ORDER BY product_id, u DESC, sort_order)
       SELECT f.product_id, COALESCE(p.name, 'Unmatched') AS name, p.model, sum(f.quantity)::int AS units,
              COALESCE(sum(f.quantity) FILTER (WHERE f.in_share), 0)::int AS share_units,
              COALESCE(sum(f.quantity) FILTER (WHERE f.in_share AND f.cause = 'fault'), 0)::int AS fault_units,
              COALESCE(sum(f.quantity) FILTER (WHERE f.in_share AND f.cause = 'unclear'), 0)::int AS unclear_units,
              t.category_name AS top_category
         FROM f
         LEFT JOIN products p ON p.id = f.product_id
         LEFT JOIN top t ON t.product_id IS NOT DISTINCT FROM f.product_id
        GROUP BY f.product_id, p.name, p.model, t.category_name
        ORDER BY units DESC`),
  ]);
  return { totals: { ...totals[0], ...allTotals[0] }, setAside, byMonth, byCategory, topReasons, byProduct };
}

// Weeks run Monday to Sunday. "Today" is taken in MST (UTC−7, no daylight saving), the team's time zone for days.
export const RETURNS_TZ = 'America/Phoenix';
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Returns per week for the dashboard views: the last `weeks` Monday-to-Sunday weeks up to `end` (a date in
 * the last week; default today in MST). Each row is one week × channel × product × category × cause × whether
 * the buyer left a note, so the page can add them up any way it needs. Set-aside returns are left out, as on
 * the summary. A week is partial until its Sunday has passed in MST.
 */
export async function returnsWeekly(db, { weeks = 12, end, ...opts } = {}) {
  const { rows: [{ today }] } = await db.query(`SELECT (now() AT TIME ZONE '${RETURNS_TZ}')::date::text AS today`);
  const count = Math.min(Math.max(Number(weeks) || 12, 2), 52);
  const last = mondayOf(end || today);
  const list = Array.from({ length: count }, (_, i) => addDays(last, (i - count + 1) * 7));
  const { where, params } = filters({ ...opts, from: list[0], to: addDays(last, 6) }, ['NOT COALESCE(c.set_aside, false)']);
  const { rows } = await db.query(
    `SELECT date_trunc('week', r.return_date)::date::text AS week, r.channel, r.product_id, p.name AS product_name,
            c.key AS category_key, c.name AS category_name,
            CASE WHEN c.in_share THEN ${CAUSE} END AS cause,
            r.note_clean = '' AS blank,
            count(*)::int AS returns, sum(r.quantity)::int AS units
       FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id
       LEFT JOIN return_subreasons s ON s.id = r.subreason_id LEFT JOIN products p ON p.id = r.product_id
      ${where}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`,
    params,
  );
  const { rows: [latest] } = await db.query('SELECT max(return_date)::text AS date FROM returns');
  return {
    today,
    latestReturn: latest.date,
    weeks: list.map((week) => ({ week, end: addDays(week, 6), partial: addDays(week, 6) >= today })),
    rows,
  };
}

// A return's active flags and secondary category keys, as arrays.
const EXTRAS = `ARRAY(SELECT f.flag FROM return_flags f WHERE f.return_id = r.id AND f.active ORDER BY f.flag) AS flags,
  ARRAY(SELECT sc.key FROM return_secondary_categories x JOIN return_categories sc ON sc.id = x.category_id
         WHERE x.return_id = r.id ORDER BY sc.sort_order) AS secondary`;

export async function listReturns(db, { limit = 200, ...opts } = {}) {
  const { where, params } = filters(opts);
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const { rows } = await db.query(
    `SELECT r.*, r.return_date::text AS return_date, p.name AS product_name, m.code AS market_code,
            c.key AS category_key, c.name AS category_name, s.key AS subreason_key, s.name AS subreason_name, ${EXTRAS}
       FROM returns r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN markets m ON m.id = r.market_id
       LEFT JOIN return_categories c ON c.id = r.category_id LEFT JOIN return_subreasons s ON s.id = r.subreason_id
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

// A return needs a person when the buyer wrote something and it isn't set aside by its platform code.
const NEEDS_PERSON = "r.note_clean <> '' AND NOT COALESCE(c.set_aside, false)";
const REVIEW_VIEWS = {
  // The Other page: the rules found nothing they recognise.
  unsorted: 'r.category_id IS NULL',
  // The rules made a call that no one has looked at yet.
  unreviewed: `r.category_id IS NOT NULL AND r.reviewed_at IS NULL AND ${NEEDS_PERSON}`,
};
export const REVIEW_VIEW_KEYS = Object.keys(REVIEW_VIEWS);

/** Returns waiting on a person, newest first, with counts for the progress line. */
export async function reviewQueue(db, { view = 'unsorted', channel, flag, limit = 200 } = {}) {
  const params = [];
  const where = [];
  if (channel) {
    params.push(channel);
    where.push(`r.channel = $${params.length}`);
  }
  if (flag) {
    params.push(flag);
    where.push(`EXISTS (SELECT 1 FROM return_flags f WHERE f.return_id = r.id AND f.flag = $${params.length} AND f.active)`);
  }
  const scope = where.length ? `AND ${where.join(' AND ')}` : '';
  const from = `FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id`;
  const { rows: [counts] } = await db.query(
    `SELECT count(*) FILTER (WHERE r.category_id IS NULL)::int AS unsorted,
            count(*) FILTER (WHERE ${REVIEW_VIEWS.unreviewed})::int AS unreviewed,
            count(*) FILTER (WHERE ${NEEDS_PERSON})::int AS noted,
            count(*) FILTER (WHERE ${NEEDS_PERSON} AND r.reviewed_at IS NOT NULL)::int AS reviewed
       ${from} WHERE true ${scope}`,
    params,
  );
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const { rows } = await db.query(
    `SELECT r.id, r.channel, r.return_date::text AS return_date, r.return_ref, r.order_ref, r.product_label, p.name AS product_name,
            r.quantity, r.reason, r.note_clean, r.category_source, r.category_why,
            c.key AS category_key, c.name AS category_name, s.key AS subreason_key, s.name AS subreason_name, ${EXTRAS}
       ${from} LEFT JOIN return_subreasons s ON s.id = r.subreason_id LEFT JOIN products p ON p.id = r.product_id
      WHERE ${REVIEW_VIEWS[view]} ${scope}
      ORDER BY r.return_date DESC, r.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return { counts, returns: rows };
}

/**
 * A person files a return under a category and sub-reason, or confirms the rules' call.
 * Either way it becomes a manual call the rules won't change. → { before, after } names, or null if not found.
 */
export async function setReturnCategory(db, { id, category, subreason, userId }) {
  const { rows: [pick] } = await db.query(
    `SELECT c.id AS category_id, s.id AS subreason_id, c.name || ' / ' || s.name AS label
       FROM return_subreasons s JOIN return_categories c ON c.id = s.category_id WHERE c.key = $1 AND s.key = $2`,
    [category, subreason],
  );
  if (!pick) return { invalid: true };
  const { rows: [before] } = await db.query(
    `SELECT r.id, r.product_label, r.return_ref, r.subreason_id, c.name || ' / ' || s.name AS label
       FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id LEFT JOIN return_subreasons s ON s.id = r.subreason_id
      WHERE r.id = $1`,
    [id],
  );
  if (!before) return null;
  await db.query(
    `UPDATE returns SET category_id = $2, subreason_id = $3, category_source = 'manual',
            category_why = CASE WHEN subreason_id = $3 THEN category_why ELSE '' END, reviewed_by = $4, reviewed_at = now()
      WHERE id = $1`,
    [id, pick.category_id, pick.subreason_id, userId],
  );
  return { confirmed: before.subreason_id === pick.subreason_id, from: before.label, to: pick.label, label: before.product_label || before.return_ref };
}

const returnLabel = async (db, id) =>
  (await db.query("SELECT COALESCE(NULLIF(product_label, ''), return_ref) AS label FROM returns WHERE id = $1", [id])).rows[0]?.label;

/** A person turns a flag on or off. The rules leave it that way. → the return's label, or null if not found. */
export async function setReturnFlag(db, { id, flag, on, userId }) {
  const label = await returnLabel(db, id);
  if (label === undefined) return null;
  await db.query(
    `INSERT INTO return_flags (return_id, flag, source, active, set_by) VALUES ($1, $2, 'manual', $3, $4)
     ON CONFLICT (return_id, flag) DO UPDATE SET source = 'manual', active = EXCLUDED.active, set_by = EXCLUDED.set_by, created_at = now()`,
    [id, flag, on, userId],
  );
  return { label };
}

/**
 * Replace a return's secondary categories (codebook keys). The main category and set-aside or
 * no-comment categories are left out. → { label, names }, { invalid } for an unknown key, or null if not found.
 */
export async function setSecondaryCategories(db, { id, categories, userId }) {
  const label = await returnLabel(db, id);
  if (label === undefined) return null;
  const { rows: picked } = await db.query(
    `SELECT c.id, c.key, c.name FROM return_categories c
      WHERE c.key = ANY($1::text[]) AND c.in_share
        AND c.id IS DISTINCT FROM (SELECT category_id FROM returns WHERE id = $2)
      ORDER BY c.sort_order`,
    [categories, id],
  );
  const { rows: known } = await db.query('SELECT key FROM return_categories WHERE key = ANY($1::text[])', [categories]);
  if (known.length !== new Set(categories).size) return { invalid: true };
  await db.query('DELETE FROM return_secondary_categories WHERE return_id = $1', [id]);
  await db.query(
    `INSERT INTO return_secondary_categories (return_id, category_id, added_by) SELECT $1, unnest($2::uuid[]), $3`,
    [id, picked.map((c) => c.id), userId],
  );
  return { label, names: picked.map((c) => c.name) };
}
