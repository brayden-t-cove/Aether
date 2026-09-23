import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../auth/middleware.js';
import { listActivity } from '../lib/activity.js';

export function activityRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/activity',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { entityType, entityId, limit } = req.query;
      res.json({ activity: await listActivity(db, { entityType, entityId, limit }) });
    }),
  );

  return router;
}
