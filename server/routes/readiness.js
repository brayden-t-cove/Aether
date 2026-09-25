import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../auth/middleware.js';
import { isUuid } from '../lib/validate.js';
import { getReadiness } from '../lib/readiness.js';

export function readinessRoutes({ db }) {
  const router = Router();
  router.get(
    '/api/readiness',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(
        await getReadiness(db, {
          productId: isUuid(req.query.productId) ? req.query.productId : undefined,
          includeSunset: req.query.includeSunset === 'true',
        }),
      );
    }),
  );
  return router;
}
