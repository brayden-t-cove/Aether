import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../auth/middleware.js';
import { getDashboard } from '../lib/dashboard.js';

export function dashboardRoutes({ db }) {
  const router = Router();
  router.get(
    '/api/dashboard',
    requireAuth,
    asyncHandler(async (req, res) => res.json(await getDashboard(db))),
  );
  return router;
}
