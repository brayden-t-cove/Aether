import { Router } from 'express';
import { DOCUMENT_KINDS, VERSION_STATES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff, withTransaction } from '../lib/db.js';
import { isUuid, parse } from '../lib/validate.js';
import { pruneOrphanAttachments, withAttachments } from '../lib/attachments.js';
import { getVariant } from '../lib/variants.js';
import { listRequests } from '../lib/requests.js';
import {
  createDocument,
  createVersion,
  deleteDocument,
  deleteVersion,
  DOCUMENT_FIELDS,
  getDocument,
  getVersion,
  listDocuments,
  listVersions,
  nextVersionLabel,
  updateDocument,
  updateVersion,
  VERSION_FIELDS,
} from '../lib/documents.js';

async function loadDocument(db, id) {
  const doc = await getDocument(db, id);
  if (!doc) throw new HttpError(404, 'Document not found');
  return doc;
}

async function loadVersion(db, id) {
  const version = await getVersion(db, id);
  if (!version) throw new HttpError(404, 'Version not found');
  return version;
}

async function assertVariantOf(db, variantId, productId) {
  if (!variantId) return;
  const variant = await getVariant(db, variantId);
  if (!variant || variant.product_id !== productId) throw new HttpError(400, "That variant isn't one of this product's variants");
}

const logDoc = (db, docId, action, changes, userId) => logActivity(db, { entityType: 'document', entityId: docId, action, changes, userId });

export function documentRoutes({ db, files }) {
  const router = Router();
  const cleanupFiles = async () => {
    const keys = await pruneOrphanAttachments(db);
    await Promise.all(keys.map((k) => files?.remove(k)));
  };

  router.get(
    '/api/documents',
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = req.query;
      res.json({
        documents: await listDocuments(db, {
          productId: isUuid(q.productId) ? q.productId : undefined,
          marketId: isUuid(q.marketId) ? q.marketId : undefined,
          kind: Object.hasOwn(DOCUMENT_KINDS, q.kind ?? '') ? q.kind : undefined,
          state: Object.hasOwn(VERSION_STATES, q.state ?? '') ? q.state : undefined,
        }),
      });
    }),
  );

  router.get(
    '/api/documents/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const document = await loadDocument(db, req.params.id);
      const [versions, requests, activity] = await Promise.all([
        listVersions(db, document.id).then((vs) => withAttachments(db, 'document_version', vs)),
        listRequests(db, { documentId: document.id }),
        listActivity(db, { entityType: 'document', entityId: document.id }),
      ]);
      res.json({ document, versions, requests, activity });
    }),
  );

  // Create a document, optionally with its first version (state defaults to draft).
  router.post(
    '/api/documents',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const fields = parse(req.body, DOCUMENT_FIELDS, { required: ['product_id', 'title'] });
      await assertVariantOf(db, fields.variant_id, fields.product_id);
      const first = req.body?.first_version ? parse(req.body.first_version, VERSION_FIELDS) : null;
      const id = await withTransaction(db, async (tx) => {
        const docId = await createDocument(tx, fields, req.user.id);
        if (first) await createVersion(tx, docId, { ...first, version: first.version || 'v1' }, req.user.id);
        await logDoc(tx, docId, 'created', { label: fields.title, kind: fields.kind ?? 'manual' }, req.user.id);
        return docId;
      });
      res.status(201).json({ document: await getDocument(db, id) });
    }),
  );

  router.patch(
    '/api/documents/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadDocument(db, req.params.id);
      const fields = parse(req.body, DOCUMENT_FIELDS);
      await assertVariantOf(db, fields.variant_id, fields.product_id ?? before.product_id);
      await updateDocument(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) await logDoc(db, before.id, 'updated', { ...changes, label: fields.title ?? before.title }, req.user.id);
      res.json({ document: await getDocument(db, before.id) });
    }),
  );

  router.delete(
    '/api/documents/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const doc = await loadDocument(db, req.params.id);
      await deleteDocument(db, doc.id);
      await cleanupFiles();
      await logDoc(db, doc.id, 'deleted', { label: doc.title }, req.user.id);
      res.json({ ok: true });
    }),
  );

  // ── Versions ──────────────────────────────────────────────────────────────

  router.post(
    '/api/documents/:id/versions',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const doc = await loadDocument(db, req.params.id);
      const fields = parse(req.body, VERSION_FIELDS);
      if (!fields.version) fields.version = await nextVersionLabel(db, doc.id);
      const version = await createVersion(db, doc.id, fields, req.user.id);
      await logDoc(db, doc.id, 'version_added', { label: doc.title, version: version.version, state: version.state }, req.user.id);
      res.status(201).json({ version });
    }),
  );

  router.patch(
    '/api/versions/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadVersion(db, req.params.id);
      const fields = parse(req.body, VERSION_FIELDS);
      const version = await updateVersion(db, before, fields, req.user.id);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) {
        const doc = await getDocument(db, before.document_id);
        await logDoc(db, before.document_id, 'version_updated', { ...changes, label: doc.title, version: version.version }, req.user.id);
      }
      res.json({ version });
    }),
  );

  router.delete(
    '/api/versions/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const version = await loadVersion(db, req.params.id);
      await deleteVersion(db, version.id);
      await cleanupFiles();
      const doc = await getDocument(db, version.document_id);
      await logDoc(db, version.document_id, 'version_removed', { label: doc.title, version: version.version }, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
