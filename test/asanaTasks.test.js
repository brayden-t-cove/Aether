import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeAsana } from './fake-asana.js';
import { similarity, stateFromTask, suggestMatches } from '../server/lib/asanaTasks.js';

describe('matching Asana tasks to checklist items', () => {
  it('reads the state from the board column, and done from completed', () => {
    expect(stateFromTask({ completed: true }, 'In progress')).toBe('done');
    expect(stateFromTask({}, 'In Progress')).toBe('in_progress');
    expect(stateFromTask({}, 'Blocked / waiting on vendor')).toBe('blocked');
    expect(stateFromTask({}, 'Needs review')).toBe('in_review');
    expect(stateFromTask({}, 'To do')).toBe('not_started');
    expect(stateFromTask({}, '')).toBe('not_started');
  });

  it('suggests the closest item by shared words, each item at most once', () => {
    expect(similarity('Book UKCA testing', 'UKCA testing')).toBeCloseTo(2 / 3);
    expect(similarity('', 'UKCA testing')).toBe(0);
    const tasks = [
      { gid: '1', name: 'FCC certification' },
      { gid: '2', name: 'FCC certification for the doorbell' },
      { gid: '3', name: 'Something else' },
    ];
    const items = [{ id: 'a', title: 'FCC certification' }];
    const out = suggestMatches(tasks, items);
    expect([...out.entries()].map(([g, i]) => [g, i.id])).toEqual([['1', 'a']]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('bringing an Asana project’s tasks into the checklist', () => {
  let db, fake, editor, viewer, pat, project, items;

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeAsana();
    const app = makeApp(db, { asana: { token: fake.token, apiUrl: fake.url } });
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    ({ user: pat } = await signedInAgent(app, db, { email: 'pat@example.com', role: 'editor', name: 'Pat' }));
    ({ rows: [project] } = await db.query("INSERT INTO projects (name) VALUES ('Sample Cam UK') RETURNING *"));
    ({ rows: items } = await db.query(
      "INSERT INTO checklist_items (project_id, title, position) VALUES ($1, 'UKCA testing', 0), ($1, 'Manual translation', 1) RETURNING id, title",
      [project.id],
    ));
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('needs the project linked first', async () => {
    await editor.post(`/api/projects/${project.id}/asana/apply`).send({ links: [{ task: '2001', item_id: null }] }).expect(400);
    await editor.put(`/api/projects/${project.id}/asana`).send({ link: 'https://app.asana.com/0/1001/list' }).expect(200);
  });

  it('lists every task with its column, the state it maps to, and a suggested item where the names match', async () => {
    const { body } = await viewer.get(`/api/projects/${project.id}/asana/tasks`).expect(200);
    expect(body.tasks.map((t) => [t.name, t.section, t.state, t.due_on, t.assignee, t.suggested?.title ?? null])).toEqual([
      ['Book UKCA testing', 'In progress', 'in_progress', '2026-10-20', 'Pat Expansion', 'UKCA testing'],
      ['Translate the manual', 'To do', 'not_started', null, '', null],
      ['Order UK plugs', 'Done', 'done', null, '', null],
    ]);
  });

  it('links matched tasks and adds the rest as items in one go, then pulls their comments', async () => {
    const links = [
      { task: '2001', item_id: items[0].id },
      { task: '2002', item_id: items[1].id },
      { task: '2003', item_id: null },
    ];
    await viewer.post(`/api/projects/${project.id}/asana/apply`).send({ links }).expect(403);
    await editor.post(`/api/projects/${project.id}/asana/apply`).send({ links: [{ task: 'x' }] }).expect(400);
    const { body } = await editor.post(`/api/projects/${project.id}/asana/apply`).send({ links }).expect(200);
    expect(body).toMatchObject({ linked: 2, added: 1, skipped: [], pulled: 3 });

    const { rows } = await db.query(
      `SELECT title, state, asana_task_gid, completed_at IS NOT NULL AS completed,
              (SELECT count(*)::int FROM item_comments c WHERE c.item_id = i.id AND c.source = 'asana') AS comments
         FROM checklist_items i WHERE project_id = $1 ORDER BY position`,
      [project.id],
    );
    expect(rows).toEqual([
      { title: 'UKCA testing', state: 'not_started', asana_task_gid: '2001', completed: false, comments: 2 },
      { title: 'Manual translation', state: 'not_started', asana_task_gid: '2002', completed: false, comments: 0 },
      { title: 'Order UK plugs', state: 'done', asana_task_gid: '2003', completed: true, comments: 1 },
    ]);
    const { body: p } = await viewer.get(`/api/projects/${project.id}`).expect(200);
    expect(p.activity.find((a) => a.action === 'asana_tasks_applied')).toMatchObject({ action: 'asana_tasks_applied', changes: { linked: 2, added: 1 } });

    // Applying again changes nothing.
    const again = await editor.post(`/api/projects/${project.id}/asana/apply`).send({ links }).expect(200);
    expect(again.body).toMatchObject({ linked: 0, added: 0 });
    expect(again.body.skipped.map((s) => s.reason)).toEqual(['Already feeds "UKCA testing"', 'Already feeds "Manual translation"', 'Already feeds "Order UK plugs"']);
  });

  it('gives a new item its due date and an owner matched by email, in a "From Asana" stage when the checklist uses stages', async () => {
    await editor.delete(`/api/items/${items[0].id}/asana`).expect(200);
    await db.query("UPDATE checklist_items SET stage = 'Testing' WHERE id = $1", [items[0].id]);
    const { body } = await editor.post(`/api/projects/${project.id}/asana/apply`).send({ links: [{ task: '2001', item_id: null }] }).expect(200);
    expect(body).toMatchObject({ added: 1, pulled: 2 });
    const { rows } = await db.query("SELECT title, state, stage, due_date::text, owner_id FROM checklist_items WHERE asana_task_gid = '2001'");
    expect(rows[0]).toEqual({ title: 'Book UKCA testing', state: 'in_progress', stage: 'From Asana', due_date: '2026-10-20', owner_id: pat.id });
  });

  it('says what to do when Pull finds nothing linked', async () => {
    const { rows: [other] } = await db.query("INSERT INTO projects (name) VALUES ('Nothing linked') RETURNING id");
    const { body } = await editor.post('/api/asana/pull').send({ project_id: other.id }).expect(200);
    expect(body.message).toMatch(/No checklist items are linked to Asana tasks yet/);
  });
});
