import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { diff } from '../lib/db.js';
import { isUuid, parse } from '../lib/validate.js';
import { pruneOrphanAttachments, withAttachments } from '../lib/attachments.js';
import { createTestReport, getTestReport, listTestReports, TEST_REPORT_FIELDS, updateTestReport } from '../lib/testReports.js';

/** The product a request is about: ?productId=, or the product of ?projectId=. */
async function productFor(db, { productId, projectId }) {
  if (isUuid(productId)) return { productId, projectId: null };
  if (isUuid(projectId)) {
    const { rows } = await db.query('SELECT product_id FROM projects WHERE id = $1', [projectId]);
    if (!rows[0]) throw new HttpError(404, 'Project not found');
    return { productId: rows[0].product_id, projectId };
  }
  return { productId: null, projectId: null };
}

async function loadReport(db, id) {
  const report = isUuid(id) ? await getTestReport(db, id) : null;
  if (!report) throw new HttpError(404, 'Test result not found');
  return report;
}

export function testReportRoutes({ db, files }) {
  const router = Router();

  // A product's test reports (or those of a project's product), each with its PDF or link.
  router.get(
    '/api/test-reports',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { productId } = await productFor(db, req.query);
      if (!productId) return res.json({ reports: [] });
      res.json({ reports: await withAttachments(db, 'test_report', await listTestReports(db, productId)) });
    }),
  );

  // Add one: { product_id or project_id, title, result?, tested_on?, tested_by?, notes? }. The PDF or link is added
  // to it afterwards through /api/attachments with entity_type 'test_report'.
  router.post(
    '/api/test-reports',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { productId, projectId } = await productFor(db, { productId: req.body?.product_id, projectId: req.body?.project_id });
      if (!productId) throw new HttpError(400, projectId ? 'This project has no product to file test results under' : 'Say which product or project');
      const { rows } = await db.query('SELECT name FROM products WHERE id = $1', [productId]);
      if (!rows[0]) throw new HttpError(404, 'Product not found');
      const fields = parse(req.body, TEST_REPORT_FIELDS, { required: ['title'] });
      const report = await createTestReport(db, { productId, projectId, fields, userId: req.user.id });
      await logActivity(db, { entityType: 'product', entityId: productId, action: 'test_report_added', changes: { label: report.title, product: rows[0].name }, userId: req.user.id });
      res.status(201).json({ report: { ...report, attachments: [] } });
    }),
  );

  router.patch(
    '/api/test-reports/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadReport(db, req.params.id);
      const fields = parse(req.body, TEST_REPORT_FIELDS);
      const changes = diff(before, fields, Object.keys(fields));
      const report = Object.keys(changes).length ? await updateTestReport(db, before.id, fields) : before;
      if (Object.keys(changes).length) {
        await logActivity(db, { entityType: 'product', entityId: before.product_id, action: 'test_report_updated', changes: { label: report.title, ...changes }, userId: req.user.id });
      }
      const [withFiles] = await withAttachments(db, 'test_report', [report]);
      res.json({ report: withFiles });
    }),
  );

  router.delete(
    '/api/test-reports/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const report = await loadReport(db, req.params.id);
      await db.query('DELETE FROM test_reports WHERE id = $1', [report.id]);
      const keys = await pruneOrphanAttachments(db);
      await Promise.all(keys.map((k) => files?.remove(k)));
      await logActivity(db, { entityType: 'product', entityId: report.product_id, action: 'test_report_removed', changes: { label: report.title }, userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  return router;
}
