/**
 * Import returns from marketplace reports: Amazon's FBA customer returns
 * report, TikTok Shop's returns export, or any CSV with similar columns.
 *
 * Amazon's report has one row per returned unit. Those are grouped into one
 * return per order (with each unit kept in return_units), so a return means
 * the same thing on every channel.
 *
 * Like the product importer, planReturnsImport() never writes, and
 * runReturnsImport() applies the same plan. Rows are matched to products by
 * listing (ASIN / TikTok product ID / SKU), then product SKU, model, and
 * finally product name. Unmatched rows are still imported so totals stay
 * complete; they can be assigned to a product later, which also teaches
 * future imports the match.
 */
import { AMAZON_REASONS } from '../../shared/workflow.js';
import { logActivity } from './activity.js';
import { cleanNote, sortReturns } from './returnRules.js';

export const MAX_RETURN_ROWS = 20_000;

const key = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
const BLANKS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none']);
const clean = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return BLANKS.has(s.toLowerCase()) ? '' : s;
};

const HEADERS = {
  return_date: ['returndate', 'date', 'requesttime', 'timerequested', 'returnrequesttime', 'createdtime', 'returncreatedtime', 'refundrequesttime', 'requestdate', 'returnrequestdate', 'returnedon'],
  order_ref: ['orderid', 'order', 'ordernumber', 'orderno', 'amazonorderid'],
  return_ref: ['licenseplatenumber', 'lpn', 'returnid', 'returnorderid', 'returnrequestid', 'rmaid', 'rma', 'returnrequestnumber'],
  sku: ['sku', 'sellersku', 'merchantsku', 'skuid', 'msku'],
  external_id: ['asin', 'productid', 'itemid', 'listingid'],
  product_label: ['productname', 'product', 'itemname', 'title', 'producttitle', 'productdescription'],
  quantity: ['quantity', 'qty', 'returnquantity', 'units', 'returnedquantity'],
  reason: ['reason', 'returnreason', 'reasonforreturn', 'refundreason', 'reasoncode', 'code'],
  customer_comment: ['customercomments', 'customercomment', 'comments', 'buyercomment', 'buyercomments', 'returnreasondetails', 'buyernote'],
  disposition: ['detaileddisposition', 'disposition', 'condition', 'itemcondition'],
  status: ['status', 'returnstatus', 'refundstatus'],
  unit_price: ['returnunitprice', 'unitprice', 'itemprice'],
  // Amazon's unit-level columns.
  license_plate: ['licenseplatenumber', 'lpn'],
  fnsku: ['fnsku'],
  fulfillment_center: ['fulfillmentcenterid', 'fulfillmentcenter'],
};

// The first of a field's header names that the report has, in HEADERS order (so TikTok's "Seller SKU" wins over its "SKU ID").
function pick(row, field) {
  const byKey = new Map(Object.entries(row || {}).map(([h, v]) => [key(h), v]));
  for (const name of HEADERS[field]) if (byKey.has(name)) return clean(byKey.get(name));
  return '';
}

/** "$22.65", "USD 22.65", "1,022.65" → 22.65; null if not a number. */
export function parseMoney(value) {
  const s = clean(value).replace(/usd|us\$|\$|,|\s/gi, '');
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

/**
 * Whether a report writes nn/nn/yyyy dates day first ('dmy', as TikTok's export does: 28/09/2026) or month
 * first ('mdy'). A part over 12 settles it; when every date fits both, TikTok reports are read day first.
 */
export function dateOrder(values, channel) {
  for (const v of values) {
    const m = clean(v).match(SLASHED);
    if (m && Number(m[1]) > 12) return 'dmy';
    if (m && Number(m[2]) > 12) return 'mdy';
  }
  return channel === 'tiktok' ? 'dmy' : 'mdy';
}

/** Many report date formats → 'YYYY-MM-DD'; null if unreadable. `order` says how to read nn/nn/yyyy. */
export function parseReportDate(value, order = 'mdy') {
  const s = clean(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return valid(m[1], m[2], m[3]);
  m = s.match(SLASHED);
  if (m) return order === 'dmy' ? valid(m[3], m[2], m[1]) : valid(m[3], m[1], m[2]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function valid(y, mo, d) {
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

const GROUP_RULES = [
  ['defect', /defect|not work|doesn.?t work|does not work|broken|stopped|malfunction|faulty|quality|poor|missing (part|piece|accessor)|won.?t (connect|turn|charge|pair)|no power|dead|glitch|disconnect|blurry|no video|not charging/i],
  ['not_as_described', /not as described|different from|description|compatib|not what|expect|not match|misleading|wrong (size|model|color)/i],
  ['shipping', /damag|ship|deliver|late|arriv|lost|package|carrier|transit/i],
  ['changed_mind', /no longer|changed|mind|better price|cheaper|mistake|ordered wrong|don.?t (need|want)|unwanted|accident|not needed|bought by/i],
];

/** Reason text or Amazon code → { reason_code, reason, reason_group }. */
export function classifyReason(raw) {
  const text = clean(raw);
  if (!text) return { reason_code: '', reason: '', reason_group: 'other' };
  const code = text.toUpperCase().replace(/[\s-]+/g, '_');
  if (Object.hasOwn(AMAZON_REASONS, code)) {
    const [label, group] = AMAZON_REASONS[code];
    return { reason_code: code, reason: label, reason_group: group };
  }
  const group = GROUP_RULES.find(([, re]) => re.test(text.replace(/_/g, ' ')))?.[0] || 'other';
  const human = /^[A-Z0-9_]+$/.test(text) ? text.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : text;
  return { reason_code: code.slice(0, 100), reason: human.slice(0, 300), reason_group: group };
}

async function loadMatcher(db, channel) {
  const [listings, products] = await Promise.all([
    db.query('SELECT product_id, lower(external_id) AS ext, lower(sku) AS sku FROM product_listings WHERE channel = $1', [channel]),
    db.query('SELECT id, name, lower(name) AS lname, lower(sku) AS sku, lower(model) AS model FROM products'),
  ]);
  const byExt = new Map(listings.rows.filter((l) => l.ext).map((l) => [l.ext, l.product_id]));
  const bySku = new Map(listings.rows.filter((l) => l.sku).map((l) => [l.sku, l.product_id]));
  for (const p of products.rows) if (p.sku && !bySku.has(p.sku)) bySku.set(p.sku, p.id);
  const byModel = new Map(products.rows.filter((p) => p.model).map((p) => [p.model, p.id]));
  // Longest names first, so "Doorbell Cam Pro" wins over "Doorbell Cam".
  const byName = [...products.rows].sort((a, b) => b.lname.length - a.lname.length);
  const names = new Map(products.rows.map((p) => [p.id, p.name]));

  return {
    match({ external_id, sku, product_label }) {
      const ext = external_id.toLowerCase();
      const s = sku.toLowerCase();
      const label = product_label.toLowerCase();
      const id =
        (ext && byExt.get(ext)) ||
        (s && bySku.get(s)) ||
        (s && byModel.get(s)) ||
        (label && byName.find((p) => label === p.lname)?.id) ||
        (label && [...byModel.entries()].find(([model]) => model.length >= 2 && new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(label))?.[1]) ||
        (label && byName.find((p) => p.lname.length >= 4 && label.includes(p.lname))?.id) ||
        null;
      return id ? { product_id: id, product_name: names.get(id) } : { product_id: null, product_name: null };
    },
  };
}

// Whether the buyer wrote something of their own: not blank, not only Amazon's menu choice, not only TikTok's reason.
const hasOwnNote = (channel, r) => !!r.customer_comment && cleanNote({ channel, comment: r.customer_comment, reason: r.reason }).note !== '';

const identity = (r) =>
  r.return_ref ? `ref:${r.return_ref.toLowerCase()}` : `c:${r.order_ref}|${r.sku}|${r.external_id}|${r.return_date}|${r.reason_code}|${r.quantity}`.toLowerCase();

/** Work out what an import would do. `rows` are objects keyed by the report's headers. */
export async function planReturnsImport(db, { channel, marketId = null, rows }) {
  const matcher = await loadMatcher(db, channel);
  const order = dateOrder(rows.map((r) => pick(r, 'return_date')), channel);
  const withDates = (plan) => ({ ...plan, dateOrder: rows.some((r) => SLASHED.test(pick(r, 'return_date'))) ? order : null });
  if (channel === 'amazon' && rows.some((r) => pick(r, 'order_ref'))) return withDates(await planAmazonUnits(db, { marketId, rows, matcher, order }));
  const seen = new Set();
  const planned = [];

  for (const [i, raw] of rows.entries()) {
    const r = {
      line: i + 2, // header is line 1
      return_date: parseReportDate(pick(raw, 'return_date'), order),
      order_ref: pick(raw, 'order_ref').slice(0, 100),
      return_ref: pick(raw, 'return_ref').slice(0, 100),
      sku: pick(raw, 'sku').slice(0, 100),
      external_id: pick(raw, 'external_id').slice(0, 100),
      product_label: pick(raw, 'product_label').slice(0, 300),
      quantity: Math.max(1, Math.trunc(Number(pick(raw, 'quantity') || 1)) || 1),
      unit_price: parseMoney(pick(raw, 'unit_price')),
      customer_comment: pick(raw, 'customer_comment').slice(0, 2000),
      disposition: pick(raw, 'disposition').slice(0, 100),
      status: pick(raw, 'status').slice(0, 100),
      ...classifyReason(pick(raw, 'reason')),
    };
    if (!r.return_date) {
      planned.push({ ...r, action: 'error', error: 'Missing or unreadable return date' });
      continue;
    }
    if (!r.sku && !r.external_id && !r.product_label) {
      planned.push({ ...r, action: 'error', error: 'No SKU, ASIN / product ID or product name' });
      continue;
    }
    const id = identity(r);
    if (seen.has(id)) {
      planned.push({ ...r, action: 'duplicate', reason_dup: 'Listed twice in this file' });
      continue;
    }
    seen.add(id);
    planned.push({ ...r, ...matcher.match(r), action: 'create' });
  }

  // Already imported? Compare against existing returns in the same date range. One imported without a buyer note
  // (from an export that didn't have the column) takes the note this report has, instead of being skipped.
  const dates = planned.filter((p) => p.action === 'create').map((p) => p.return_date).sort();
  if (dates.length) {
    const { rows: existing } = await db.query(
      `SELECT id, return_ref, order_ref, sku, external_id, return_date::text AS return_date, reason_code, quantity, customer_comment
         FROM returns WHERE channel = $1 AND return_date BETWEEN $2 AND $3`,
      [channel, dates[0], dates.at(-1)],
    );
    const have = new Map(existing.map((e) => [identity(e), e]));
    for (const p of planned) {
      const old = p.action === 'create' && have.get(identity(p));
      if (!old) continue;
      if (!old.customer_comment.trim() && p.customer_comment) Object.assign(p, { action: 'update', existing_id: old.id, reason_dup: 'Adds the buyer note' });
      else Object.assign(p, { action: 'duplicate', reason_dup: 'Already imported' });
    }
  }

  const creates = planned.filter((p) => p.action === 'create');
  const unmatched = new Map();
  for (const p of creates.filter((c) => !c.product_id)) {
    const k = p.external_id || p.sku || p.product_label;
    const u = unmatched.get(k) || { external_id: p.external_id, sku: p.sku, product_label: p.product_label, units: 0 };
    u.units += p.quantity;
    unmatched.set(k, u);
  }

  return withDates({
    channel,
    marketId,
    rows: planned,
    summary: {
      rows: planned.length,
      create: creates.length,
      units: creates.reduce((n, p) => n + p.quantity, 0),
      duplicates: planned.filter((p) => p.action === 'duplicate').length,
      notes_added: planned.filter((p) => p.action === 'update').length,
      // Rows the report gives a buyer note for, so the preview can show the column was read.
      with_note: planned.filter((p) => p.action !== 'error' && hasOwnNote(channel, p)).length,
      errors: planned.filter((p) => p.action === 'error').length,
      unmatched: creates.filter((p) => !p.product_id).length,
    },
    unmatched: [...unmatched.values()].sort((a, b) => b.units - a.units),
  });
}

// ── Amazon: one row per unit, grouped into one return per order ─────────────

// What identifies a unit's row. Identical rows are separate units (multi-unit orders often have no license plate),
// so the key also counts how many identical rows came before it in the report.
const rowKey = (u) => [u.order_ref, u.license_plate, u.returned_at, u.sku, u.reason_code, u.quantity].join('|').toLowerCase();

/**
 * One return from an order's units. The date is the earliest unit's; the note, reason and product come
 * from the unit whose buyer note says the most (the first one, on a tie).
 */
export function rollUpUnits(units) {
  let best = units[0];
  let bestLength = -1;
  for (const u of units) {
    const length = cleanNote({ channel: 'amazon', comment: u.customer_comment }).note.length;
    if (length > bestLength) [best, bestLength] = [u, length];
  }
  return {
    return_date: units.map((u) => u.unit_date).sort()[0],
    quantity: units.reduce((n, u) => n + u.quantity, 0),
    sku: best.sku,
    external_id: best.external_id,
    product_label: best.product_label,
    customer_comment: best.customer_comment,
    disposition: best.disposition,
    status: best.status,
    ...classifyReason(best.reason_code),
  };
}

async function planAmazonUnits(db, { marketId, rows, matcher, order }) {
  const occurrences = new Map();
  const units = [];
  for (const [i, raw] of rows.entries()) {
    const u = {
      line: i + 2,
      returned_at: pick(raw, 'return_date').slice(0, 50),
      unit_date: parseReportDate(pick(raw, 'return_date'), order),
      order_ref: pick(raw, 'order_ref').slice(0, 100),
      license_plate: pick(raw, 'license_plate').slice(0, 100),
      sku: pick(raw, 'sku').slice(0, 100),
      external_id: pick(raw, 'external_id').slice(0, 100),
      fnsku: pick(raw, 'fnsku').slice(0, 100),
      product_label: pick(raw, 'product_label').slice(0, 300),
      quantity: Math.max(1, Math.trunc(Number(pick(raw, 'quantity') || 1)) || 1),
      reason_code: classifyReason(pick(raw, 'reason')).reason_code,
      customer_comment: pick(raw, 'customer_comment').slice(0, 2000),
      disposition: pick(raw, 'disposition').slice(0, 100),
      status: pick(raw, 'status').slice(0, 100),
      fulfillment_center: pick(raw, 'fulfillment_center').slice(0, 50),
    };
    const shown = { ...u, return_date: u.unit_date, ...classifyReason(pick(raw, 'reason')) };
    if (!u.unit_date) units.push({ ...shown, action: 'error', error: 'Missing or unreadable return date' });
    else if (!u.order_ref) units.push({ ...shown, action: 'error', error: 'No order ID' });
    else if (!u.sku && !u.external_id && !u.product_label) units.push({ ...shown, action: 'error', error: 'No SKU, ASIN or product name' });
    else {
      const n = (occurrences.get(rowKey(u)) ?? 0) + 1;
      occurrences.set(rowKey(u), n);
      units.push({ ...shown, unit_key: `${rowKey(u)}#${n}`, action: 'create' });
    }
  }

  // Already imported? By the unit's key, or, for reports imported before units were kept (each unit its own
  // return under its license plate), by that license plate.
  const fresh = units.filter((u) => u.action === 'create');
  const orders = [...new Set(fresh.map((u) => u.order_ref))];
  // One after the other: planning also runs inside the import transaction, on a single client.
  const knownKeys = await db.query('SELECT unit_key FROM return_units WHERE unit_key = ANY($1::text[])', [fresh.map((u) => u.unit_key)]);
  const knownPlates = await db.query("SELECT lower(return_ref) AS ref FROM returns WHERE channel = 'amazon' AND lower(return_ref) = ANY($1::text[])", [
    fresh.map((u) => u.license_plate.toLowerCase()).filter(Boolean),
  ]);
  const knownOrders = await db.query("SELECT id, return_ref FROM returns WHERE channel = 'amazon' AND return_ref = ANY($1::text[])", [orders]);
  const have = new Set(knownKeys.rows.map((r) => r.unit_key));
  const legacy = new Set(knownPlates.rows.map((r) => r.ref));
  for (const u of fresh) {
    if (have.has(u.unit_key) || legacy.has(u.license_plate.toLowerCase())) Object.assign(u, { action: 'duplicate', reason_dup: 'Already imported' });
  }

  const existing = new Map(knownOrders.rows.map((r) => [r.return_ref, r]));
  const byOrder = new Map();
  for (const u of units.filter((x) => x.action === 'create')) {
    if (!byOrder.has(u.order_ref)) byOrder.set(u.order_ref, []);
    byOrder.get(u.order_ref).push(u);
  }

  const returns = [];
  for (const [order_ref, group] of byOrder) {
    const prior = existing.get(order_ref);
    if (prior) {
      for (const u of group) Object.assign(u, { action: 'add', reason_dup: 'Adds to an earlier return' });
      returns.push({ order_ref, action: 'add', return_id: prior.id, units: group });
      continue;
    }
    const r = { order_ref, return_ref: order_ref, ...rollUpUnits(group) };
    const match = matcher.match(r);
    for (const u of group) Object.assign(u, match);
    returns.push({ ...r, ...match, action: 'create', units: group });
  }

  const creates = returns.filter((r) => r.action === 'create');
  const unmatched = new Map();
  for (const r of creates.filter((c) => !c.product_id)) {
    const k = r.external_id || r.sku || r.product_label;
    const m = unmatched.get(k) || { external_id: r.external_id, sku: r.sku, product_label: r.product_label, units: 0 };
    m.units += r.quantity;
    unmatched.set(k, m);
  }

  return {
    channel: 'amazon',
    marketId,
    grouped: true,
    rows: units,
    returns,
    summary: {
      rows: units.length,
      create: creates.length,
      units: returns.reduce((n, r) => n + r.units.reduce((m, u) => m + u.quantity, 0), 0),
      added: returns.filter((r) => r.action === 'add').reduce((n, r) => n + r.units.length, 0),
      duplicates: units.filter((u) => u.action === 'duplicate').length,
      errors: units.filter((u) => u.action === 'error').length,
      unmatched: creates.filter((r) => !r.product_id).length,
      with_note: units.filter((u) => u.action !== 'error' && hasOwnNote('amazon', u)).length,
    },
    unmatched: [...unmatched.values()].sort((a, b) => b.units - a.units),
  };
}

async function insertUnits(tx, returnId, importId, units) {
  for (const u of units) {
    await tx.query(
      `INSERT INTO return_units (return_id, import_id, report_line, unit_key, unit_date, license_plate, sku, external_id, fnsku, product_label,
                                 quantity, reason_code, customer_comment, disposition, status, fulfillment_center)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [returnId, importId, u.line, u.unit_key, u.unit_date, u.license_plate, u.sku, u.external_id, u.fnsku, u.product_label,
        u.quantity, u.reason_code, u.customer_comment, u.disposition, u.status, u.fulfillment_center],
    );
  }
}

/** Work an Amazon return out again from all of its units, e.g. after units were added or an import undone. */
export async function refreshAmazonReturns(tx, ids) {
  if (!ids.length) return;
  const { rows } = await tx.query(
    `SELECT return_id, unit_date::text AS unit_date, sku, external_id, product_label, quantity, reason_code, customer_comment, disposition, status
       FROM return_units WHERE return_id = ANY($1::uuid[]) ORDER BY created_at, report_line`,
    [ids],
  );
  const byReturn = new Map();
  for (const u of rows) {
    if (!byReturn.has(u.return_id)) byReturn.set(u.return_id, []);
    byReturn.get(u.return_id).push(u);
  }
  for (const [id, units] of byReturn) {
    const r = rollUpUnits(units);
    await tx.query(
      `UPDATE returns SET return_date = $2, quantity = $3, sku = $4, external_id = $5, product_label = $6, reason_code = $7,
              reason = $8, reason_group = $9, customer_comment = $10, disposition = $11, status = $12 WHERE id = $1`,
      [id, r.return_date, r.quantity, r.sku, r.external_id, r.product_label, r.reason_code, r.reason, r.reason_group, r.customer_comment, r.disposition, r.status],
    );
  }
  await sortReturns(tx, { ids });
}

async function runAmazonUnits(tx, plan, importId) {
  let created = 0;
  const added = [];
  for (const r of plan.returns) {
    if (r.action === 'add') {
      await insertUnits(tx, r.return_id, importId, r.units);
      added.push(r.return_id);
      continue;
    }
    const { rows } = await tx.query(
      `INSERT INTO returns
         (import_id, product_id, channel, market_id, return_date, return_ref, order_ref, sku, external_id, product_label,
          quantity, reason_code, reason, reason_group, customer_comment, disposition, status)
       VALUES ($1, $2, 'amazon', $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING RETURNING id`,
      [importId, r.product_id, plan.marketId, r.return_date, r.order_ref, r.sku, r.external_id, r.product_label,
        r.quantity, r.reason_code, r.reason, r.reason_group, r.customer_comment, r.disposition, r.status],
    );
    if (!rows[0]) continue;
    created++;
    await insertUnits(tx, rows[0].id, importId, r.units);
  }
  await refreshAmazonReturns(tx, added);
  return created;
}

/** Apply a plan inside a transaction. Returns the import record. */
export async function runReturnsImport(tx, plan, { filename = '', userId }) {
  const { rows: imp } = await tx.query(
    'INSERT INTO return_imports (channel, filename, row_count, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [plan.channel, filename.slice(0, 200), plan.rows.length, userId],
  );
  const importId = imp[0].id;
  let created = 0;
  if (plan.grouped) created = await runAmazonUnits(tx, plan, importId);
  for (const r of plan.grouped ? [] : plan.rows) {
    if (r.action !== 'create') continue;
    const { rowCount } = await tx.query(
      `INSERT INTO returns
         (import_id, product_id, channel, market_id, return_date, return_ref, order_ref, sku, external_id, product_label,
          quantity, reason_code, reason, reason_group, customer_comment, disposition, status, refund_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT DO NOTHING`,
      [
        importId, r.product_id, plan.channel, plan.marketId, r.return_date, r.return_ref, r.order_ref, r.sku, r.external_id,
        r.product_label, r.quantity, r.reason_code, r.reason, r.reason_group, r.customer_comment, r.disposition, r.status,
        r.unit_price === null ? null : Math.round(r.unit_price * r.quantity * 100) / 100,
      ],
    );
    created += rowCount;
  }
  // Returns imported earlier without a note get this report's, and are sorted again (unless sorted by hand).
  const updates = plan.grouped ? [] : plan.rows.filter((r) => r.action === 'update');
  const updated = [];
  for (const r of updates) {
    const { rows: hit } = await tx.query(
      `UPDATE returns SET customer_comment = $2, note_clean = $3 WHERE id = $1 AND btrim(customer_comment) = '' RETURNING id`,
      [r.existing_id, r.customer_comment, cleanNote({ channel: plan.channel, comment: r.customer_comment, reason: r.reason }).note],
    );
    if (hit[0]) updated.push(hit[0].id);
  }
  const sorting = await sortReturns(tx, { importId });
  if (updated.length) {
    const resorted = await sortReturns(tx, { ids: updated });
    for (const [k, n] of Object.entries(resorted)) if (typeof n === 'number') sorting[k] = (sorting[k] || 0) + n;
  }
  const duplicates = plan.rows.filter((r) => r.action === 'duplicate').length + (plan.summary.create - created);
  const { rows } = await tx.query(
    'UPDATE return_imports SET created_count = $2, duplicate_count = $3, unmatched_count = $4 WHERE id = $1 RETURNING *',
    [importId, created, duplicates, plan.summary.unmatched],
  );
  await logActivity(tx, {
    entityType: 'returns_import',
    entityId: importId,
    action: 'imported',
    changes: { channel: plan.channel, rows: created, units: plan.summary.units, notes_added: updated.length, label: filename || plan.channel, ...sorting },
    userId,
  });
  return { ...rows[0], notes_added: updated.length };
}
