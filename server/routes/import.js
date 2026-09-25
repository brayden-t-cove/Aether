import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireRole } from '../auth/middleware.js';
import { withTransaction } from '../lib/db.js';
import { MAX_ROWS, planImport, runImport } from '../lib/importer.js';

// Plans hold internal lookups; send the browser only what it needs to show.
const publicPlan = (plan) => ({
  summary: plan.summary,
  products: plan.products.map(({ action, name, model, error, reason, warnings, id }) => ({ action, name, model, error, reason, warnings, id })),
  projects: plan.projects.map(({ action, name, error, reason, warnings, items, id }) => ({
    action,
    name,
    error,
    reason,
    warnings,
    itemCount: items?.length ?? 0,
    id,
  })),
});

export function importRoutes({ db }) {
  const router = Router();

  // Admins only: an import can create or change many records at once.
  // With dryRun: true nothing is written and the response is a preview.
  router.post(
    '/api/admin/import',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { products = [], projects = [], dryRun = false } = req.body || {};
      if (!Array.isArray(products) || !Array.isArray(projects)) throw new HttpError(400, 'products and projects must be lists');
      if (products.length + projects.length === 0) throw new HttpError(400, 'Nothing to import');
      if (products.length + projects.length > MAX_ROWS) throw new HttpError(400, `At most ${MAX_ROWS} rows per import`);

      if (dryRun) return res.json({ dryRun: true, ...publicPlan(await planImport(db, { products, projects })) });

      const plan = await withTransaction(db, async (tx) => {
        const p = await planImport(tx, { products, projects });
        return runImport(tx, p, req.user.id);
      });
      res.json({ dryRun: false, ...publicPlan(plan) });
    }),
  );

  return router;
}
