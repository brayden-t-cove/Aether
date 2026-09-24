import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff, withTransaction } from '../lib/db.js';
import { isUuid, parse, v } from '../lib/validate.js';
import { PROJECT_TYPES, STATES } from '../../shared/workflow.js';
import { getMarket } from '../lib/markets.js';
import { getTemplate, listTemplates } from '../lib/templates.js';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectSummary,
  listProjectItems,
  listProjects,
  PROJECT_FIELDS,
  updateProject,
} from '../lib/projects.js';
import {
  addDependency,
  createItem,
  createItemsFromTemplate,
  deleteItem,
  getItem,
  ITEM_FIELDS,
  removeDependency,
  updateItem,
} from '../lib/items.js';

async function loadProject(db, id) {
  const project = await getProject(db, id);
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

async function loadItem(db, id) {
  const item = await getItem(db, id);
  if (!item) throw new HttpError(404, 'Checklist item not found');
  return item;
}

// Only pass through query filters that are valid IDs, so bad input can't hit the database as a 500.
const idParam = (value) => (isUuid(value) ? value : undefined);

// Item changes are logged against their project, so a project's history shows everything that happened in it.
const logItem = (db, item, action, changes, userId) =>
  logActivity(db, {
    entityType: 'project',
    entityId: item.project_id,
    action,
    changes: { item_id: item.id, label: item.title, ...changes },
    userId,
  });

export function projectRoutes({ db }) {
  const router = Router();

  router.get('/api/templates', requireAuth, (req, res) => res.json({ templates: listTemplates() }));

  // ── Projects ──────────────────────────────────────────────────────────────

  router.get(
    '/api/projects',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { state, type, open } = req.query;
      res.json({
        projects: await listProjects(db, {
          state: STATES.includes(state) ? state : undefined,
          type: Object.hasOwn(PROJECT_TYPES, type ?? '') ? type : undefined,
          productId: idParam(req.query.productId),
          marketId: idParam(req.query.marketId),
          ownerId: idParam(req.query.ownerId),
          open: open === 'true',
        }),
      });
    }),
  );

  router.get(
    '/api/projects/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const project = await getProjectSummary(db, req.params.id);
      if (!project) throw new HttpError(404, 'Project not found');
      const [items, activity] = await Promise.all([
        listProjectItems(db, project.id),
        listActivity(db, { entityType: 'project', entityId: project.id, limit: 50 }),
      ]);
      res.json({ project, items, activity });
    }),
  );

  router.post(
    '/api/projects',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const fields = parse(req.body, PROJECT_FIELDS, { required: ['name'] });
      const templateKey = req.body?.template || null;
      const template = templateKey ? getTemplate(templateKey) : null;
      if (templateKey && !template) throw new HttpError(400, 'Unknown checklist template');

      if (template && !fields.type) fields.type = template.projectType;
      // A template can default the market (the US launch checklist is for the US).
      if (!fields.market_id && template?.defaultMarketCode) {
        const { rows } = await db.query('SELECT id FROM markets WHERE code = $1', [template.defaultMarketCode]);
        fields.market_id = rows[0]?.id ?? null;
      }
      const market = fields.market_id ? await getMarket(db, fields.market_id) : null;
      if (fields.market_id && !market) throw new HttpError(400, 'Market not found');
      if (template?.needsMarket && !market) throw new HttpError(400, `The ${template.label} checklist needs a market`);

      const project = await withTransaction(db, async (tx) => {
        const created = await createProject(tx, fields, req.user.id);
        const itemCount = template ? await createItemsFromTemplate(tx, created.id, template.build({ market }), req.user.id) : 0;
        await logActivity(tx, {
          entityType: 'project',
          entityId: created.id,
          action: 'created',
          changes: { label: created.name, template: templateKey, items: itemCount },
          userId: req.user.id,
        });
        return created;
      });
      res.status(201).json({ project });
    }),
  );

  router.patch(
    '/api/projects/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadProject(db, req.params.id);
      const fields = parse(req.body, PROJECT_FIELDS);
      const project = await updateProject(db, before.id, fields);
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) {
        await logActivity(db, {
          entityType: 'project',
          entityId: project.id,
          action: 'updated',
          changes: { ...changes, label: project.name },
          userId: req.user.id,
        });
      }
      res.json({ project });
    }),
  );

  router.delete(
    '/api/projects/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const project = await loadProject(db, req.params.id);
      await deleteProject(db, project.id);
      await logActivity(db, {
        entityType: 'project',
        entityId: project.id,
        action: 'deleted',
        changes: { label: project.name },
        userId: req.user.id,
      });
      res.json({ ok: true });
    }),
  );

  // ── Checklist items ───────────────────────────────────────────────────────

  // Search items across projects, e.g. to pick a blocker that lives in another project.
  router.get(
    '/api/items',
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const { rows } = await db.query(
        `SELECT i.id, i.title, i.state, i.project_id, p.name AS project_name
           FROM checklist_items i JOIN projects p ON p.id = i.project_id
          WHERE ($1 = '' OR i.title ILIKE $2 OR p.name ILIKE $2)
          ORDER BY p.name, i.position
          LIMIT 30`,
        [q, `%${q}%`],
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/api/projects/:id/items',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const project = await loadProject(db, req.params.id);
      const fields = parse(req.body, ITEM_FIELDS, { required: ['title'] });
      const item = await createItem(db, project.id, fields, req.user.id);
      await logItem(db, item, 'item_added', { category: item.category }, req.user.id);
      res.status(201).json({ item });
    }),
  );

  router.patch(
    '/api/items/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadItem(db, req.params.id);
      const fields = parse(req.body, ITEM_FIELDS);
      const item = await updateItem(db, before, fields);
      const changes = diff(before, fields, Object.keys(fields).filter((k) => k !== 'position'));
      if (Object.keys(changes).length) await logItem(db, item, 'item_updated', changes, req.user.id);
      res.json({ item });
    }),
  );

  router.delete(
    '/api/items/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const item = await loadItem(db, req.params.id);
      await deleteItem(db, item.id);
      await logItem(db, item, 'item_removed', {}, req.user.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/items/:id/dependencies',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const item = await loadItem(db, req.params.id);
      const { blocked_by_id } = parse(req.body, { blocked_by_id: v.id({ label: 'Blocker', required: true }) }, { required: ['blocked_by_id'] });
      const blocker = await loadItem(db, blocked_by_id);
      if (await addDependency(db, item, blocker)) {
        await logItem(db, item, 'dependency_added', { blocked_by: blocker.title }, req.user.id);
      }
      res.status(201).json({ ok: true });
    }),
  );

  router.delete(
    '/api/items/:id/dependencies/:blockerId',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const item = await loadItem(db, req.params.id);
      const blocker = isUuid(req.params.blockerId) ? await getItem(db, req.params.blockerId) : null;
      if (!(await removeDependency(db, item.id, req.params.blockerId))) throw new HttpError(404, 'Dependency not found');
      await logItem(db, item, 'dependency_removed', { blocked_by: blocker?.title ?? null }, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
