import { Router } from 'express';
import { ROLES, TEAMS } from '../../shared/roles.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logActivity } from '../lib/activity.js';
import {
  createUser,
  findUserById,
  getUserWithTeams,
  listUsers,
  setUserTeams,
  normalizeEmail,
  publicUser,
  setPassword,
  updateUser,
  MIN_PASSWORD_LENGTH,
} from '../lib/users.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateFields(body, { creating }) {
  const out = {};
  if (creating || 'email' in body) {
    const email = normalizeEmail(body.email);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    out.email = email;
  }
  if ('name' in body) {
    if (typeof body.name !== 'string') throw new HttpError(400, 'Name must be text');
    out.name = body.name.trim();
  }
  if ('role' in body) {
    if (!ROLES.includes(body.role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    out.role = body.role;
  }
  // Teams: a list (people wear several hats). A single `team` is still accepted and means just that one.
  if ('teams' in body || 'team' in body) {
    const teams = 'teams' in body ? body.teams : body.team === null ? [] : [body.team];
    if (!Array.isArray(teams) || teams.some((t) => !Object.hasOwn(TEAMS, t))) throw new HttpError(400, 'Unknown team');
    out.teams = [...new Set(teams)];
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'Active must be true or false');
    out.active = body.active;
  }
  if (body.password !== undefined && body.password !== '') {
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    out.password = body.password;
  }
  return out;
}

export function userRoutes({ db }) {
  const router = Router();

  // Everyone can see the team list (needed for owner pickers).
  router.get(
    '/api/users',
    requireAuth,
    asyncHandler(async (req, res) => {
      const users = (await listUsers(db)).map(publicUser);
      res.json({ users });
    }),
  );

  // Admin: invite a user. They can then sign in with Google using this email,
  // or with the password set here.
  router.post(
    '/api/admin/users',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { teams = [], ...fields } = validateFields(req.body || {}, { creating: true });
      const created = await createUser(db, { ...fields, invitedBy: req.user.id });
      await setUserTeams(db, created.id, teams);
      const user = await getUserWithTeams(db, created.id);
      await logActivity(db, {
        entityType: 'user',
        entityId: user.id,
        action: 'invited',
        changes: { email: user.email, role: user.role, teams: user.teams },
        userId: req.user.id,
      });
      res.status(201).json({ user: publicUser(user) });
    }),
  );

  router.patch(
    '/api/admin/users/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { email: _email, password: _password, teams, ...fields } = validateFields(req.body || {}, { creating: false });
      const existing = await getUserWithTeams(db, req.params.id);
      if (!existing) throw new HttpError(404, 'User not found');

      // Guard against an admin locking themselves out.
      if (existing.id === req.user.id && ((fields.role && fields.role !== 'admin') || fields.active === false)) {
        throw new HttpError(400, 'You cannot remove your own admin access');
      }

      await updateUser(db, existing.id, fields);
      const changes = {};
      for (const [key, value] of Object.entries(fields)) {
        if (existing[key] !== value) changes[key] = { from: existing[key], to: value };
      }
      if (teams && [...teams].sort().join() !== existing.teams.join()) {
        await setUserTeams(db, existing.id, teams);
        changes.teams = { from: existing.teams, to: teams };
      }
      const updated = await getUserWithTeams(db, existing.id);
      if (Object.keys(changes).length) {
        await logActivity(db, { entityType: 'user', entityId: existing.id, action: 'updated', changes, userId: req.user.id });
      }
      res.json({ user: publicUser(updated) });
    }),
  );

  router.post(
    '/api/admin/users/:id/password',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { password } = validateFields({ password: req.body?.password ?? null }, { creating: false });
      if (!password) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      const user = await findUserById(db, req.params.id);
      if (!user) throw new HttpError(404, 'User not found');
      await setPassword(db, user.id, password);
      await logActivity(db, { entityType: 'user', entityId: user.id, action: 'password_reset', userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  return router;
}
