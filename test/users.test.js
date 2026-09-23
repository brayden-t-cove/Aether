import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, PASSWORD, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('user administration', () => {
  let db, app, admin, viewer;
  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    viewer = await signedInAgent(app, db, { email: 'viewer@lunahome.com', role: 'viewer' });
  });
  afterAll(() => db?.end());

  it('lets anyone signed in list users', async () => {
    const res = await viewer.agent.get('/api/users').expect(200);
    expect(res.body.users.map((u) => u.email)).toEqual(expect.arrayContaining(['admin@lunahome.com', 'viewer@lunahome.com']));
  });

  it('only lets admins invite', async () => {
    await viewer.agent.post('/api/admin/users').send({ email: 'x@lunahome.com' }).expect(403);
  });

  it('invites a user, validates input and logs the change', async () => {
    await admin.agent.post('/api/admin/users').send({ email: 'not-an-email' }).expect(400);
    await admin.agent.post('/api/admin/users').send({ email: 'a@lunahome.com', role: 'owner' }).expect(400);
    await admin.agent.post('/api/admin/users').send({ email: 'a@lunahome.com', team: 'marketing' }).expect(400);

    const res = await admin.agent
      .post('/api/admin/users')
      .send({ email: 'Intl@LunaHome.com', name: 'Intl', role: 'editor', team: 'international' })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: 'intl@lunahome.com', role: 'editor', team: 'international', hasPassword: false });

    await admin.agent.post('/api/admin/users').send({ email: 'intl@lunahome.com' }).expect(409);

    const { body } = await admin.agent.get(`/api/activity?entityType=user&entityId=${res.body.user.id}`).expect(200);
    expect(body.activity[0]).toMatchObject({ action: 'invited', user_name: 'Admin' });
  });

  it('updates role and team, recording before and after', async () => {
    const { body: created } = await admin.agent.post('/api/admin/users').send({ email: 'des@lunahome.com' }).expect(201);
    const { body } = await admin.agent
      .patch(`/api/admin/users/${created.user.id}`)
      .send({ role: 'editor', team: 'design' })
      .expect(200);
    expect(body.user).toMatchObject({ role: 'editor', team: 'design' });

    const { body: log } = await admin.agent.get(`/api/activity?entityType=user&entityId=${created.user.id}`);
    expect(log.activity[0].changes).toEqual({ role: { from: 'viewer', to: 'editor' }, team: { from: null, to: 'design' } });
  });

  it('stops admins from removing their own admin access', async () => {
    await admin.agent.patch(`/api/admin/users/${admin.user.id}`).send({ role: 'editor' }).expect(400);
    await admin.agent.patch(`/api/admin/users/${admin.user.id}`).send({ active: false }).expect(400);
    await admin.agent.patch(`/api/admin/users/${admin.user.id}`).send({ name: 'Still Admin' }).expect(200);
  });

  it('signs out a user as soon as they are deactivated', async () => {
    const target = await signedInAgent(app, db, { email: 'leaving@lunahome.com' });
    await target.agent.get('/api/users').expect(200);
    await admin.agent.patch(`/api/admin/users/${target.user.id}`).send({ active: false }).expect(200);
    await target.agent.get('/api/users').expect(401);
    await request(app).post('/auth/local').send({ email: 'leaving@lunahome.com', password: PASSWORD }).expect(401);
  });

  it('lets admins set a password', async () => {
    const { body } = await admin.agent.post('/api/admin/users').send({ email: 'ecom@lunahome.com' }).expect(201);
    await admin.agent.post(`/api/admin/users/${body.user.id}/password`).send({ password: 'short' }).expect(400);
    await admin.agent.post(`/api/admin/users/${body.user.id}/password`).send({ password: 'long enough password' }).expect(200);
    await request(app).post('/auth/local').send({ email: 'ecom@lunahome.com', password: 'long enough password' }).expect(200);
    await viewer.agent.post(`/api/admin/users/${body.user.id}/password`).send({ password: 'long enough password' }).expect(403);
  });

  it('returns 404 for unknown users', async () => {
    await admin.agent.patch('/api/admin/users/00000000-0000-0000-0000-000000000000').send({ name: 'x' }).expect(404);
    await admin.agent.patch('/api/admin/users/not-a-uuid').send({ name: 'x' }).expect(404);
  });
});
