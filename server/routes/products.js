import { Router } from 'express';
import { LIFECYCLES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff, withTransaction } from '../lib/db.js';
import { parse } from '../lib/validate.js';
import { listProjects } from '../lib/projects.js';
import { pruneOrphanAttachments } from '../lib/attachments.js';
import { vendorsForProduct } from '../lib/vendors.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  PRODUCT_FIELDS,
  PRODUCT_MARKETS_FIELD,
  setProductMarkets,
  updateProduct,
} from '../lib/products.js';

async function loadProduct(db, id) {
  const product = await getProduct(db, id);
  if (!product) throw new HttpError(404, 'Product not found');
  return product;
}

// Odyssey owns these fields for products that came from Odyssey; everything else stays editable here.
const SYNCED_FIELDS = ['name', 'model', 'manufacturer', 'category', 'lifecycle'];

function assertEditable(product, fields) {
  if (product.source !== 'odyssey') return;
  const locked = SYNCED_FIELDS.filter((k) => k in fields && fields[k] !== product[k]);
  if (locked.length) throw new HttpError(409, `This product is synced from Odyssey. Change ${locked.join(', ')} in Odyssey.`);
}

export function productRoutes({ db, files }) {
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
      const [projects, vendors] = await Promise.all([listProjects(db, { productId: product.id }), vendorsForProduct(db, product.id)]);
      res.json({ product, projects, vendors });
    }),
  );

  router.post(
    '/api/products',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const fields = parse(req.body, PRODUCT_FIELDS, { required: ['name'] });
      const { market_ids } = parse(req.body, PRODUCT_MARKETS_FIELD);
      const id = await withTransaction(db, async (tx) => {
        const created = await createProduct(tx, fields, req.user.id);
        const markets = market_ids ? await setProductMarkets(tx, created.id, market_ids) : [];
        await logActivity(tx, {
          entityType: 'product',
          entityId: created.id,
          action: 'created',
          changes: { label: created.name, lifecycle: created.lifecycle, markets },
          userId: req.user.id,
        });
        return created.id;
      });
      res.status(201).json({ product: await getProduct(db, id) });
    }),
  );

  router.patch(
    '/api/products/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadProduct(db, req.params.id);
      const fields = parse(req.body, PRODUCT_FIELDS);
      assertEditable(before, fields);
      const { market_ids } = parse(req.body, PRODUCT_MARKETS_FIELD);
      if (fields.replaces_id && fields.replaces_id === before.id) throw new HttpError(400, "A product can't replace itself");

      await withTransaction(db, async (tx) => {
        await updateProduct(tx, before.id, fields);
        const changes = diff(before, fields, Object.keys(fields));
        if (market_ids) {
          const markets = await setProductMarkets(tx, before.id, market_ids);
          if (JSON.stringify(markets) !== JSON.stringify(before.market_codes)) {
            changes.markets = { from: before.market_codes, to: markets };
          }
        }
        if (Object.keys(changes).length) {
          await logActivity(tx, {
            entityType: 'product',
            entityId: before.id,
            action: 'updated',
            changes: { ...changes, label: fields.name ?? before.name },
            userId: req.user.id,
          });
        }
      });
      res.json({ product: await getProduct(db, before.id) });
    }),
  );

  router.delete(
    '/api/products/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const product = await loadProduct(db, req.params.id);
      await deleteProduct(db, product.id);
      const keys = await pruneOrphanAttachments(db);
      await Promise.all(keys.map((k) => files?.remove(k)));
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
