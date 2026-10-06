import { Router } from 'express';
import { LIFECYCLES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff, withTransaction } from '../lib/db.js';
import { isUuid, parse, v } from '../lib/validate.js';
import { listProjects } from '../lib/projects.js';
import { pruneOrphanAttachments } from '../lib/attachments.js';
import { vendorsForProduct } from '../lib/vendors.js';
import { markDistinct, mergeProducts, suggestDuplicates } from '../lib/productMerge.js';
import { moveReturns, productConnections } from '../lib/connections.js';
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

// Odyssey owns these fields for products that came from Odyssey, and the model and manufacturer of Aether products
// linked to Odyssey; everything else stays editable here.
const SYNCED_FIELDS = ['name', 'model', 'manufacturer', 'category', 'lifecycle'];
const LINKED_FIELDS = ['model', 'manufacturer'];

function assertEditable(product, fields) {
  const owned = product.source === 'odyssey' ? SYNCED_FIELDS : product.odyssey_id ? LINKED_FIELDS : [];
  const locked = owned.filter((k) => k in fields && (fields[k] ?? '') !== (product[k] ?? ''));
  if (!locked.length) return;
  const what = product.source === 'odyssey' ? 'This product is synced from Odyssey' : 'This product is linked to Odyssey';
  throw new HttpError(409, `${what}. Change ${locked.join(', ')} in Odyssey.`);
}

const PAIR_FIELDS = { product_id: v.id({ label: 'Product' }), other_id: v.id({ label: 'Other product' }) };
const MERGE_FIELDS = { merge_id: v.id({ label: 'Product to merge' }) };
const MOVE_FIELDS = {
  channel: v.text({ label: 'Channel', max: 20 }),
  external_id: v.text({ label: 'Listing ID', max: 100 }),
  sku: v.text({ label: 'SKU', max: 100 }),
  product_label: v.text({ label: 'Product title', max: 300 }),
  to_product_id: v.id({ label: 'Product' }),
};

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

  // Everything connected to each product (listings, and returns grouped by how they were matched), to check for mix-ups.
  router.get(
    '/api/products/connections',
    requireAuth,
    asyncHandler(async (req, res) => res.json(await productConnections(db))),
  );

  // Move a group of returns (and its listing) to another product, or back to unmatched with to_product_id null.
  router.post(
    '/api/products/:id/move-returns',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      if (!isUuid(req.params.id)) throw new HttpError(404, 'Product not found');
      const f = parse(req.body, MOVE_FIELDS, { required: ['channel'] });
      const result = await withTransaction(db, (tx) =>
        moveReturns(tx, { fromProductId: req.params.id, ...f, toProductId: f.to_product_id ?? null, userId: req.user.id }),
      );
      res.json(result);
    }),
  );

  // Products that look like the same thing: an Aether product and a copy synced from Odyssey.
  router.get(
    '/api/products/duplicates',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ pairs: await suggestDuplicates(db) });
    }),
  );

  router.post(
    '/api/products/duplicates/dismiss',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { product_id, other_id } = parse(req.body, PAIR_FIELDS, { required: ['product_id', 'other_id'] });
      await markDistinct(db, { aId: product_id, bId: other_id, userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  // Fold another product (usually the Odyssey copy) into this one.
  router.post(
    '/api/products/:id/merge',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { merge_id } = parse(req.body, MERGE_FIELDS, { required: ['merge_id'] });
      const keep = await loadProduct(db, req.params.id);
      await withTransaction(db, (tx) => mergeProducts(tx, { keepId: keep.id, mergeId: merge_id, userId: req.user.id }));
      // Everything was moved, so nothing should be orphaned; pruning keeps the rule that deletes are followed by it.
      const keys = await pruneOrphanAttachments(db);
      await Promise.all(keys.map((k) => files?.remove(k)));
      res.json({ product: await getProduct(db, keep.id) });
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
