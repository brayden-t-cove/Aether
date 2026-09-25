import { Router } from 'express';
import { CERT_STATES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { isUuid, parse } from '../lib/validate.js';
import { pruneOrphanAttachments, withAttachments } from '../lib/attachments.js';
import { getVariant } from '../lib/variants.js';
import {
  CERT_FIELDS,
  createCertification,
  deleteCertification,
  getCertification,
  listCertifications,
  updateCertification,
} from '../lib/certifications.js';

async function loadCert(db, id) {
  const cert = await getCertification(db, id);
  if (!cert) throw new HttpError(404, 'Certification not found');
  return cert;
}

async function assertVariantOf(db, variantId, productId) {
  if (!variantId) return;
  const variant = await getVariant(db, variantId);
  if (!variant || variant.product_id !== productId) throw new HttpError(400, "That variant isn't one of this product's variants");
}

const label = (c) => `${c.product_name} · ${c.mark} (${c.market_code})`;

export function certificationRoutes({ db, files }) {
  const router = Router();

  router.get(
    '/api/certifications',
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = req.query;
      res.json({
        certifications: await listCertifications(db, {
          productId: isUuid(q.productId) ? q.productId : undefined,
          marketId: isUuid(q.marketId) ? q.marketId : undefined,
          state: Object.hasOwn(CERT_STATES, q.state ?? '') ? q.state : undefined,
          expiring: q.expiring === 'true',
        }),
      });
    }),
  );

  router.get(
    '/api/certifications/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const [cert] = await withAttachments(db, 'certification', [await loadCert(db, req.params.id)]);
      res.json({ certification: cert, activity: await listActivity(db, { entityType: 'certification', entityId: cert.id }) });
    }),
  );

  router.post(
    '/api/certifications',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const fields = parse(req.body, CERT_FIELDS, { required: ['product_id', 'market_id', 'mark'] });
      await assertVariantOf(db, fields.variant_id, fields.product_id);
      const id = await createCertification(db, fields, req.user.id);
      const cert = await getCertification(db, id);
      await logActivity(db, { entityType: 'certification', entityId: id, action: 'created', changes: { label: label(cert), state: cert.state }, userId: req.user.id });
      res.status(201).json({ certification: cert });
    }),
  );

  router.patch(
    '/api/certifications/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadCert(db, req.params.id);
      const fields = parse(req.body, CERT_FIELDS);
      await assertVariantOf(db, fields.variant_id, fields.product_id ?? before.product_id);
      await updateCertification(db, before.id, fields);
      const cert = await getCertification(db, before.id);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) {
        await logActivity(db, { entityType: 'certification', entityId: cert.id, action: 'updated', changes: { ...changes, label: label(cert) }, userId: req.user.id });
      }
      res.json({ certification: cert });
    }),
  );

  router.delete(
    '/api/certifications/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const cert = await loadCert(db, req.params.id);
      await deleteCertification(db, cert.id);
      const keys = await pruneOrphanAttachments(db);
      await Promise.all(keys.map((k) => files?.remove(k)));
      await logActivity(db, { entityType: 'certification', entityId: cert.id, action: 'deleted', changes: { label: label(cert) }, userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  return router;
}
