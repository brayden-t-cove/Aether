import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin, createUser, findUserByEmail, resolveGoogleUser } from '../server/lib/users.js';
import { makeApp, PASSWORD, setupDb, signedInAgent, testConfig, TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('auth', () => {
  let db, app;
  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
  });
  afterAll(() => db?.end());

  it('reports no user when signed out', async () => {
    const res = await request(app).get('/api/me').expect(200);
    expect(res.body.user).toBeNull();
    expect(res.body.providers).toEqual({ google: false, password: true });
  });

  it('health check reaches the database', async () => {
    await request(app).get('/api/health').expect(200, { ok: true });
  });

  it('protects API routes', async () => {
    await request(app).get('/api/users').expect(401);
    await request(app).get('/api/activity').expect(401);
    await request(app).get('/api/nope').expect(404);
  });

  it('rejects a wrong password without revealing whether the email exists', async () => {
    await createUser(db, { email: 'ann@lunahome.com', password: PASSWORD });
    const wrong = await request(app).post('/auth/local').send({ email: 'ann@lunahome.com', password: 'nope' }).expect(401);
    const missing = await request(app).post('/auth/local').send({ email: 'nobody@lunahome.com', password: 'nope' }).expect(401);
    expect(wrong.body.error).toBe(missing.body.error);
  });

  it('signs in with email and password, then signs out', async () => {
    const { agent } = await signedInAgent(app, db, { email: 'Bea@LunaHome.com', role: 'editor' });
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.user).toMatchObject({ email: 'bea@lunahome.com', role: 'editor', hasPassword: true });
    expect(me.body.user).not.toHaveProperty('password_hash');

    await agent.post('/auth/logout').expect(200);
    expect((await agent.get('/api/me')).body.user).toBeNull();
  });

  it('lets a user change their own password', async () => {
    const { agent } = await signedInAgent(app, db, { email: 'cal@lunahome.com' });
    await agent.post('/api/me/password').send({ currentPassword: 'wrong', newPassword: 'a brand new password' }).expect(400);
    await agent.post('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await agent.post('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'a brand new password' }).expect(200);
    await request(app).post('/auth/local').send({ email: 'cal@lunahome.com', password: 'a brand new password' }).expect(200);
  });

  describe('bootstrap admin password', () => {
    it('creates the admin with a password, or promotes and resets an existing user', async () => {
      expect(await bootstrapAdmin(db, { email: 'first@lunahome.com', password: 'short' })).toBe('password_too_short');
      expect(await findUserByEmail(db, 'first@lunahome.com')).toBeNull();

      expect(await bootstrapAdmin(db, { email: 'First@lunahome.com', password: 'bootstrap password' })).toBe('ok');
      await request(app).post('/auth/local').send({ email: 'first@lunahome.com', password: 'bootstrap password' }).expect(200);

      await db.query(`UPDATE users SET role = 'viewer', active = false WHERE email = 'first@lunahome.com'`);
      expect(await bootstrapAdmin(db, { email: 'first@lunahome.com', password: 'another password' })).toBe('ok');
      const user = await findUserByEmail(db, 'first@lunahome.com');
      expect(user).toMatchObject({ role: 'admin', active: true });
      await request(app).post('/auth/local').send({ email: 'first@lunahome.com', password: 'another password' }).expect(200);
    });

    it('does nothing without both email and password', async () => {
      expect(await bootstrapAdmin(db, { email: '', password: 'bootstrap password' })).toBe('skipped');
    });
  });

  describe('Google sign-in', () => {
    const opts = { adminEmail: testConfig.adminEmail };

    it('refuses people who were not invited', async () => {
      expect(await resolveGoogleUser(db, { email: 'stranger@gmail.com', googleId: 'g1' }, opts)).toBeNull();
    });

    it('links an invited user and keeps their role', async () => {
      await createUser(db, { email: 'dee@lunahome.com', role: 'editor' });
      const user = await resolveGoogleUser(db, { email: 'DEE@lunahome.com', name: 'Dee', googleId: 'g2' }, opts);
      expect(user).toMatchObject({ email: 'dee@lunahome.com', role: 'editor', google_id: 'g2', name: 'Dee' });
    });

    it('refuses a different Google account for an already-linked email', async () => {
      expect(await resolveGoogleUser(db, { email: 'dee@lunahome.com', googleId: 'other' }, opts)).toBeNull();
    });

    it('refuses deactivated users', async () => {
      await createUser(db, { email: 'eve@lunahome.com' });
      await db.query(`UPDATE users SET active = false WHERE email = 'eve@lunahome.com'`);
      expect(await resolveGoogleUser(db, { email: 'eve@lunahome.com', googleId: 'g3' }, opts)).toBeNull();
    });

    it('bootstraps ADMIN_EMAIL as an admin', async () => {
      const user = await resolveGoogleUser(db, { email: 'boss@lunahome.com', name: 'Boss', googleId: 'g4' }, opts);
      expect(user.role).toBe('admin');
    });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('sign-in rate limit', () => {
  it('counts only failed attempts', async () => {
    const db = await setupDb();
    const app = makeApp(db);
    await createUser(db, { email: 'team@lunahome.com', password: PASSWORD });
    for (let i = 0; i < 25; i++) {
      await request(app).post('/auth/local').send({ email: 'team@lunahome.com', password: PASSWORD }).expect(200);
    }
    for (let i = 0; i < 20; i++) await request(app).post('/auth/local').send({ email: 'team@lunahome.com', password: 'wrong' }).expect(401);
    await request(app).post('/auth/local').send({ email: 'team@lunahome.com', password: PASSWORD }).expect(429);
    await db.end();
  }, 60_000); // dozens of real password checks
});
