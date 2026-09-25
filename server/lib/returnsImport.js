/**
 * Import returns from marketplace reports: Amazon's FBA customer returns
 * report, TikTok Shop's returns export, or any CSV with similar columns.
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
};

function pick(row, field) {
  for (const [h, v] of Object.entries(row || {})) if (HEADERS[field].includes(key(h))) return clean(v);
  return '';
}

/** Many report date formats → 'YYYY-MM-DD'; null if unreadable. */
export function parseReportDate(value) {
  const s = clean(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return valid(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return valid(m[3], m[1], m[2]);
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

const identity = (r) =>
  r.return_ref ? `ref:${r.return_ref.toLowerCase()}` : `c:${r.order_ref}|${r.sku}|${r.external_id}|${r.return_date}|${r.reason_code}|${r.quantity}`.toLowerCase();

/** Work out what an import would do. `rows` are objects keyed by the report's headers. */
export async function planReturnsImport(db, { channel, marketId = null, rows }) {
  const matcher = await loadMatcher(db, channel);
  const seen = new Set();
  const planned = [];

  for (const [i, raw] of rows.entries()) {
    const r = {
      line: i + 2, // header is line 1
      return_date: parseReportDate(pick(raw, 'return_date')),
      order_ref: pick(raw, 'order_ref').slice(0, 100),
      return_ref: pick(raw, 'return_ref').slice(0, 100),
      sku: pick(raw, 'sku').slice(0, 100),
      external_id: pick(raw, 'external_id').slice(0, 100),
      product_label: pick(raw, 'product_label').slice(0, 300),
      quantity: Math.max(1, Math.trunc(Number(pick(raw, 'quantity') || 1)) || 1),
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

  // Already imported? Compare against existing returns in the same date range.
  const dates = planned.filter((p) => p.action === 'create').map((p) => p.return_date).sort();
  if (dates.length) {
    const { rows: existing } = await db.query(
      `SELECT return_ref, order_ref, sku, external_id, return_date::text AS return_date, reason_code, quantity
         FROM returns WHERE channel = $1 AND return_date BETWEEN $2 AND $3`,
      [channel, dates[0], dates.at(-1)],
    );
    const have = new Set(existing.map(identity));
    for (const p of planned) if (p.action === 'create' && have.has(identity(p))) Object.assign(p, { action: 'duplicate', reason_dup: 'Already imported' });
  }

  const creates = planned.filter((p) => p.action === 'create');
  const unmatched = new Map();
  for (const p of creates.filter((c) => !c.product_id)) {
    const k = p.external_id || p.sku || p.product_label;
    const u = unmatched.get(k) || { external_id: p.external_id, sku: p.sku, product_label: p.product_label, units: 0 };
    u.units += p.quantity;
    unmatched.set(k, u);
  }

  return {
    channel,
    marketId,
    rows: planned,
    summary: {
      rows: planned.length,
      create: creates.length,
      units: creates.reduce((n, p) => n + p.quantity, 0),
      duplicates: planned.filter((p) => p.action === 'duplicate').length,
      errors: planned.filter((p) => p.action === 'error').length,
      unmatched: creates.filter((p) => !p.product_id).length,
    },
    unmatched: [...unmatched.values()].sort((a, b) => b.units - a.units),
  };
}

/** Apply a plan inside a transaction. Returns the import record. */
export async function runReturnsImport(tx, plan, { filename = '', userId }) {
  const { rows: imp } = await tx.query(
    'INSERT INTO return_imports (channel, filename, row_count, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [plan.channel, filename.slice(0, 200), plan.rows.length, userId],
  );
  const importId = imp[0].id;
  let created = 0;
  for (const r of plan.rows) {
    if (r.action !== 'create') continue;
    const { rowCount } = await tx.query(
      `INSERT INTO returns
         (import_id, product_id, channel, market_id, return_date, return_ref, order_ref, sku, external_id, product_label,
          quantity, reason_code, reason, reason_group, customer_comment, disposition, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT DO NOTHING`,
      [
        importId, r.product_id, plan.channel, plan.marketId, r.return_date, r.return_ref, r.order_ref, r.sku, r.external_id,
        r.product_label, r.quantity, r.reason_code, r.reason, r.reason_group, r.customer_comment, r.disposition, r.status,
      ],
    );
    created += rowCount;
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
    changes: { channel: plan.channel, rows: created, units: plan.summary.units, label: filename || plan.channel },
    userId,
  });
  return rows[0];
}
