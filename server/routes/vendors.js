import { Router } from 'express';
import { VENDOR_STATUSES, VENDOR_TYPES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { parse, v } from '../lib/validate.js';
import {
  CONTACT_FIELDS,
  createVendor,
  deleteVendor,
  getVendor,
  listVendors,
  SYNCED_VENDOR_FIELDS,
  updateVendor,
  VENDOR_FIELDS,
  vendorDetails,
} from '../lib/vendors.js';

async function loadVendor(db, id) {
  const vendor = await getVendor(db, id);
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  return vendor;
}

const log = (db, id, action, changes, userId) => logActivity(db, { entityType: 'vendor', entityId: id, action, changes, userId });
const ROLE = { role: v.oneOf(VENDOR_TYPES, { label: 'Role' }) };

export function vendorRoutes({ db }) {
  const router = Router();

  router.get(
    '/api/vendors',
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = req.query;
      res.json({
        vendors: await listVendors(db, {
          type: Object.hasOwn(VENDOR_TYPES, q.type ?? '') ? q.type : undefined,
          status: Object.hasOwn(VENDOR_STATUSES, q.status ?? '') ? q.status : undefined,
          q: typeof q.q === 'string' ? q.q.trim() : undefined,
        }),
      });
    }),
  );

  router.get(
    '/api/vendors/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const vendor = await loadVendor(db, req.params.id);
      res.json({ vendor, ...(await vendorDetails(db, vendor.id)), activity: await listActivity(db, { entityType: 'vendor', entityId: vendor.id }) });
    }),
  );

  router.post(
    '/api/vendors',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const vendor = await createVendor(db, parse(req.body, VENDOR_FIELDS, { required: ['name'] }), req.user.id);
      await log(db, vendor.id, 'created', { label: vendor.name }, req.user.id);
      res.status(201).json({ vendor });
    }),
  );

  router.patch(
    '/api/vendors/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadVendor(db, req.params.id);
      const fields = parse(req.body, VENDOR_FIELDS);
      if (before.source === 'odyssey') {
        const locked = SYNCED_VENDOR_FIELDS.filter((k) => k in fields && fields[k] !== before[k]);
        if (locked.length) throw new HttpError(409, `This vendor is synced from Odyssey. Change ${locked.join(', ')} in Odyssey.`);
      }
      const vendor = await updateVendor(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) await log(db, vendor.id, 'updated', { ...changes, label: vendor.name }, req.user.id);
      res.json({ vendor });
    }),
  );

  router.delete(
    '/api/vendors/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const vendor = await loadVendor(db, req.params.id);
      await deleteVendor(db, vendor.id);
      await log(db, vendor.id, 'deleted', { label: vendor.name }, req.user.id);
      res.json({ ok: true });
    }),
  );

  // ── Contacts ──────────────────────────────────────────────────────────────

  router.post(
    '/api/vendors/:id/contacts',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const vendor = await loadVendor(db, req.params.id);
      if (vendor.source === 'odyssey') throw new HttpError(409, "This vendor's contacts come from Odyssey. Add them there.");
      const f = parse(req.body, CONTACT_FIELDS, { required: ['name'] });
      const { rows } = await db.query(
        'INSERT INTO vendor_contacts (vendor_id, name, role, email, phone, messaging, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [vendor.id, f.name, f.role ?? '', f.email ?? '', f.phone ?? '', f.messaging ?? '', f.notes ?? ''],
      );
      await log(db, vendor.id, 'contact_added', { label: vendor.name, contact: f.name }, req.user.id);
      res.status(201).json({ contact: rows[0] });
    }),
  );

  router.delete(
    '/api/vendor-contacts/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query(
        `DELETE FROM vendor_contacts c USING vendors v WHERE c.id = $1 AND v.id = c.vendor_id AND v.source = 'aether'
         RETURNING c.name, v.id AS vendor_id, v.name AS vendor_name`,
        [req.params.id],
      );
      if (!rows[0]) throw new HttpError(404, 'Contact not found (or it comes from Odyssey)');
      await log(db, rows[0].vendor_id, 'contact_removed', { label: rows[0].vendor_name, contact: rows[0].name }, req.user.id);
      res.json({ ok: true });
    }),
  );

  // ── Product links ─────────────────────────────────────────────────────────

  router.post(
    '/api/vendors/:id/products',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const vendor = await loadVendor(db, req.params.id);
      const { product_id } = parse(req.body, { product_id: v.id({ label: 'Product', required: true }) }, { required: ['product_id'] });
      const { role = 'manufacturer' } = parse(req.body, ROLE);
      await db.query('INSERT INTO vendor_products (vendor_id, product_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [vendor.id, product_id, role]);
      await log(db, vendor.id, 'product_linked', { label: vendor.name, product_id, role }, req.user.id);
      res.status(201).json({ ok: true });
    }),
  );

  router.delete(
    '/api/vendors/:id/products/:productId/:role',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const vendor = await loadVendor(db, req.params.id);
      const { rowCount } = await db.query('DELETE FROM vendor_products WHERE vendor_id = $1 AND product_id = $2 AND role = $3', [
        vendor.id,
        req.params.productId,
        req.params.role,
      ]);
      if (!rowCount) throw new HttpError(404, 'Link not found');
      await log(db, vendor.id, 'product_unlinked', { label: vendor.name, product_id: req.params.productId }, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
