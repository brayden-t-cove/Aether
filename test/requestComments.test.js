import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeSlack } from './fake-slack.js';

// Comments on a design request: the requester and the designer talk on the request instead of in messages.
describe.skipIf(!TEST_DATABASE_URL)('comments on design requests', () => {
  let db, slack, requester, designer, admin, viewer, request;

  beforeAll(async () => {
    db = await setupDb();
    slack = await startFakeSlack();
    const app = makeApp(db, { slack: { webhookUrl: slack.url }, publicUrl: 'https://aether.test' });
    ({ agent: requester } = await signedInAgent(app, db, { email: 'req@example.com', role: 'editor', name: 'Rae' }));
    ({ agent: designer } = await signedInAgent(app, db, { email: 'des@example.com', role: 'editor', name: 'Dee' }));
    ({ agent: admin } = await signedInAgent(app, db, { email: 'adm@example.com', role: 'admin', name: 'Ada' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    ({ body: { request } } = await requester.post('/api/design-requests').send({ title: 'Hero image for the Porch Cam' }).expect(201));
    await slack.waitFor(1);
  });
  afterAll(async () => {
    await slack?.close();
    await db?.end();
  });

  it('posts comments in order, noting the request’s state, and tells the channel', async () => {
    await viewer.post(`/api/design-requests/${request.id}/comments`).send({ body: 'Hi' }).expect(403);
    await designer.post(`/api/design-requests/${request.id}/comments`).send({ body: '   ' }).expect(400);
    await designer.post(`/api/design-requests/${request.id}/comments`).send({ body: 'Front or three-quarter angle?' }).expect(201);
    await requester.patch(`/api/design-requests/${request.id}`).send({ state: 'delivered' }).expect(200);
    await requester.post(`/api/design-requests/${request.id}/comments`).send({ body: 'Three-quarter. Can the porch light be warmer?' }).expect(201);

    const { body } = await viewer.get(`/api/design-requests/${request.id}/comments`).expect(200);
    expect(body.comments.map((c) => [c.author_name, c.state, c.body])).toEqual([
      ['Dee', 'requested', 'Front or three-quarter angle?'],
      ['Rae', 'delivered', 'Three-quarter. Can the porch light be warmer?'],
    ]);
    const list = await viewer.get('/api/design-requests').expect(200);
    expect(list.body.requests[0].comment_count).toBe(2);

    const sent = await slack.waitFor(4);
    expect(sent.filter((m) => m.includes('💬')).map((m) => m.replace(/^\[test\] /, ''))).toEqual([
      '💬 Dee commented on <https://aether.test/design-requests/' + request.id + '|Hero image for the Porch Cam>\n> Front or three-quarter angle?',
      '💬 Rae commented on <https://aether.test/design-requests/' + request.id + '|Hero image for the Porch Cam>\n> Three-quarter. Can the porch light be warmer?',
    ]);
    const { body: log } = await viewer.get(`/api/design-requests/${request.id}`).expect(200);
    expect(log.activity.filter((a) => a.action === 'comment_added').map((a) => a.changes.excerpt)).toContain('Front or three-quarter angle?');
  });

  it('lets only the writer edit, and the writer or an admin delete', async () => {
    const { body } = await viewer.get(`/api/design-requests/${request.id}/comments`).expect(200);
    const [question, feedback] = body.comments;
    await requester.patch(`/api/request-comments/${question.id}`).send({ body: 'Changed' }).expect(403);
    const edited = await designer.patch(`/api/request-comments/${question.id}`).send({ body: 'Front or three-quarter? Any background?' }).expect(200);
    expect(edited.body.comment).toMatchObject({ body: 'Front or three-quarter? Any background?' });
    expect(edited.body.comment.edited_at).toBeTruthy();
    await designer.patch(`/api/request-comments/${question.id}`).send({ body: '' }).expect(400);

    await designer.delete(`/api/request-comments/${feedback.id}`).expect(403);
    await admin.delete(`/api/request-comments/${feedback.id}`).expect(200);
    await designer.delete(`/api/request-comments/${question.id}`).expect(200);
    await designer.delete(`/api/request-comments/${question.id}`).expect(404);
    expect((await viewer.get(`/api/design-requests/${request.id}/comments`).expect(200)).body.comments).toEqual([]);
  });

  it('goes with the request when it is deleted', async () => {
    await designer.post(`/api/design-requests/${request.id}/comments`).send({ body: 'Last one' }).expect(201);
    await requester.delete(`/api/design-requests/${request.id}`).expect(200);
    await viewer.get(`/api/design-requests/${request.id}/comments`).expect(404);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM request_comments');
    expect(rows[0].n).toBe(0);
  });
});
