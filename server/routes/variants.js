import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { parse } from '../lib/validate.js';
import { getProduct } from '../lib/products.js';
import { createVariant, deleteVariant, getVariant, listVariants, updateVariant, VARIANT_FIELDS } from '../lib/variants.js';

// Variant changes are logged against their product.
const logVariant = (db, variant, action, changes, userId) =>
  logActivity(db, { entityType: 'product', entityId: variant.product_id, action, changes: { variant_id: variant.id, label: variant.name, ...changes }, userId });

export function variantRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/products/:id/variants',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!(await getProduct(db, req.params.id))) throw new HttpError(404, 'Product not found');
      res.json({ variants: await listVariants(db, req.params.id) });
    }),
  );

  router.post(
    '/api/products/:id/variants',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const product = await getProduct(db, req.params.id);
      if (!product) throw new HttpError(404, 'Product not found');
      const variant = await createVariant(db, product.id, parse(req.body, VARIANT_FIELDS, { required: ['name'] }), req.user.id);
      await logVariant(db, variant, 'variant_added', {}, req.user.id);
      res.status(201).json({ variant });
    }),
  );

  router.patch(
    '/api/variants/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await getVariant(db, req.params.id);
      if (!before) throw new HttpError(404, 'Variant not found');
      const fields = parse(req.body, VARIANT_FIELDS);
      const variant = await updateVariant(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) await logVariant(db, variant, 'variant_updated', changes, req.user.id);
      res.json({ variant });
    }),
  );

  router.delete(
    '/api/variants/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const variant = await getVariant(db, req.params.id);
      if (!variant) throw new HttpError(404, 'Variant not found');
      await deleteVariant(db, variant.id);
      await logVariant(db, variant, 'variant_removed', {}, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
