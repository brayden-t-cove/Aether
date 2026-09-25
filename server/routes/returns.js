import { Router } from 'express';
import { CHANNELS } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { withTransaction } from '../lib/db.js';
import { isUuid, parse, v } from '../lib/validate.js';
import { MAX_RETURN_ROWS, planReturnsImport, runReturnsImport } from '../lib/returnsImport.js';
import { assignReturns, listReturns, returnsSummary, unmatchedReturns } from '../lib/returns.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(q) {
  return {
    from: DATE.test(q.from ?? '') ? q.from : undefined,
    to: DATE.test(q.to ?? '') ? q.to : undefined,
    channel: Object.hasOwn(CHANNELS, q.channel ?? '') ? q.channel : undefined,
    productId: isUuid(q.productId) ? q.productId : undefined,
    marketId: isUuid(q.marketId) ? q.marketId : undefined,
  };
}

// The browser only needs a sample of rows to preview; the full plan is rebuilt on import.
const publicPlan = (plan) => ({
  summary: plan.summary,
  unmatched: plan.unmatched.slice(0, 50),
  rows: plan.rows.slice(0, 200).map(({ line, action, error, reason_dup, return_date, sku, external_id, product_label, quantity, reason, reason_group, product_name }) => ({
    line, action, error, reason_dup, return_date, sku, external_id, product_label, quantity, reason, reason_group, product_name,
  })),
});

export function returnRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/returns/summary',
    requireAuth,
    asyncHandler(async (req, res) => res.json(await returnsSummary(db, readFilters(req.query)))),
  );

  router.get(
    '/api/returns',
    requireAuth,
    asyncHandler(async (req, res) => res.json({ returns: await listReturns(db, { ...readFilters(req.query), limit: req.query.limit }) })),
  );

  router.get(
    '/api/returns/unmatched',
    requireAuth,
    asyncHandler(async (req, res) => res.json({ unmatched: await unmatchedReturns(db) })),
  );

  router.get(
    '/api/returns/imports',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { rows } = await db.query(
        `SELECT i.*, u.name AS created_by_name FROM return_imports i LEFT JOIN users u ON u.id = i.created_by
          ORDER BY i.created_at DESC LIMIT 50`,
      );
      res.json({ imports: rows });
    }),
  );

  // Import a report. { channel, market_id?, filename?, rows: [...], dryRun }
  router.post(
    '/api/returns/import',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { channel, market_id } = parse(req.body, { channel: v.oneOf(CHANNELS, { label: 'Channel' }), market_id: v.id({ label: 'Market' }) }, { required: ['channel'] });
      const rows = req.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'No rows found in the report');
      if (rows.length > MAX_RETURN_ROWS) throw new HttpError(400, `At most ${MAX_RETURN_ROWS} rows per import`);
      const filename = v.text({ label: 'File name', max: 200 })(req.body.filename);

      if (req.body.dryRun) return res.json({ dryRun: true, ...publicPlan(await planReturnsImport(db, { channel, marketId: market_id, rows })) });

      const result = await withTransaction(db, async (tx) => {
        const plan = await planReturnsImport(tx, { channel, marketId: market_id, rows });
        const record = await runReturnsImport(tx, plan, { filename, userId: req.user.id });
        return { plan, record };
      });
      res.json({ dryRun: false, import: result.record, ...publicPlan(result.plan) });
    }),
  );

  // Undo an import.
  router.delete(
    '/api/returns/imports/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const imp = await withTransaction(db, async (tx) => {
        const { rows } = await tx.query('SELECT * FROM return_imports WHERE id = $1', [req.params.id]);
        if (!rows[0]) throw new HttpError(404, 'Import not found');
        await tx.query('DELETE FROM returns WHERE import_id = $1', [rows[0].id]);
        await tx.query('DELETE FROM return_imports WHERE id = $1', [rows[0].id]);
        return rows[0];
      });
      await logActivity(db, { entityType: 'returns_import', entityId: imp.id, action: 'deleted', changes: { label: imp.filename || imp.channel, rows: imp.created_count }, userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/returns/assign',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const f = parse(
        req.body,
        {
          channel: v.oneOf(CHANNELS, { label: 'Channel' }),
          product_id: v.id({ label: 'Product', required: true }),
          external_id: v.text({ label: 'Listing ID', max: 100 }),
          sku: v.text({ label: 'SKU', max: 100 }),
          product_label: v.text({ label: 'Product name', max: 300 }),
        },
        { required: ['channel', 'product_id'] },
      );
      if (!f.external_id && !f.sku && !f.product_label) throw new HttpError(400, 'Say which returns to assign (listing ID, SKU or product name)');
      const count = await assignReturns(db, { ...f, createListing: req.body.create_listing !== false });
      await logActivity(db, { entityType: 'product', entityId: f.product_id, action: 'returns_assigned', changes: { label: f.external_id || f.sku || f.product_label, rows: count }, userId: req.user.id });
      res.json({ assigned: count });
    }),
  );

  return router;
}
