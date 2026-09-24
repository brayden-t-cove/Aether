import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurePassport } from './auth/passport.js';
import { errorHandler } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { activityRoutes } from './routes/activity.js';
import { productRoutes } from './routes/products.js';
import { marketRoutes } from './routes/markets.js';
import { projectRoutes } from './routes/projects.js';
import { dashboardRoutes } from './routes/dashboard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIST = join(ROOT, 'client', 'dist');
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Build the Express app. `db` is a pg Pool. Kept separate from index.js so
 * tests can create an app against a test database.
 */
export function createApp({ db, config }) {
  const app = express();
  const passport = configurePassport(db, config);
  const PgSession = connectPgSimple(session);

  app.set('trust proxy', 1); // Railway terminates TLS at its proxy
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });

  app.get('/api/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'aether.sid',
      store: new PgSession({ pool: db, tableName: 'user_sessions' }),
      secret: config.sessionSecret || 'dev-only-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.use(authRoutes({ db, config, passport }));
  app.use(userRoutes({ db }));
  app.use(activityRoutes({ db }));
  app.use(productRoutes({ db }));
  app.use(marketRoutes({ db }));
  app.use(projectRoutes({ db }));
  app.use(dashboardRoutes({ db }));

  app.use(['/api', '/auth'], (req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the server also serves the built React app.
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(join(CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
