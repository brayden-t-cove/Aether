/**
 * Pull products, test sessions and vendors from Odyssey into Aether.
 *
 * Products: an Odyssey product already in Aether (same Odyssey ID, or the same
 * model / Odyssey name) is linked, never duplicated, and its Aether-only data
 * (markets, channels, notes…) is left alone. Products only in Odyssey are
 * added as read-only "synced" products. Vendors follow the same rule by name.
 * Test sessions are read-only copies.
 *
 * If Odyssey is unreachable, nothing changes: Aether keeps its last copy and
 * the failed run is recorded so the UI can say when data was last refreshed.
 */
import { withTransaction } from './db.js';
import { logActivity } from './activity.js';

const LOCK_ID = 7_310_443;

const SUNSET = new Set(['eol', 'discontinued', 'rejected', 'retired']);
const lifecycleFrom = (status) => {
  const s = String(status || 'active').toLowerCase();
  if (s === 'active') return 'active';
  if (SUNSET.has(s)) return 'sunset';
  return 'upcoming';
};

const VENDOR_STATUS = { active: 'active', prospect: 'prospect', inactive: 'inactive', former: 'inactive', paused: 'inactive' };

const clean = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const lower = (v) => clean(v).toLowerCase();
const toDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const count = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

/** Names an Odyssey product might go by in Aether's model field. */
function odysseyKeys(o) {
  const model = clean(o.modelNumber);
  return [clean(o.name), model, model && clean(o.version) ? `${model}${clean(o.version)}` : '', clean(o.specs?.marketedName)]
    .map((k) => k.toLowerCase())
    .filter(Boolean);
}

async function syncProducts(tx, items, stats) {
  const { rows: existing } = await tx.query('SELECT id, name, model, source, odyssey_id FROM products');
  const byOdysseyId = new Map(existing.filter((p) => p.odyssey_id).map((p) => [p.odyssey_id, p]));
  const idMap = new Map(); // Odyssey product ID → Aether product ID

  for (const o of items) {
    const odysseyId = clean(o.id);
    if (!odysseyId || !clean(o.name)) continue;
    const fields = {
      name: clean(o.name),
      model: clean(o.modelNumber) ? `${clean(o.modelNumber)}${clean(o.version) ? ` ${clean(o.version)}` : ''}` : null,
      manufacturer: clean(o.manufacturer),
      category: clean(o.category),
      lifecycle: lifecycleFrom(o.status || o.specs?.productStatus),
    };

    let product = byOdysseyId.get(odysseyId);
    if (!product) {
      const keys = odysseyKeys(o);
      const candidates = existing.filter(
        (p) => !p.odyssey_id && ((p.model && keys.includes(p.model.toLowerCase())) || p.name.toLowerCase() === lower(o.name)),
      );
      if (candidates.length === 1) {
        product = candidates[0];
        await tx.query('UPDATE products SET odyssey_id = $1, synced_at = now(), updated_at = now() WHERE id = $2', [odysseyId, product.id]);
        product.odyssey_id = odysseyId;
        stats.products_linked++;
      }
    }

    if (product) {
      if (product.source === 'odyssey') {
        const { rowCount } = await tx.query(
          `UPDATE products SET name = $2, model = $3, manufacturer = $4, category = $5, lifecycle = $6, synced_at = now(), updated_at = now()
            WHERE id = $1 AND (name, COALESCE(model, ''), manufacturer, category, lifecycle) IS DISTINCT FROM ($2, COALESCE($3, ''), $4, $5, $6)`,
          [product.id, fields.name, fields.model, fields.manufacturer, fields.category, fields.lifecycle],
        );
        if (rowCount) stats.products_updated++;
        else await tx.query('UPDATE products SET synced_at = now() WHERE id = $1', [product.id]);
      } else {
        await tx.query('UPDATE products SET synced_at = now() WHERE id = $1', [product.id]);
      }
      idMap.set(odysseyId, product.id);
      continue;
    }

    // A model already used by an Aether product can't be reused (unique index); keep the synced one without it.
    const modelTaken = fields.model && existing.some((p) => lower(p.model) === fields.model.toLowerCase());
    const { rows } = await tx.query(
      `INSERT INTO products (name, model, manufacturer, category, lifecycle, source, odyssey_id, synced_at)
       VALUES ($1, $2, $3, $4, $5, 'odyssey', $6, now())
       RETURNING id, name, model, source, odyssey_id`,
      [fields.name, modelTaken ? null : fields.model, fields.manufacturer, fields.category, fields.lifecycle, odysseyId],
    );
    existing.push(rows[0]);
    byOdysseyId.set(odysseyId, rows[0]);
    idMap.set(odysseyId, rows[0].id);
    stats.products_created++;
  }
  return idMap;
}

async function syncSessions(tx, sessions, idMap, stats) {
  for (const s of sessions) {
    const odysseyId = clean(s.id);
    if (!odysseyId) continue;
    const odysseyProductId = clean(s.catalogId || s.productId) || null;
    await tx.query(
      `INSERT INTO test_sessions
         (odyssey_id, odyssey_product_id, product_id, product_name, status, test_plan, tester,
          test_count, pass_count, fail_count, skip_count, issue_count, started_at, completed_at, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
       ON CONFLICT (odyssey_id) DO UPDATE SET
         odyssey_product_id = EXCLUDED.odyssey_product_id, product_id = EXCLUDED.product_id,
         product_name = EXCLUDED.product_name, status = EXCLUDED.status, test_plan = EXCLUDED.test_plan,
         tester = EXCLUDED.tester, test_count = EXCLUDED.test_count, pass_count = EXCLUDED.pass_count,
         fail_count = EXCLUDED.fail_count, skip_count = EXCLUDED.skip_count, issue_count = EXCLUDED.issue_count,
         started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at, synced_at = now()`,
      [
        odysseyId,
        odysseyProductId,
        (odysseyProductId && idMap.get(odysseyProductId)) || null,
        clean(s.productName),
        clean(s.status),
        clean(s.testPlan),
        clean(s.testerName),
        count(s.testCaseCount),
        count(s.passCount),
        count(s.failCount),
        count(s.skipCount),
        count(s.issueCount),
        toDate(s.createdAt || s.date),
        toDate(s.completedAt),
      ],
    );
    stats.sessions_synced++;
  }
}

async function syncVendors(tx, vendors, stats) {
  const { rows: existing } = await tx.query('SELECT id, name, source, odyssey_id FROM vendors');
  for (const o of vendors) {
    const odysseyId = clean(o.id);
    const name = clean(o.name);
    if (!odysseyId || !name) continue;
    const status = VENDOR_STATUS[lower(o.relationshipStatus)] || 'active';
    let vendor = existing.find((v) => v.odyssey_id === odysseyId) || existing.find((v) => !v.odyssey_id && v.name.toLowerCase() === name.toLowerCase());

    if (vendor && vendor.source === 'aether') {
      if (!vendor.odyssey_id) {
        await tx.query('UPDATE vendors SET odyssey_id = $1, synced_at = now(), updated_at = now() WHERE id = $2', [odysseyId, vendor.id]);
        vendor.odyssey_id = odysseyId;
        stats.vendors_updated++;
      }
      continue; // Aether's own vendor record wins; contacts stay as the team keeps them.
    }

    if (vendor) {
      const { rowCount } = await tx.query(
        `UPDATE vendors SET name = $2, status = $3, website = $4, notes = $5, synced_at = now(), updated_at = now()
          WHERE id = $1 AND (name, status, website, notes) IS DISTINCT FROM ($2, $3, $4, $5)`,
        [vendor.id, name, status, clean(o.website), clean(o.notes)],
      );
      if (rowCount) stats.vendors_updated++;
    } else {
      const { rows } = await tx.query(
        `INSERT INTO vendors (name, type, status, website, notes, source, odyssey_id, synced_at)
         VALUES ($1, 'manufacturer', $2, $3, $4, 'odyssey', $5, now())
         ON CONFLICT DO NOTHING
         RETURNING id, name, source, odyssey_id`,
        [name, status, clean(o.website), clean(o.notes), odysseyId],
      );
      if (!rows[0]) continue; // same name as an existing vendor that is linked to another Odyssey record
      vendor = rows[0];
      existing.push(vendor);
      stats.vendors_created++;
    }

    // Synced vendors mirror Odyssey's contact list.
    await tx.query('DELETE FROM vendor_contacts WHERE vendor_id = $1', [vendor.id]);
    for (const c of Array.isArray(o.contacts) ? o.contacts : []) {
      if (!clean(c?.name)) continue;
      await tx.query(
        'INSERT INTO vendor_contacts (vendor_id, name, role, email, phone, messaging) VALUES ($1, $2, $3, $4, $5, $6)',
        [vendor.id, clean(c.name), clean(c.role), clean(c.email), clean(c.phone), clean(c.wechat) ? `WeChat: ${clean(c.wechat)}` : ''],
      );
    }
  }
}

/**
 * Run one sync. Only one runs at a time across all app instances; a second
 * caller gets { skipped: true }.
 */
export async function runOdysseySync(pool, client, { trigger = 'schedule', userId = null } = {}) {
  if (!client) return { skipped: true, reason: 'not_configured' };
  const lockClient = await pool.connect();
  try {
    const { rows: lock } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!lock[0].ok) return { skipped: true, reason: 'already_running' };

    const { rows } = await pool.query('INSERT INTO sync_runs (source, trigger, started_by) VALUES ($1, $2, $3) RETURNING id', ['odyssey', trigger, userId]);
    const runId = rows[0].id;
    const stats = { products_created: 0, products_linked: 0, products_updated: 0, sessions_synced: 0, vendors_created: 0, vendors_updated: 0 };

    try {
      const [products, sessions, vendors] = await Promise.all([client.listProducts(), client.listSessions(), client.listVendors()]);
      await withTransaction(pool, async (tx) => {
        const idMap = await syncProducts(tx, products, stats);
        await syncSessions(tx, sessions, idMap, stats);
        await syncVendors(tx, vendors, stats);
        const changed = stats.products_created + stats.products_linked + stats.products_updated + stats.vendors_created + stats.vendors_updated;
        if (changed) await logActivity(tx, { entityType: 'sync', entityId: runId, action: 'odyssey_sync', changes: stats, userId });
      });
      const { rows: done } = await pool.query(
        `UPDATE sync_runs SET finished_at = now(), ok = true,
           products_created = $2, products_linked = $3, products_updated = $4, sessions_synced = $5, vendors_created = $6, vendors_updated = $7
         WHERE id = $1 RETURNING *`,
        [runId, stats.products_created, stats.products_linked, stats.products_updated, stats.sessions_synced, stats.vendors_created, stats.vendors_updated],
      );
      return done[0];
    } catch (err) {
      const { rows: failed } = await pool.query('UPDATE sync_runs SET finished_at = now(), ok = false, error = $2 WHERE id = $1 RETURNING *', [
        runId,
        String(err.message).slice(0, 500),
      ]);
      return failed[0];
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

export async function lastSyncRuns(db, limit = 10) {
  const { rows } = await db.query(
    `SELECT r.*, u.name AS started_by_name FROM sync_runs r LEFT JOIN users u ON u.id = r.started_by
      WHERE r.source = 'odyssey' ORDER BY r.started_at DESC LIMIT $1`,
    [limit],
  );
  const { rows: ok } = await db.query(`SELECT max(finished_at) AS at FROM sync_runs WHERE source = 'odyssey' AND ok`);
  return { runs: rows, lastSuccessAt: ok[0].at };
}

/** Send an Aether product to Odyssey's catalog and remember the ID Odyssey gives it. */
export async function pushProduct(db, client, product, { category = 'camera', userId } = {}) {
  const created = await client.createProduct({
    name: product.name,
    manufacturer: product.manufacturer || '',
    modelNumber: product.model || '',
    category,
    entity: ['Luna'],
    type: 'production',
    specs: { marketedName: product.name },
  });
  if (!created?.id) throw new Error('Odyssey did not return an ID for the new product');
  await db.query('UPDATE products SET odyssey_id = $1, synced_at = now(), updated_at = now() WHERE id = $2', [String(created.id), product.id]);
  await logActivity(db, { entityType: 'product', entityId: product.id, action: 'sent_to_odyssey', changes: { label: product.name, odyssey_id: String(created.id) }, userId });
  return String(created.id);
}
