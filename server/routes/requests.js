import { Router } from 'express';
import { hasRole } from '../../shared/roles.js';
import { REQUEST_STATES } from '../../shared/workflow.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { isUuid, parse } from '../lib/validate.js';
import { pruneOrphanAttachments, withAttachments } from '../lib/attachments.js';
import { messages } from '../lib/notify.js';
import { createRequest, deleteRequest, getRequest, listRequests, REQUEST_FIELDS, updateRequest } from '../lib/requests.js';
import { COMMENT_BODY } from '../lib/comments.js';
import {
  addRequestComment,
  deleteRequestComment,
  editRequestComment,
  getRequestComment,
  listRequestComments,
} from '../lib/requestComments.js';

async function loadRequest(db, id) {
  const request = await getRequest(db, id);
  if (!request) throw new HttpError(404, 'Design request not found');
  return request;
}

const excerpt = (body) => (body.length > 140 ? `${body.slice(0, 140)}…` : body);

const log = (db, id, action, changes, userId) => logActivity(db, { entityType: 'design_request', entityId: id, action, changes, userId });

export function requestRoutes({ db, files, notify }) {
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
      const request = await getRequest(db, id);
      notify?.send(messages.requestCreated(notify, { request, who: req.user.name || req.user.email }));
      res.status(201).json({ request });
    }),
  );

  router.patch(
    '/api/design-requests/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadRequest(db, req.params.id);
      const fields = parse(req.body, REQUEST_FIELDS);
      await updateRequest(db, before.id, fields);
      if (fields.state === 'delivered' && before.state !== 'delivered') {
        notify?.send(messages.requestDelivered(notify, { request: await getRequest(db, before.id), who: req.user.name || req.user.email }));
      }
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

  // ── Comments: questions, updates and revision notes on a request ─────────

  router.get(
    '/api/design-requests/:id/comments',
    requireAuth,
    asyncHandler(async (req, res) => {
      const request = await loadRequest(db, req.params.id);
      res.json({ comments: await listRequestComments(db, request.id) });
    }),
  );

  router.post(
    '/api/design-requests/:id/comments',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const request = await loadRequest(db, req.params.id);
      const body = COMMENT_BODY(req.body?.body);
      if (!body) throw new HttpError(400, 'Write a comment first');
      const comment = await addRequestComment(db, { request, body, userId: req.user.id });
      await log(db, request.id, 'comment_added', { label: request.title, excerpt: excerpt(body) }, req.user.id);
      notify?.send(messages.requestComment(notify, { request, who: req.user.name || req.user.email, body }));
      res.status(201).json({ comment });
    }),
  );

  async function loadComment(id) {
    const comment = isUuid(id) ? await getRequestComment(db, id) : null;
    if (!comment) throw new HttpError(404, 'Comment not found');
    return comment;
  }

  // Only the person who wrote a comment can change it.
  router.patch(
    '/api/request-comments/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadComment(req.params.id);
      if (before.created_by !== req.user.id) throw new HttpError(403, 'Only the person who wrote a comment can edit it');
      const body = COMMENT_BODY(req.body?.body);
      if (!body) throw new HttpError(400, 'A comment can’t be empty. Delete it instead.');
      const comment = await editRequestComment(db, before.id, body);
      const request = await loadRequest(db, before.request_id);
      await log(db, request.id, 'comment_edited', { label: request.title, excerpt: excerpt(body) }, req.user.id);
      res.json({ comment });
    }),
  );

  // The writer can delete their own comment; admins can delete any.
  router.delete(
    '/api/request-comments/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const comment = await loadComment(req.params.id);
      if (comment.created_by !== req.user.id && !hasRole(req.user.role, 'admin')) throw new HttpError(403, 'Only the writer or an admin can delete a comment');
      await deleteRequestComment(db, comment.id);
      const request = await loadRequest(db, comment.request_id);
      await log(db, request.id, 'comment_deleted', { label: request.title, excerpt: excerpt(comment.body) }, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
