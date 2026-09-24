import { Router } from 'express';
import { LIFECYCLES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { parse } from '../lib/validate.js';
import { listProjects } from '../lib/projects.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  PRODUCT_FIELDS,
  updateProduct,
} from '../lib/products.js';

async function loadProduct(db, id) {
  const product = await getProduct(db, id);
  if (!product) throw new HttpError(404, 'Product not found');
  return product;
}

function assertEditable(product) {
  if (product.source === 'odyssey') throw new HttpError(409, 'Products synced from Odyssey are edited in Odyssey');
}

export function productRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/products',
    requireAuth,
    asyncHandler(async (req, res) => {
      const lifecycle = Object.hasOwn(LIFECYCLES, req.query.lifecycle ?? '') ? req.query.lifecycle : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
      res.json({ products: await listProducts(db, { lifecycle, q }) });
    }),
  );

  router.get(
    '/api/products/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const product = await loadProduct(db, req.params.id);
      res.json({ product, projects: await listProjects(db, { productId: product.id }) });
    }),
  );

  router.post(
    '/api/products',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const fields = parse(req.body, PRODUCT_FIELDS, { required: ['name'] });
      const product = await createProduct(db, fields, req.user.id);
      await logActivity(db, {
        entityType: 'product',
        entityId: product.id,
        action: 'created',
        changes: { label: product.name, lifecycle: product.lifecycle },
        userId: req.user.id,
      });
      res.status(201).json({ product });
    }),
  );

  router.patch(
    '/api/products/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadProduct(db, req.params.id);
      assertEditable(before);
      const fields = parse(req.body, PRODUCT_FIELDS);
      const product = await updateProduct(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) {
        await logActivity(db, {
          entityType: 'product',
          entityId: product.id,
          action: 'updated',
          changes: { ...changes, label: product.name },
          userId: req.user.id,
        });
      }
      res.json({ product });
    }),
  );

  router.delete(
    '/api/products/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const product = await loadProduct(db, req.params.id);
      await deleteProduct(db, product.id);
      await logActivity(db, {
        entityType: 'product',
        entityId: product.id,
        action: 'deleted',
        changes: { label: product.name },
        userId: req.user.id,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
