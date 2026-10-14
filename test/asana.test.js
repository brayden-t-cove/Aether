import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeAsana } from './fake-asana.js';
import { parseAsanaLink } from '../server/lib/asana.js';
import { pullAsanaComments } from '../server/lib/asanaSync.js';
import { createAsanaClient } from '../server/lib/asana.js';

describe('reading Asana links', () => {
  it('finds the project and task in both link styles, and takes a bare ID', () => {
    expect(parseAsanaLink('https://app.asana.com/0/1001/list')).toEqual({ projectGid: '1001' });
    expect(parseAsanaLink('https://app.asana.com/0/1001/2001')).toEqual({ projectGid: '1001', taskGid: '2001' });
    expect(parseAsanaLink('https://app.asana.com/0/1001/2001/f')).toEqual({ projectGid: '1001', taskGid: '2001' });
    expect(parseAsanaLink('https://app.asana.com/0/0/2001')).toEqual({ taskGid: '2001' });
    expect(parseAsanaLink('https://app.asana.com/1/9999/project/1001/list/5555')).toEqual({ projectGid: '1001' });
    expect(parseAsanaLink('https://app.asana.com/1/9999/project/1001/task/2001?focus=true')).toEqual({ projectGid: '1001', taskGid: '2001' });
    expect(parseAsanaLink('https://app.asana.com/1/9999/task/2001')).toEqual({ taskGid: '2001' });
    expect(parseAsanaLink(' 2001 ')).toEqual({ gid: '2001' });
    expect(parseAsanaLink('https://example.com/0/1001/2001')).toEqual({});
    expect(parseAsanaLink('not a link')).toEqual({});
  });
});

describe.skipIf(!TEST_DATABASE_URL)('Asana, read-only', () => {
  let db, fake, client, editor, viewer, admin, pat, project, items;
  const comments = async (itemId) =>
    (await viewer.get(`/api/items/${itemId}/comments`).expect(200)).body.comments.map((c) => ({ author: c.author_name, body: c.body, source: c.source, mine: c.created_by === pat.id }));

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeAsana();
    client = createAsanaClient({ token: fake.token, apiUrl: fake.url });
    const app = makeApp(db, { asana: { token: fake.token, apiUrl: fake.url } });
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    ({ agent: admin } = await signedInAgent(app, db, { email: 'boss@example.com', role: 'admin' }));
    // The Asana commenter with an Aether account (same email, different case).
    ({ user: pat } = await signedInAgent(app, db, { email: 'Pat@Example.com', role: 'editor', name: 'Pat P.' }));
    ({ rows: [project] } = await db.query("INSERT INTO projects (name) VALUES ('Sample Cam UK') RETURNING *"));
    ({ rows: items } = await db.query(
      "INSERT INTO checklist_items (project_id, title, position, state) VALUES ($1, 'UKCA testing', 0, 'in_progress'), ($1, 'Manual translation', 1, 'not_started') RETURNING *",
      [project.id],
    ));
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('says when Asana is not connected', async () => {
    const plain = makeApp(db);
    const { agent } = await signedInAgent(plain, db, { email: 'other@example.com', role: 'editor' });
    expect((await agent.get('/api/asana/status').expect(200)).body).toMatchObject({ configured: false });
    await agent.put(`/api/projects/${project.id}/asana`).send({ link: 'https://app.asana.com/0/1001/list' }).expect(503);
    expect(await pullAsanaComments(db, null)).toEqual({ skipped: true, reason: 'not_configured' });
  });

  it('links a project to its Asana project from a link, and lists its tasks', async () => {
    await viewer.put(`/api/projects/${project.id}/asana`).send({ link: 'https://app.asana.com/0/1001/list' }).expect(403);
    const bad = await editor.put(`/api/projects/${project.id}/asana`).send({ link: 'https://example.com/x' }).expect(400);
    expect(bad.body.error).toMatch(/doesn't look like an Asana project link/);
    const missing = await editor.put(`/api/projects/${project.id}/asana`).send({ link: 'https://app.asana.com/0/9999/list' }).expect(400);
    expect(missing.body.error).toMatch(/couldn't find that project/);

    const { body } = await editor.put(`/api/projects/${project.id}/asana`).send({ link: 'https://app.asana.com/1/77/project/1001/list/88' }).expect(200);
    expect(body.asana_project).toMatchObject({ gid: '1001', name: 'Sample Cam · UK launch' });
    const { body: p } = await viewer.get(`/api/projects/${project.id}`).expect(200);
    expect(p.project).toMatchObject({ asana_project_gid: '1001', asana_project_name: 'Sample Cam · UK launch' });

    // Three tasks across two pages.
    const { body: t } = await viewer.get(`/api/projects/${project.id}/asana/tasks`).expect(200);
    expect(t.tasks.map((x) => [x.name, x.completed, x.item])).toEqual([
      ['Book UKCA testing', false, null],
      ['Translate the manual', false, null],
      ['Order UK plugs', true, null],
    ]);
  });

  it('links an item to a task and pulls its comments straight away: comments only, writers matched by email', async () => {
    await viewer.put(`/api/items/${items[0].id}/asana`).send({ link: '2001' }).expect(403);
    const projectLink = await editor.put(`/api/items/${items[0].id}/asana`).send({ link: 'https://app.asana.com/0/1001/list' }).expect(400);
    expect(projectLink.body.error).toMatch(/That's a project link/);

    const { body } = await editor.put(`/api/items/${items[0].id}/asana`).send({ link: 'https://app.asana.com/0/1001/2001/f' }).expect(200);
    expect(body).toMatchObject({ asana_task: { gid: '2001', name: 'Book UKCA testing' }, pulled: 2, error: null });
    expect(await comments(items[0].id)).toEqual([
      { author: 'Pat P.', body: 'Asked two labs for quotes.', source: 'asana', mine: true },
      { author: 'Sam Outside', body: 'Lab B can start on the 20th.', source: 'asana', mine: false },
    ]);
    // Written in Asana when they were, and shown as the item's latest update.
    const { rows } = await db.query("SELECT created_at, state FROM item_comments WHERE external_id = '3001'");
    expect(rows[0]).toEqual({ created_at: new Date('2026-10-01T15:00:00Z'), state: 'in_progress' });
    const { body: p } = await viewer.get(`/api/projects/${project.id}`).expect(200);
    const row = p.items.find((i) => i.id === items[0].id);
    expect(row).toMatchObject({ asana_task_name: 'Book UKCA testing', comment_count: 2 });
    expect(row.latest_comment).toMatchObject({ author_name: 'Sam Outside', source: 'asana' });

    // A task feeds one item.
    const taken = await editor.put(`/api/items/${items[1].id}/asana`).send({ link: '2001' }).expect(409);
    expect(taken.body.error).toMatch(/already feeds "UKCA testing"/);
    const { body: t } = await viewer.get(`/api/projects/${project.id}/asana/tasks`).expect(200);
    expect(t.tasks[0].item).toMatchObject({ id: items[0].id, title: 'UKCA testing' });
  });

  it("doesn't let Asana comments be edited or deleted in Aether, even by their writer", async () => {
    const { rows } = await db.query("SELECT id FROM item_comments WHERE external_id = '3001'");
    await editor.patch(`/api/comments/${rows[0].id}`).send({ body: 'x' }).expect(403);
    await admin.delete(`/api/comments/${rows[0].id}`).expect(403);
  });

  it('follows Asana on the next pull: new comments added once, edits copied, deleted ones removed', async () => {
    const stories = fake.data.tasks['2001'].stories;
    stories[0].text = 'Asked three labs for quotes.';
    stories.splice(2, 1);
    stories.push({ gid: '3004', resource_subtype: 'comment_added', text: 'Booked with Lab A.', created_at: '2026-10-05T15:00:00Z', created_by: { name: 'Pat Expansion', email: 'pat@example.com' } });

    const { body } = await editor.post('/api/asana/pull').send({ project_id: project.id }).expect(200);
    expect(body.run).toMatchObject({ ok: true, added: 1, updated: 1, removed: 1, items: 1, comments_synced: 1 });
    expect((await comments(items[0].id)).map((c) => c.body)).toEqual(['Asked three labs for quotes.', 'Booked with Lab A.']);
    const { rows } = await db.query("SELECT edited_at FROM item_comments WHERE external_id = '3001'");
    expect(rows[0].edited_at).toBeTruthy();

    // Nothing new: nothing changes.
    const again = await pullAsanaComments(db, client, { trigger: 'schedule' });
    expect(again).toMatchObject({ ok: true, added: 0, updated: 0, removed: 0 });
    const { body: log } = await viewer.get(`/api/projects/${project.id}`).expect(200);
    expect(log.activity.filter((a) => a.action === 'asana_comments').map((a) => a.changes.count)).toEqual([1, 2]);
  });

  it('skips a task it can no longer see, still pulling the others, and says which', async () => {
    await editor.put(`/api/items/${items[1].id}/asana`).send({ link: '2002' }).expect(200);
    delete fake.data.tasks['2002'];
    fake.data.tasks['2001'].stories.push({ gid: '3005', resource_subtype: 'comment_added', text: 'Invoice paid.', created_at: '2026-10-06T15:00:00Z', created_by: { name: 'Pat Expansion', email: 'pat@example.com' } });
    const run = await pullAsanaComments(db, client);
    expect(run).toMatchObject({ ok: false, added: 1 });
    expect(run.error).toMatch(/1 linked task couldn't be read: Manual translation: Asana couldn't find that task/);

    const { body } = await admin.get('/api/admin/integrations').expect(200);
    expect(body.asana).toMatchObject({ configured: true, linked: { projects: 1, items: 2 } });
    expect(body.asana.runs[0]).toMatchObject({ ok: false, comments_synced: 1 });
  });

  it('stops the whole pull when Asana refuses the token', async () => {
    const wrong = createAsanaClient({ token: 'wrong', apiUrl: fake.url });
    const run = await pullAsanaComments(db, wrong);
    expect(run).toMatchObject({ ok: false, error: 'Asana refused the token (check ASANA_TOKEN)' });
  });

  it('unlinking an item removes the copied comments; unlinking the project keeps item links', async () => {
    await editor.delete(`/api/items/${items[0].id}/asana`).expect(200);
    expect(await comments(items[0].id)).toEqual([]);
    await editor.delete(`/api/projects/${project.id}/asana`).expect(200);
    const { rows } = await db.query('SELECT asana_task_gid FROM checklist_items WHERE project_id = $1 ORDER BY position', [project.id]);
    expect(rows.map((r) => r.asana_task_gid)).toEqual([null, '2002']);
    const { body } = await viewer.get(`/api/projects/${project.id}/asana/tasks`).expect(200);
    expect(body.tasks).toEqual([]);
  });
});
