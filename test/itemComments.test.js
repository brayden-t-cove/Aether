import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDigest } from '../server/lib/digest.js';
import { createNotifier } from '../server/lib/notify.js';
import { timeAgo } from '../client/src/lib/format.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeSlack } from './fake-slack.js';

describe('saying how long ago', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  it('counts minutes, hours and days, then gives the date', () => {
    expect(timeAgo('2026-10-06T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-06T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-10-06T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-10-05T12:00:00Z', now)).toBe('1 day ago');
    expect(timeAgo('2026-10-03T12:00:00Z', now)).toBe('3 days ago');
    expect(timeAgo('2026-09-01T12:00:00Z', now)).toMatch(/2026/);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('updates on checklist items', () => {
  let db, slack, admin, editor, other, viewer, project, item;
  const comments = async (id = item.id) => (await viewer.agent.get(`/api/items/${id}/comments`).expect(200)).body.comments;

  beforeAll(async () => {
    db = await setupDb();
    slack = await startFakeSlack();
    const app = makeApp(db, { slack: { webhookUrl: slack.url, digestHourUtc: 14 }, publicUrl: 'https://aether.test' });
    admin = await signedInAgent(app, db, { email: 'admin@example.com', role: 'admin', name: 'Admin' });
    editor = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' });
    other = await signedInAgent(app, db, { email: 'other@example.com', role: 'editor', name: 'Other' });
    viewer = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' });
    ({ body: { project } } = await editor.agent.post('/api/projects').send({ name: 'Sample launch' }).expect(201));
    ({ body: { item } } = await editor.agent.post(`/api/projects/${project.id}/items`).send({ title: 'Lab booking' }).expect(201));
  });
  afterAll(async () => {
    await slack?.close();
    await db?.end();
  });

  it('saves why a state changed with the change, and tells Slack the reason', async () => {
    const before = slack.messages.length;
    const { body } = await editor.agent.patch(`/api/items/${item.id}`).send({ state: 'blocked', comment: '  Lab has no slot until November  ' }).expect(200);
    expect(body.item.state).toBe('blocked');
    expect(body.comment).toMatchObject({ body: 'Lab has no slot until November', state: 'blocked', state_from: 'not_started', author_name: 'Ed' });
    const msgs = await slack.waitFor(before + 1);
    expect(msgs.at(-1)).toMatch(/Lab booking.* was marked \*Blocked\*.*\n> Lab has no slot until November/s);
  });

  it('changes a state without a note, and ignores a blank one', async () => {
    const { body } = await editor.agent.patch(`/api/items/${item.id}`).send({ state: 'in_progress', comment: '   ' }).expect(200);
    expect(body.comment).toBeNull();
    expect(await comments()).toHaveLength(1);
    await editor.agent.patch(`/api/items/${item.id}`).send({ comment: 'x'.repeat(5001) }).expect(400);
  });

  it('lets editors post updates and everyone read them, oldest first', async () => {
    await viewer.agent.post(`/api/items/${item.id}/comments`).send({ body: 'Hi' }).expect(403);
    await editor.agent.post(`/api/items/${item.id}/comments`).send({ body: ' ' }).expect(400);
    const { body } = await other.agent.post(`/api/items/${item.id}/comments`).send({ body: 'Found a second lab with a slot next week' }).expect(201);
    // A plain update records the state at the time, with no change.
    expect(body.comment).toMatchObject({ state: 'in_progress', state_from: null, author_name: 'Other' });
    expect((await comments()).map((c) => c.body)).toEqual(['Lab has no slot until November', 'Found a second lab with a slot next week']);
    await viewer.agent.get('/api/items/00000000-0000-0000-0000-000000000000/comments').expect(404);
  });

  it('shows the latest update and the count on the project, and on the dashboard for blocked items', async () => {
    const { body } = await viewer.agent.get(`/api/projects/${project.id}`).expect(200);
    const row = body.items.find((i) => i.id === item.id);
    expect(row.comment_count).toBe(2);
    expect(row.latest_comment).toMatchObject({ body: 'Found a second lab with a slot next week', author_name: 'Other', state: 'in_progress', state_from: null });

    await editor.agent.patch(`/api/items/${item.id}`).send({ state: 'blocked', comment: 'Second lab fell through too' }).expect(200);
    const { body: dash } = await viewer.agent.get('/api/dashboard').expect(200);
    expect(dash.blocked.find((i) => i.id === item.id).latest_comment).toMatchObject({ body: 'Second lab fell through too', state_from: 'in_progress' });
    const digest = await buildDigest(db, createNotifier({ slack: { webhookUrl: slack.url }, publicUrl: 'https://aether.test' }));
    expect(digest).toMatch(/Lab booking.*Sample launch: _Second lab fell through too_/);
  });

  it('lets only the writer edit an update, and the writer or an admin delete it', async () => {
    const [first, second] = await comments();
    await other.agent.patch(`/api/comments/${first.id}`).send({ body: 'Rewritten' }).expect(403);
    await editor.agent.patch(`/api/comments/${first.id}`).send({ body: '' }).expect(400);
    const { body } = await editor.agent.patch(`/api/comments/${first.id}`).send({ body: 'Lab has no slot until mid-November' }).expect(200);
    expect(body.comment).toMatchObject({ body: 'Lab has no slot until mid-November', state_from: 'not_started' });
    expect(body.comment.edited_at).toBeTruthy();

    await editor.agent.delete(`/api/comments/${second.id}`).expect(403);
    await admin.agent.delete(`/api/comments/${second.id}`).expect(200);
    await other.agent.delete(`/api/comments/${second.id}`).expect(404);
    expect(await comments()).toHaveLength(2);
    await viewer.agent.patch(`/api/comments/${first.id}`).send({ body: 'x' }).expect(403);
  });

  it('logs every update in the project history', async () => {
    const { rows } = await db.query(
      "SELECT action, changes->>'excerpt' AS excerpt FROM activity_log WHERE entity_id = $1 AND action LIKE 'comment_%' ORDER BY created_at",
      [project.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['comment_added', 'comment_added', 'comment_added', 'comment_edited', 'comment_deleted']);
    expect(rows[0].excerpt).toBe('Lab has no slot until November');
  });

  it('saves a first update written with a new item', async () => {
    const { body } = await editor.agent.post(`/api/projects/${project.id}/items`).send({ title: 'Order adapters', comment: 'Need 200 type G adapters by November' }).expect(201);
    expect(await comments(body.item.id)).toEqual([expect.objectContaining({ body: 'Need 200 type G adapters by November', state: 'not_started', state_from: null, author_name: 'Ed' })]);
    const { body: plain } = await editor.agent.post(`/api/projects/${project.id}/items`).send({ title: 'No note' }).expect(201);
    expect(await comments(plain.item.id)).toEqual([]);
  });

  it('removes an item’s updates with the item', async () => {
    expect((await db.query('SELECT count(*)::int AS n FROM item_comments WHERE item_id = $1', [item.id])).rows[0].n).toBeGreaterThan(0);
    await editor.agent.delete(`/api/items/${item.id}`).expect(200);
    expect((await db.query('SELECT count(*)::int AS n FROM item_comments WHERE item_id = $1', [item.id])).rows[0].n).toBe(0);
  });
});
