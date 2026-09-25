import { Router } from 'express';
import { REQUEST_STATES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { isUuid, parse } from '../lib/validate.js';
import { pruneOrphanAttachments, withAttachments } from '../lib/attachments.js';
import { createRequest, deleteRequest, getRequest, listRequests, REQUEST_FIELDS, updateRequest } from '../lib/requests.js';

async function loadRequest(db, id) {
  const request = await getRequest(db, id);
  if (!request) throw new HttpError(404, 'Design request not found');
  return request;
}

const log = (db, id, action, changes, userId) => logActivity(db, { entityType: 'design_request', entityId: id, action, changes, userId });

export function requestRoutes({ db, files }) {
  const router = Router();

  router.get(
    '/api/design-requests',
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = req.query;
      res.json({
        requests: await listRequests(db, {
          state: Object.hasOwn(REQUEST_STATES, q.state ?? '') ? q.state : undefined,
          assigneeId: isUuid(q.assigneeId) ? q.assigneeId : undefined,
          productId: isUuid(q.productId) ? q.productId : undefined,
          open: q.open === 'true',
        }),
      });
    }),
  );

  router.get(
    '/api/design-requests/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const [request] = await withAttachments(db, 'design_request', [await loadRequest(db, req.params.id)]);
      res.json({ request, activity: await listActivity(db, { entityType: 'design_request', entityId: request.id }) });
    }),
  );

  router.post(
    '/api/design-requests',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const fields = parse(req.body, REQUEST_FIELDS, { required: ['title'] });
      const id = await createRequest(db, fields, req.user.id);
      await log(db, id, 'created', { label: fields.title }, req.user.id);
      res.status(201).json({ request: await getRequest(db, id) });
    }),
  );

  router.patch(
    '/api/design-requests/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadRequest(db, req.params.id);
      const fields = parse(req.body, REQUEST_FIELDS);
      await updateRequest(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) await log(db, before.id, 'updated', { ...changes, label: fields.title ?? before.title }, req.user.id);
      res.json({ request: await getRequest(db, before.id) });
    }),
  );

  router.delete(
    '/api/design-requests/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const request = await loadRequest(db, req.params.id);
      await deleteRequest(db, request.id);
      const keys = await pruneOrphanAttachments(db);
      await Promise.all(keys.map((k) => files?.remove(k)));
      await log(db, request.id, 'deleted', { label: request.title }, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
