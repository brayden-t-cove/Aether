import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireRole } from '../auth/middleware.js';
import { lastSyncRuns } from '../lib/sync.js';
import { maybeSendDigest } from '../lib/digest.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** Admin view of what's connected, with test buttons. Never returns secrets. */
export function integrationRoutes({ db, config, odyssey, notify, files }) {
  const router = Router();

  router.get(
    '/api/admin/integrations',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const [sync, digest, migrations] = await Promise.all([
        lastSyncRuns(db, 5),
        db.query(`SELECT value, updated_at FROM job_state WHERE key = 'slack_digest_last_date'`),
        db.query('SELECT name, applied_at FROM schema_migrations ORDER BY version'),
      ]);
      res.json({
        app: { env: config.appEnv, version, publicUrl: config.publicUrl, googleSignIn: config.google.enabled },
        odyssey: { configured: Boolean(odyssey), url: odyssey?.url ?? null, syncMinutes: config.odyssey.syncMinutes, ...sync },
        slack: { configured: notify.enabled, digestHourUtc: config.slack.digestHourUtc, lastDigestDate: digest.rows[0]?.value ?? null },
        uploads: { enabled: Boolean(files), maxUploadMb: config.maxUploadMb },
        database: { migrations: migrations.rows },
      });
    }),
  );

  router.post(
    '/api/admin/integrations/slack-test',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      try {
        await notify.sendNow(`👋 Test message from Aether, sent by ${notify.esc(req.user.name || req.user.email)}. Notifications are working.`);
      } catch (err) {
        throw new HttpError(notify.enabled ? 502 : 503, err.message);
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/admin/integrations/digest',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      if (!notify.enabled) throw new HttpError(503, 'Slack is not set up (SLACK_WEBHOOK_URL)');
      let sent;
      try {
        sent = await maybeSendDigest(db, notify, { force: true });
      } catch (err) {
        throw new HttpError(502, err.message);
      }
      res.json({ sent, message: sent ? 'Digest sent' : 'Nothing to report today, so no digest was sent' });
    }),
  );

  return router;
}
