import { Router } from 'express';
import multer from 'multer';
import contentDisposition from 'content-disposition';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { isUuid, v } from '../lib/validate.js';
import { ATTACHABLE, createAttachment, entityExists, getAttachment } from '../lib/attachments.js';

// Types a browser may show inline. Anything else is always downloaded, so an
// uploaded HTML or SVG file can never run in Aether's origin.
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Where the attachment's activity entry goes, so it shows in the right history. */
async function activityTarget(db, entityType, entityId) {
  if (entityType === 'document_version') {
    const { rows } = await db.query('SELECT document_id, version FROM document_versions WHERE id = $1', [entityId]);
    return { entityType: 'document', entityId: rows[0].document_id, extra: { version: rows[0].version } };
  }
  if (entityType === 'checklist_item') {
    const { rows } = await db.query('SELECT project_id, title FROM checklist_items WHERE id = $1', [entityId]);
    return { entityType: 'project', entityId: rows[0].project_id, extra: { item_id: entityId, item: rows[0].title } };
  }
  return { entityType, entityId, extra: {} };
}

function parseTarget(body) {
  const entityType = body?.entity_type;
  if (!Object.hasOwn(ATTACHABLE, entityType ?? '')) throw new HttpError(400, 'Unknown record type');
  if (!isUuid(body?.entity_id)) throw new HttpError(400, 'Record is not a valid ID');
  return { entityType, entityId: body.entity_id };
}

export function attachmentRoutes({ db, files }) {
  const router = Router();

  router.get('/api/attachments/config', requireAuth, (req, res) => {
    res.json({ uploads: Boolean(files), maxUploadMb: files?.maxUploadMb ?? 0 });
  });

  // Add a link: JSON { entity_type, entity_id, name?, url }
  router.post(
    '/api/attachments/link',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { entityType, entityId } = parseTarget(req.body);
      const url = v.url({ label: 'Link' })(req.body.url);
      if (!url) throw new HttpError(400, 'Link is required');
      if (!(await entityExists(db, entityType, entityId))) throw new HttpError(404, 'Record not found');
      const name = v.text({ label: 'Name', max: 200 })(req.body.name) || url;
      const attachment = await createAttachment(db, { entity_type: entityType, entity_id: entityId, kind: 'link', name, url, uploaded_by: req.user.id });
      const target = await activityTarget(db, entityType, entityId);
      await logActivity(db, { entityType: target.entityType, entityId: target.entityId, action: 'attachment_added', changes: { label: name, ...target.extra }, userId: req.user.id });
      res.status(201).json({ attachment });
    }),
  );

  // Upload a file: multipart form with entity_type, entity_id and file.
  router.post('/api/attachments/file', requireRole('editor'), (req, res, next) => {
    if (!files) return next(new HttpError(503, "File uploads aren't set up yet. Add a link instead."));
    files.single('file')(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        return next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? `Files can be at most ${files.maxUploadMb} MB` : err.message));
      }
      if (err) return next(err);
      const file = req.file;
      try {
        if (!file) throw new HttpError(400, 'Choose a file to upload');
        const { entityType, entityId } = parseTarget(req.body);
        if (!(await entityExists(db, entityType, entityId))) throw new HttpError(404, 'Record not found');
        const name = (file.originalname || 'file').replace(/[\\/\0]/g, '_').slice(0, 200);
        const attachment = await createAttachment(db, {
          entity_type: entityType,
          entity_id: entityId,
          kind: 'file',
          name,
          storage_key: files.keyFor(file.path),
          content_type: file.mimetype || 'application/octet-stream',
          size_bytes: file.size,
          uploaded_by: req.user.id,
        });
        const target = await activityTarget(db, entityType, entityId);
        await logActivity(db, { entityType: target.entityType, entityId: target.entityId, action: 'attachment_added', changes: { label: name, ...target.extra }, userId: req.user.id });
        res.status(201).json({ attachment });
      } catch (e) {
        if (file) await files.remove(files.keyFor(file.path)).catch(() => {});
        next(e);
      }
    });
  });

  router.get(
    '/api/attachments/:id/download',
    requireAuth,
    asyncHandler(async (req, res) => {
      const a = await getAttachment(db, req.params.id);
      if (!a) throw new HttpError(404, 'File not found');
      if (a.kind === 'link') return res.redirect(a.url);
      if (!files) throw new HttpError(503, "File storage isn't set up on this server");
      const inline = INLINE_TYPES.has(a.content_type) && req.query.download !== '1';
      res.set({
        'Content-Type': inline ? a.content_type : 'application/octet-stream',
        'Content-Disposition': contentDisposition(a.name, { type: inline ? 'inline' : 'attachment' }),
        'Cache-Control': 'private, max-age=300',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      });
      res.sendFile(files.pathFor(a.storage_key), (err) => {
        if (err && !res.headersSent) next404(res);
      });
    }),
  );

  router.delete(
    '/api/attachments/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const a = await getAttachment(db, req.params.id);
      if (!a) throw new HttpError(404, 'File not found');
      const target = await activityTarget(db, a.entity_type, a.entity_id).catch(() => null);
      await db.query('DELETE FROM attachments WHERE id = $1', [a.id]);
      if (a.storage_key && files) await files.remove(a.storage_key);
      if (target) {
        await logActivity(db, { entityType: target.entityType, entityId: target.entityId, action: 'attachment_removed', changes: { label: a.name, ...target.extra }, userId: req.user.id });
      }
      res.json({ ok: true });
    }),
  );

  return router;
}

function next404(res) {
  res.status(404).json({ error: 'File is missing from storage' });
}
