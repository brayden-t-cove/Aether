import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth } from '../auth/middleware.js';
import { publicUser, recordLogin, setPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../lib/users.js';
import { logActivity } from '../lib/activity.js';

export function authRoutes({ db, config, passport }) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
  });

  const logIn = (req, user) =>
    new Promise((resolve, reject) => req.logIn(user, (err) => (err ? reject(err) : resolve())));

  router.get('/api/me', (req, res) => {
    res.json({
      user: req.isAuthenticated() ? publicUser(req.user) : null,
      providers: { google: config.google.enabled, password: true },
    });
  });

  router.post('/auth/local', loginLimiter, (req, res, next) => {
    passport.authenticate('local', async (err, user, info) => {
      try {
        if (err) throw err;
        if (!user) throw new HttpError(401, info?.message || 'Invalid email or password');
        await logIn(req, user);
        await recordLogin(db, user.id);
        res.json({ user: publicUser(user) });
      } catch (e) {
        next(e);
      }
    })(req, res, next);
  });

  if (config.google.enabled) {
    router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));
    router.get('/auth/google/callback', (req, res, next) => {
      passport.authenticate('google', async (err, user, info) => {
        try {
          if (err) throw err;
          if (!user) return res.redirect(`/login?error=${encodeURIComponent(info?.message || 'google_failed')}`);
          await logIn(req, user);
          await recordLogin(db, user.id);
          res.redirect('/');
        } catch (e) {
          next(e);
        }
      })(req, res, next);
    });
  } else {
    router.get('/auth/google', (req, res) => res.redirect('/login?error=google_not_configured'));
  }

  router.post('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('aether.sid');
        res.json({ ok: true });
      });
    });
  });

  router.post(
    '/api/me/password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body || {};
      if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      // Users who only ever signed in with Google can set a first password without one.
      if (req.user.password_hash && !(await verifyPassword(req.user, currentPassword))) {
        throw new HttpError(400, 'Current password is incorrect');
      }
      await setPassword(db, req.user.id, newPassword);
      await logActivity(db, { entityType: 'user', entityId: req.user.id, action: 'password_changed', userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  return router;
}
