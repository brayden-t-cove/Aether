import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import { isUuid } from '../lib/validate.js';
import { createItem, getItem } from '../lib/items.js';
import { withTransaction } from '../lib/db.js';
import { sectionOf, stateFromTask, suggestMatches } from '../lib/asanaTasks.js';
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
      const message = run.items
        ? `${plural(run.added, 'new comment')} from ${plural(run.items, 'linked task')}${run.error ? `. ${run.error}` : ''}`
        : 'No checklist items are linked to Asana tasks yet. Use "Asana tasks" on the project page to link them or add them as items.';
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

  /** The linked project's tasks, each with its column, the item it feeds, or a suggested item to match it to. */
  async function projectTasks(project) {
    const tasks = await fromAsana(() => asana.listProjectTasks(project.asana_project_gid));
    const { rows: linked } = await db.query(
      'SELECT id, title, project_id, asana_task_gid FROM checklist_items WHERE asana_task_gid = ANY($1::text[])',
      [tasks.map((t) => t.gid)],
    );
    const byGid = new Map(linked.map((i) => [i.asana_task_gid, i]));
    const { rows: free } = await db.query('SELECT id, title FROM checklist_items WHERE project_id = $1 AND asana_task_gid IS NULL ORDER BY position', [project.id]);
    const suggested = suggestMatches(tasks.filter((t) => !byGid.has(t.gid)), free);
    return tasks.map((t) => {
      const section = sectionOf(t, project.asana_project_gid);
      const item = byGid.get(t.gid);
      return {
        gid: t.gid,
        name: t.name,
        completed: Boolean(t.completed),
        section,
        state: stateFromTask(t, section),
        due_on: t.due_on || null,
        url: safeUrl(t.permalink_url),
        assignee: t.assignee?.name || '',
        assignee_email: t.assignee?.email || '',
        item: item ? { id: item.id, title: item.title, project_id: item.project_id } : null,
        suggested: suggested.has(t.gid) ? { id: suggested.get(t.gid).id, title: suggested.get(t.gid).title } : null,
      };
    });
  }

  router.get(
    '/api/projects/:id/asana/tasks',
    requireAuth,
    asyncHandler(async (req, res) => {
      needAsana();
      const project = await loadProject(req.params.id);
      if (!project.asana_project_gid) return res.json({ tasks: [] });
      res.json({ tasks: await projectTasks(project) });
    }),
  );

  /**
   * Bring tasks into the checklist in one go. { links: [{ task, item_id }] }: with item_id, link the task to that
   * item; with item_id null, add the task as a new item (its state from its column, due date, and owner by email)
   * linked to it. Then pull their comments. Tasks already linked, or not in this Asana project, are skipped.
   */
  router.post(
    '/api/projects/:id/asana/apply',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      needAsana();
      const project = await loadProject(req.params.id);
      if (!project.asana_project_gid) throw new HttpError(400, 'Link this project to its Asana project first');
      const links = Array.isArray(req.body?.links) ? req.body.links : [];
      if (!links.length || links.length > 500) throw new HttpError(400, 'Say which tasks to bring in');
      for (const l of links) {
        if (typeof l?.task !== 'string' || !/^\d+$/.test(l.task) || (l.item_id != null && !isUuid(l.item_id))) throw new HttpError(400, 'Each link needs a task, and an item or null');
      }

      const tasks = new Map((await projectTasks(project)).map((t) => [t.gid, t]));
      const { rows: stages } = await db.query("SELECT 1 FROM checklist_items WHERE project_id = $1 AND stage <> '' LIMIT 1", [project.id]);
      const { rows: users } = await db.query('SELECT id, lower(email) AS email FROM users WHERE active');
      const userByEmail = new Map(users.map((u) => [u.email, u.id]));

      const done = await withTransaction(db, async (tx) => {
        const result = { linked: 0, added: 0, skipped: [], itemIds: [] };
        const usedItems = new Set();
        for (const { task: gid, item_id: itemId } of links) {
          const t = tasks.get(gid);
          if (!t) {
            result.skipped.push({ task: gid, reason: 'Not in the linked Asana project' });
            continue;
          }
          if (t.item) {
            result.skipped.push({ task: gid, reason: `Already feeds "${t.item.title}"` });
            continue;
          }
          let id = itemId;
          if (id) {
            const { rows } = await tx.query('SELECT id, asana_task_gid FROM checklist_items WHERE id = $1 AND project_id = $2', [id, project.id]);
            if (!rows[0] || rows[0].asana_task_gid || usedItems.has(id)) {
              result.skipped.push({ task: gid, reason: rows[0] ? 'That item already has a task' : 'That item is not in this project' });
              continue;
            }
            result.linked++;
          } else {
            const item = await createItem(
              tx,
              project.id,
              {
                title: t.name.trim().slice(0, 300) || 'Asana task',
                state: t.state,
                due_date: t.due_on,
                owner_id: userByEmail.get(t.assignee_email.toLowerCase()) ?? null,
                stage: stages.length ? 'From Asana' : '',
              },
              req.user.id,
            );
            id = item.id;
            result.added++;
          }
          usedItems.add(id);
          await tx.query('UPDATE checklist_items SET asana_task_gid = $2, asana_task_name = $3, asana_task_url = $4, updated_at = now() WHERE id = $1', [id, gid, t.name, t.url]);
          result.itemIds.push(id);
        }
        if (result.itemIds.length) {
          await logActivity(tx, {
            entityType: 'project',
            entityId: project.id,
            action: 'asana_tasks_applied',
            changes: { label: project.name, linked: result.linked, added: result.added },
            userId: req.user.id,
          });
        }
        return result;
      });

      const run = done.itemIds.length ? await pullAsanaComments(db, asana, { trigger: 'manual', userId: req.user.id, itemIds: done.itemIds }) : {};
      res.json({ linked: done.linked, added: done.added, skipped: done.skipped, pulled: run.added ?? 0, error: run.error ?? null });
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
