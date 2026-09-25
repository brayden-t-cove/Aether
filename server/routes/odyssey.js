import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { isUuid, v } from '../lib/validate.js';
import { lastSyncRuns, pushProduct, runOdysseySync } from '../lib/sync.js';
import { getProduct } from '../lib/products.js';

export function odysseyRoutes({ db, odyssey }) {
  const router = Router();

  router.get(
    '/api/odyssey/status',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ configured: Boolean(odyssey), url: odyssey?.url ?? null, ...(await lastSyncRuns(db, 10)) });
    }),
  );

  router.post(
    '/api/odyssey/sync',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      if (!odyssey) throw new HttpError(503, "Odyssey isn't connected yet (ODYSSEY_API_URL and ODYSSEY_API_KEY)");
      const run = await runOdysseySync(db, odyssey, { trigger: 'manual', userId: req.user.id });
      if (run.skipped) throw new HttpError(409, 'A sync is already running. Try again in a minute.');
      res.status(run.ok ? 200 : 502).json({ run, error: run.ok ? undefined : run.error });
    }),
  );

  router.post(
    '/api/products/:id/send-to-odyssey',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      if (!odyssey) throw new HttpError(503, "Odyssey isn't connected yet");
      const product = await getProduct(db, req.params.id);
      if (!product) throw new HttpError(404, 'Product not found');
      if (product.odyssey_id) throw new HttpError(409, 'This product is already in Odyssey');
      const category = v.text({ label: 'Odyssey category', max: 50 })(req.body?.category) || 'camera';
      const odysseyId = await pushProduct(db, odyssey, product, { category, userId: req.user.id }).catch((err) => {
        throw new HttpError(502, err.message);
      });
      res.json({ odyssey_id: odysseyId });
    }),
  );

  // Test sessions synced from Odyssey, for a product or for the product of a project.
  router.get(
    '/api/test-sessions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { productId, projectId } = req.query;
      let id = isUuid(productId) ? productId : null;
      if (!id && isUuid(projectId)) {
        const { rows } = await db.query('SELECT product_id FROM projects WHERE id = $1', [projectId]);
        id = rows[0]?.product_id ?? null;
      }
      if (!id) return res.json({ sessions: [] });
      const { rows } = await db.query('SELECT * FROM test_sessions WHERE product_id = $1 ORDER BY started_at DESC NULLS LAST LIMIT 50', [id]);
      res.json({ sessions: rows });
    }),
  );

  return router;
}
