import { Router } from 'express';
import { TEAMS } from '../../shared/roles.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth } from '../auth/middleware.js';
import { isUuid } from '../lib/validate.js';
import { getMyWork } from '../lib/myWork.js';

export function myWorkRoutes({ db }) {
  const router = Router();

  // ?user=<id> to see someone else's (everyone can read everything), ?team=design to look at one team.
  router.get(
    '/api/my-work',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = isUuid(req.query.user) ? req.query.user : req.user.id;
      const teams = [].concat(req.query.team ?? []).filter((t) => Object.hasOwn(TEAMS, t));
      const work = await getMyWork(db, { userId, teams });
      if (!work) throw new HttpError(404, 'User not found');
      res.json(work);
    }),
  );

  return router;
}
