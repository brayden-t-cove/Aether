import { Router } from 'express';
import { CHANNELS, LISTING_STATES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff, updateRow } from '../lib/db.js';
import { parse, v } from '../lib/validate.js';

export const LISTING_FIELDS = {
  channel: v.oneOf(CHANNELS, { label: 'Channel' }),
  market_id: v.id({ label: 'Market' }),
  external_id: v.text({ label: 'Listing ID', max: 100 }),
  sku: v.text({ label: 'SKU', max: 100 }),
  url: v.url({ label: 'Link' }),
  state: v.oneOf(LISTING_STATES, { label: 'State' }),
  notes: v.text({ label: 'Notes', max: 2000 }),
};

const listingLabel = (l) => `${CHANNELS[l.channel]}${l.external_id ? ` ${l.external_id}` : ''}`;
// Listing changes are logged against their product.
const log = (db, listing, action, changes, userId) =>
  logActivity(db, { entityType: 'product', entityId: listing.product_id, action, changes: { listing_id: listing.id, label: listingLabel(listing), ...changes }, userId });

export function listingRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/products/:id/listings',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { rows } = await db.query(
        `SELECT l.*, m.code AS market_code FROM product_listings l LEFT JOIN markets m ON m.id = l.market_id
          WHERE l.product_id = $1 ORDER BY l.channel, m.code NULLS FIRST`,
        [req.params.id],
      );
      res.json({ listings: rows });
    }),
  );

  router.post(
    '/api/products/:id/listings',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows: p } = await db.query('SELECT id FROM products WHERE id = $1', [req.params.id]);
      if (!p[0]) throw new HttpError(404, 'Product not found');
      const f = parse(req.body, LISTING_FIELDS, { required: ['channel'] });
      const { rows } = await db.query(
        `INSERT INTO product_listings (product_id, channel, market_id, external_id, sku, url, state, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.params.id, f.channel, f.market_id ?? null, f.external_id ?? '', f.sku ?? '', f.url ?? '', f.state ?? 'planned', f.notes ?? '', req.user.id],
      );
      await log(db, rows[0], 'listing_added', { state: rows[0].state }, req.user.id);
      res.status(201).json({ listing: rows[0] });
    }),
  );

  router.patch(
    '/api/listings/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query('SELECT * FROM product_listings WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Listing not found');
      const fields = parse(req.body, LISTING_FIELDS);
      const listing = await updateRow(db, 'product_listings', rows[0].id, fields, Object.keys(LISTING_FIELDS));
      const changes = diff(rows[0], fields, Object.keys(fields));
      if (Object.keys(changes).length) await log(db, listing, 'listing_updated', changes, req.user.id);
      res.json({ listing });
    }),
  );

  router.delete(
    '/api/listings/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query('DELETE FROM product_listings WHERE id = $1 RETURNING *', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Listing not found');
      await log(db, rows[0], 'listing_removed', {}, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
