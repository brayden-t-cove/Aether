import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { parse } from '../lib/validate.js';
import { listProjects } from '../lib/projects.js';
import { createMarket, deleteMarket, getMarket, listMarkets, MARKET_FIELDS, updateMarket } from '../lib/markets.js';

async function loadMarket(db, id) {
  const market = await getMarket(db, id);
  if (!market) throw new HttpError(404, 'Market not found');
  return market;
}

export function marketRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/markets',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ markets: await listMarkets(db) });
    }),
  );

  router.get(
    '/api/markets/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const market = await loadMarket(db, req.params.id);
      res.json({ market, projects: await listProjects(db, { marketId: market.id }) });
    }),
  );

  router.post(
    '/api/markets',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const market = await createMarket(db, parse(req.body, MARKET_FIELDS, { required: ['code', 'name'] }));
      await logActivity(db, {
        entityType: 'market',
        entityId: market.id,
        action: 'created',
        changes: { label: `${market.code} (${market.name})` },
        userId: req.user.id,
      });
      res.status(201).json({ market });
    }),
  );

  router.patch(
    '/api/markets/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadMarket(db, req.params.id);
      const fields = parse(req.body, MARKET_FIELDS);
      const market = await updateMarket(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) {
        await logActivity(db, {
          entityType: 'market',
          entityId: market.id,
          action: 'updated',
          changes: { ...changes, label: market.code },
          userId: req.user.id,
        });
      }
      res.json({ market });
    }),
  );

  router.delete(
    '/api/markets/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const market = await loadMarket(db, req.params.id);
      await deleteMarket(db, market.id);
      await logActivity(db, {
        entityType: 'market',
        entityId: market.id,
        action: 'deleted',
        changes: { label: market.code },
        userId: req.user.id,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
