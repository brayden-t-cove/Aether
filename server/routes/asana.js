import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { isUuid } from '../lib/validate.js';
import { getItem } from '../lib/items.js';
import { getProject } from '../lib/projects.js';
import { parseAsanaLink } from '../lib/asana.js';
import { lastAsanaPulls, pullAsanaComments } from '../lib/asanaSync.js';

// Links from Asana are shown as clickable links, so only https ones are kept.
const safeUrl = (url) => (/^https:\/\//i.test(url || '') ? url : '');

/**
 * Asana, read-only: link a project to its Asana project and checklist items to Asana tasks, and pull the tasks'
 * comments into the items' updates.
 */
export function asanaRoutes({ db, asana }) {
  const router = Router();

  const needAsana = () => {
    if (!asana) throw new HttpError(503, "Asana isn't connected yet (ASANA_TOKEN)");
  };
  // Asana's "can't find it" and "refused the token" become a 400 the person can act on, not a server error.
  const fromAsana = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw new HttpError(err.status === 404 ? 400 : 502, err.message);
    }
  };
  const loadProject = async (id) => {
    const project = isUuid(id) ? await getProject(db, id) : null;
    if (!project) throw new HttpError(404, 'Project not found');
    return project;
  };
  const loadItem = async (id) => {
    const item = isUuid(id) ? await getItem(db, id) : null;
    if (!item) throw new HttpError(404, 'Checklist item not found');
    return item;
  };

  router.get(
    '/api/asana/status',
    requireAuth,
    asyncHandler(async (req, res) => res.json({ configured: Boolean(asana), ...(await lastAsanaPulls(db, 5)) })),
  );

  // Pull now: every linked item, or one project's. { project_id? }
  router.post(
    '/api/asana/pull',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      needAsana();
      const projectId = isUuid(req.body?.project_id) ? req.body.project_id : undefined;
      const run = await pullAsanaComments(db, asana, { trigger: 'manual', userId: req.user.id, projectId });
      if (run.skipped) throw new HttpError(409, 'A pull is already running. Try again in a minute.');
      if (run.ok === false && !run.id) throw new HttpError(502, run.error);
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const message = `${plural(run.added, 'new comment')} from ${plural(run.items, 'linked task')}${run.error ? `. ${run.error}` : ''}`;
      res.json({ run, message });
    }),
  );

  // ── A project ↔ its Asana project ───────────────────────────────────────

  router.put(
    '/api/projects/:id/asana',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      needAsana();
      const project = await loadProject(req.params.id);
      const link = parseAsanaLink(req.body?.link);
      const gid = link.projectGid || link.gid;
      if (!gid) throw new HttpError(400, "That doesn't look like an Asana project link. Open the project in Asana and copy the address bar.");
      const found = await fromAsana(() => asana.getProject(gid));
      await db.query('UPDATE projects SET asana_project_gid = $2, asana_project_name = $3, asana_project_url = $4, updated_at = now() WHERE id = $1', [
        project.id,
        found.gid,
        found.name || '',
        safeUrl(found.permalink_url),
      ]);
      await logActivity(db, { entityType: 'project', entityId: project.id, action: 'asana_linked', changes: { label: project.name, asana: found.name }, userId: req.user.id });
      res.json({ asana_project: { gid: found.gid, name: found.name, url: safeUrl(found.permalink_url) } });
    }),
  );

  router.delete(
    '/api/projects/:id/asana',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const project = await loadProject(req.params.id);
      if (!project.asana_project_gid) return res.json({ ok: true });
      await db.query("UPDATE projects SET asana_project_gid = NULL, asana_project_name = '', asana_project_url = '', updated_at = now() WHERE id = $1", [project.id]);
      await logActivity(db, { entityType: 'project', entityId: project.id, action: 'asana_unlinked', changes: { label: project.name, asana: project.asana_project_name }, userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  // The linked Asana project's tasks, each with the item it feeds (if any), for picking one to link.
  router.get(
    '/api/projects/:id/asana/tasks',
    requireAuth,
    asyncHandler(async (req, res) => {
      needAsana();
      const project = await loadProject(req.params.id);
      if (!project.asana_project_gid) return res.json({ tasks: [] });
      const tasks = await fromAsana(() => asana.listProjectTasks(project.asana_project_gid));
      const { rows: linked } = await db.query(
        'SELECT id, title, project_id, asana_task_gid FROM checklist_items WHERE asana_task_gid = ANY($1::text[])',
        [tasks.map((t) => t.gid)],
      );
      const byGid = new Map(linked.map((i) => [i.asana_task_gid, i]));
      res.json({
        tasks: tasks.map((t) => ({
          gid: t.gid,
          name: t.name,
          completed: Boolean(t.completed),
          url: safeUrl(t.permalink_url),
          assignee: t.assignee?.name || '',
          item: byGid.has(t.gid) ? { id: byGid.get(t.gid).id, title: byGid.get(t.gid).title, project_id: byGid.get(t.gid).project_id } : null,
        })),
      });
    }),
  );

  // ── A checklist item ↔ an Asana task ────────────────────────────────────

  // { link }: a task's link or ID. Its comments are pulled straight away.
  router.put(
    '/api/items/:id/asana',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      needAsana();
      const item = await loadItem(req.params.id);
      const link = parseAsanaLink(req.body?.link);
      const gid = link.taskGid || link.gid;
      if (!gid) {
        throw new HttpError(400, link.projectGid ? "That's a project link. Open the task in Asana and copy its link." : "That doesn't look like an Asana task link.");
      }
      const { rows: taken } = await db.query('SELECT title FROM checklist_items WHERE asana_task_gid = $1 AND id <> $2', [gid, item.id]);
      if (taken[0]) throw new HttpError(409, `That Asana task already feeds "${taken[0].title}". Unlink it there first.`);
      const task = await fromAsana(() => asana.getTask(gid));
      if (item.asana_task_gid && item.asana_task_gid !== task.gid) {
        await db.query("DELETE FROM item_comments WHERE item_id = $1 AND source = 'asana'", [item.id]);
      }
      await db.query('UPDATE checklist_items SET asana_task_gid = $2, asana_task_name = $3, asana_task_url = $4, updated_at = now() WHERE id = $1', [
        item.id,
        task.gid,
        task.name || '',
        safeUrl(task.permalink_url),
      ]);
      await logActivity(db, {
        entityType: 'project',
        entityId: item.project_id,
        action: 'item_asana_linked',
        changes: { label: item.title, item_id: item.id, asana: task.name },
        userId: req.user.id,
      });
      const run = await pullAsanaComments(db, asana, { trigger: 'manual', userId: req.user.id, itemIds: [item.id] });
      res.json({ asana_task: { gid: task.gid, name: task.name, url: safeUrl(task.permalink_url) }, pulled: run.added ?? 0, error: run.failed?.[0]?.error ?? null });
    }),
  );

  // Unlinking removes the comments copied from the task; they stay in Asana.
  router.delete(
    '/api/items/:id/asana',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const item = await loadItem(req.params.id);
      if (!item.asana_task_gid) return res.json({ ok: true });
      await db.query("DELETE FROM item_comments WHERE item_id = $1 AND source = 'asana'", [item.id]);
      await db.query(
        "UPDATE checklist_items SET asana_task_gid = NULL, asana_task_name = '', asana_task_url = '', asana_pulled_at = NULL, updated_at = now() WHERE id = $1",
        [item.id],
      );
      await logActivity(db, {
        entityType: 'project',
        entityId: item.project_id,
        action: 'item_asana_unlinked',
        changes: { label: item.title, item_id: item.id, asana: item.asana_task_name },
        userId: req.user.id,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
