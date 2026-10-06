/**
 * Duplicate products: an Aether product added by hand and a copy synced from Odyssey that sync couldn't match,
 * because the name or model number differs a little ("Ro3v3" vs "JSRo3v3", "AB123" + "(V2)" vs "AB123 V2").
 *
 * suggestDuplicates() scores every such pair and explains why it looks alike; nothing is merged without a person
 * confirming. mergeProducts() folds one product into another: everything that belonged to either ends up on the
 * kept product, which takes the Odyssey link so later syncs update it instead of re-creating the copy.
 */
import { logActivity } from './activity.js';
import { HttpError } from './http.js';

/** Tables whose product_id moves to the kept product. A test checks this covers every foreign key to products. */
export const MOVED_TABLES = [
  'projects',
  'product_variants',
  'certifications',
  'documents',
  'design_requests',
  'test_sessions',
  'product_listings',
  'returns',
  'comparisons',
];
/** Tables keyed by (product, something): rows are copied over unless the kept product already has them. */
export const MERGED_SET_TABLES = { product_markets: 'market_id', vendor_products: 'vendor_id, role' };
/** Tables handled on their own: aliases are re-created, dismissed pairs go with the removed product. */
export const OTHER_PRODUCT_TABLES = ['products', 'product_aliases', 'product_distinct_pairs'];

/** Below this score a pair isn't shown. */
export const MIN_SCORE = 50;

// Words that say what kind of thing it is rather than which one, so they don't make two names alike.
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'by', 'for', 'with', 'luna', 'camera', 'cam', 'smart', 'wifi', 'wi', 'fi', 'security', 'video']);

const lower = (s) => (s || '').normalize('NFKD').toLowerCase();
/** Letters and digits only: "ER-0530 V2" → "er0530v2". */
export const squash = (s) => lower(s).replace(/[^a-z0-9]/g, '');

// A version written as its own word: "V2", "(v2)", "Ver. 3", "version 2", "Gen 2". Not the "v3" inside "Ro3v3".
const VERSION = /(?:^|[^a-z0-9])(?:v|ver\.?|version|gen\.?|generation)\s*(\d{1,2})(?![a-z0-9])/;
export const versionOf = (s) => {
  const m = lower(s).match(VERSION);
  return m ? Number(m[1]) : null;
};
const withoutVersion = (s) => lower(s).replace(new RegExp(VERSION.source, 'g'), ' ');

const words = (s) =>
  withoutVersion(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w));

// Something that reads like a model number: letters and digits, no spaces once squashed, e.g. "W4", "AB123".
const looksLikeModel = (s) => /\d/.test(s) && /[a-z]/.test(s) && s.length >= 2 && s.length <= 20;

/** The model numbers a product could go by, squashed, each with the version it names (or null). */
function modelKeys(p) {
  const version = versionOf(p.model) ?? versionOf(p.name);
  const keys = [];
  const add = (raw, v) => {
    const base = squash(withoutVersion(raw));
    if (!looksLikeModel(base)) return;
    keys.push({ raw: raw.trim(), base, version: v });
  };
  if (p.model) add(p.model, version);
  // Odyssey names are often the model number itself; Aether names sometimes carry it too ("AB123 Doorbell").
  // Resolutions like "2K" or "1080p" aren't model numbers.
  for (const w of lower(p.name).split(/\s+/)) if (/\d/.test(w) && !/^\W*\d+(k|p)\W*$/.test(w) && squash(w).length >= 3) add(w, version);
  return keys;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How alike two products look, 0–100, with the reasons in words. `a` is the Aether product, `b` the synced one.
 * The strongest sign sets the score; each further sign adds a little; versions that disagree take a lot off.
 */
export function scorePair(a, b) {
  const signs = []; // { score, reason }
  const aKeys = modelKeys(a);
  const bKeys = modelKeys(b);

  let modelSign = null;
  for (const x of aKeys) {
    for (const y of bKeys) {
      let sign = null;
      if (x.base === y.base) {
        sign = x.version === y.version || x.version == null || y.version == null
          ? { score: x.version === y.version ? 90 : 75, reason: `Same model number: ${x.raw} and ${y.raw}` }
          : null; // Same model, different versions: a different product. The version check below says so.
      } else {
        const [short, long] = x.base.length <= y.base.length ? [x, y] : [y, x];
        if (short.base.length >= 4 && long.base.includes(short.base)) {
          sign = { score: 70, reason: `Model ${short.raw} is part of ${long.raw}` };
        }
      }
      if (sign && (!modelSign || sign.score > modelSign.score)) modelSign = sign;
    }
  }
  if (modelSign) signs.push(modelSign);

  const aName = squash(withoutVersion(a.name));
  const bName = squash(withoutVersion(b.name));
  if (aName && aName === bName) signs.push({ score: 85, reason: 'Same name once spaces and punctuation are ignored' });
  else {
    const aw = new Set(words(a.name));
    const bw = new Set(words(b.name));
    const [small, big] = aw.size <= bw.size ? [aw, bw] : [bw, aw];
    if (small.size && [...small].every((w) => big.has(w))) {
      // One shared word ("doorbell") is weak on its own; two or more is a real hint.
      signs.push({ score: small.size >= 2 ? 60 : 40, reason: `Every word of "${small === aw ? a.name : b.name}" is in "${small === aw ? b.name : a.name}"` });
    } else {
      // A typo, not a different word: "Indoor" vs "Outdoor" is two letters in eight, which is too many.
      const [x, y] = [[...aw].join(''), [...bw].join('')];
      const similarity = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
      if (x.length >= 5 && y.length >= 5 && similarity >= 0.85) signs.push({ score: 55, reason: 'Names differ by a letter or two' });
    }
  }

  if (!signs.length) return { score: 0, reasons: [] };
  signs.sort((x, y) => y.score - x.score);
  let score = signs[0].score + 10 * Math.min(signs.length - 1, 2);
  const reasons = signs.map((s) => s.reason);

  if (squash(a.manufacturer) && squash(a.manufacturer) === squash(b.manufacturer)) {
    score += 10;
    reasons.push(`Same manufacturer (${b.manufacturer})`);
  }
  const av = versionOf(a.model) ?? versionOf(a.name);
  const bv = versionOf(b.model) ?? versionOf(b.name);
  if (av != null && bv != null && av !== bv) {
    score -= 40;
    reasons.push(`But one is V${av} and the other V${bv}`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

const PRODUCT_COLUMNS = `p.id, p.name, p.model, p.manufacturer, p.category, p.lifecycle, p.source, p.odyssey_id,
  (SELECT count(*)::int FROM projects x WHERE x.product_id = p.id) AS project_count,
  (SELECT count(*)::int FROM certifications x WHERE x.product_id = p.id) AS certification_count,
  (SELECT count(*)::int FROM product_listings x WHERE x.product_id = p.id) AS listing_count,
  (SELECT count(*)::int FROM returns x WHERE x.product_id = p.id) AS return_count,
  (SELECT count(*)::int FROM test_sessions x WHERE x.product_id = p.id) AS test_session_count`;

/**
 * Pairs of an Aether product not yet linked to Odyssey and a product synced from Odyssey that look like the same
 * thing, best first. Pairs someone marked "not the same" are left out.
 */
export async function suggestDuplicates(db) {
  const [{ rows: products }, { rows: distinct }] = await Promise.all([
    db.query(`SELECT ${PRODUCT_COLUMNS} FROM products p ORDER BY p.name`),
    db.query('SELECT product_a, product_b FROM product_distinct_pairs'),
  ]);
  const dismissed = new Set(distinct.map((d) => `${d.product_a}:${d.product_b}`));
  const pairKey = (x, y) => (x < y ? `${x}:${y}` : `${y}:${x}`);
  const aether = products.filter((p) => p.source === 'aether' && !p.odyssey_id);
  const synced = products.filter((p) => p.source === 'odyssey');

  const pairs = [];
  for (const a of aether) {
    for (const b of synced) {
      if (dismissed.has(pairKey(a.id, b.id))) continue;
      const { score, reasons } = scorePair(a, b);
      if (score >= MIN_SCORE) pairs.push({ score, reasons, keep: a, merge: b });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.keep.name.localeCompare(y.keep.name));
}

/** Remember that two products are not the same, so they aren't suggested again. */
export async function markDistinct(db, { aId, bId, userId }) {
  if (aId === bId) throw new HttpError(400, 'Pick two different products');
  const { rows } = await db.query('SELECT id, name FROM products WHERE id = ANY($1::uuid[])', [[aId, bId]]);
  if (rows.length !== 2) throw new HttpError(404, 'Product not found');
  const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
  await db.query(
    'INSERT INTO product_distinct_pairs (product_a, product_b, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [first, second, userId],
  );
  const name = (id) => rows.find((r) => r.id === id).name;
  await logActivity(db, {
    entityType: 'product',
    entityId: aId,
    action: 'marked_distinct',
    changes: { label: name(aId), other: name(bId) },
    userId,
  });
}

const addAlias = (db, productId, alias) =>
  alias?.trim() &&
  db.query(
    `INSERT INTO product_aliases (product_id, alias) VALUES ($1, $2)
     ON CONFLICT (product_id, lower(alias)) DO NOTHING`,
    [productId, alias.trim()],
  );

/**
 * Fold product `mergeId` into `keepId` inside the transaction `tx`. The kept product keeps its name, lifecycle and
 * category; it takes the merged one's Odyssey link, model number and manufacturer when it has them, and anything it
 * lacks (SKU, dates, what it replaces). Markets, channels, notes and every record pointing at either product end up
 * on the kept one. The merged product's name, and the kept one's old model number if it changes, become aliases.
 */
export async function mergeProducts(tx, { keepId, mergeId, userId }) {
  if (keepId === mergeId) throw new HttpError(400, "A product can't be merged into itself");
  const { rows } = await tx.query('SELECT * FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE', [[keepId, mergeId]]);
  const keep = rows.find((r) => r.id === keepId);
  const merge = rows.find((r) => r.id === mergeId);
  if (!keep || !merge) throw new HttpError(404, 'Product not found');
  if (keep.source !== 'aether') throw new HttpError(400, 'Keep the product made in Aether, and merge the synced copy into it');
  if (keep.odyssey_id && merge.odyssey_id) throw new HttpError(400, 'Both products are already linked to Odyssey');

  for (const table of MOVED_TABLES) {
    await tx.query(`UPDATE ${table} SET product_id = $1 WHERE product_id = $2`, [keepId, mergeId]);
  }
  for (const [table, rest] of Object.entries(MERGED_SET_TABLES)) {
    await tx.query(
      `INSERT INTO ${table} (product_id, ${rest}) SELECT $1, ${rest} FROM ${table} WHERE product_id = $2 ON CONFLICT DO NOTHING`,
      [keepId, mergeId],
    );
  }
  const { rows: aliases } = await tx.query('SELECT alias FROM product_aliases WHERE product_id = $1', [mergeId]);
  // Whatever named the merged product as its replacement now names the kept one. (If the kept product said it
  // replaced the merged one, deleting the merged product clears that.)
  await tx.query('UPDATE products SET replaces_id = $1 WHERE replaces_id = $2 AND id <> $1', [keepId, mergeId]);

  // Delete first: the merged product's Odyssey ID, model number and SKU are unique, and move to the kept one.
  await tx.query('DELETE FROM products WHERE id = $1', [mergeId]);

  const fromOdyssey = !!merge.odyssey_id;
  const model = (fromOdyssey && merge.model) || keep.model || merge.model;
  const notes = [keep.notes, merge.notes].map((n) => n.trim()).filter(Boolean).join('\n\n');
  await tx.query(
    `UPDATE products SET
       odyssey_id   = COALESCE(odyssey_id, $2),
       synced_at    = CASE WHEN $2::text IS NULL THEN synced_at ELSE now() END,
       model        = $3,
       manufacturer = $4,
       sku          = COALESCE(sku, $5),
       category     = CASE WHEN category = '' THEN $6 ELSE category END,
       launch_date  = COALESCE(launch_date, $7),
       sunset_date  = COALESCE(sunset_date, $8),
       replaces_id  = COALESCE(replaces_id, NULLIF($9::uuid, id)),
       channels     = ARRAY(SELECT DISTINCT unnest(channels || $10::text[])),
       notes        = $11,
       updated_at   = now()
     WHERE id = $1`,
    [
      keepId,
      merge.odyssey_id,
      model,
      (fromOdyssey && merge.manufacturer) || keep.manufacturer || merge.manufacturer,
      merge.sku,
      merge.category,
      merge.launch_date,
      merge.sunset_date,
      merge.replaces_id,
      merge.channels,
      notes,
    ],
  );

  if (lower(merge.name).trim() !== lower(keep.name).trim()) await addAlias(tx, keepId, merge.name);
  if (keep.model && squash(keep.model) !== squash(model)) await addAlias(tx, keepId, keep.model);
  for (const a of aliases) await addAlias(tx, keepId, a.alias);

  const changes = { label: keep.name, merged: merge.name };
  if (merge.odyssey_id && !keep.odyssey_id) changes.odyssey_id = merge.odyssey_id;
  if ((keep.model || null) !== (model || null)) changes.model = { from: keep.model, to: model };
  await logActivity(tx, { entityType: 'product', entityId: keepId, action: 'merged', changes, userId });
  await logActivity(tx, { entityType: 'product', entityId: mergeId, action: 'merged_into', changes: { label: merge.name, into: keep.name }, userId });
}
