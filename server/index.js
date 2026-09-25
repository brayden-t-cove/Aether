import { config, assertConfig } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { bootstrapAdmin, MIN_PASSWORD_LENGTH } from './lib/users.js';
import { createOdysseyClient } from './lib/odyssey.js';
import { runOdysseySync } from './lib/sync.js';
import { startScheduler } from './lib/scheduler.js';

assertConfig();

const db = createPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
await migrate(db);

if (config.adminPassword) {
  const result = await bootstrapAdmin(db, { email: config.adminEmail, password: config.adminPassword });
  if (result === 'ok') {
    console.log(`[aether] password set for admin ${config.adminEmail}. Remove ADMIN_PASSWORD once you have signed in.`);
  } else if (result === 'password_too_short') {
    console.error(`[aether] ADMIN_PASSWORD ignored: it must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  } else {
    console.error('[aether] ADMIN_PASSWORD ignored: ADMIN_EMAIL is not set.');
  }
}

const odyssey = createOdysseyClient(config.odyssey);
const app = createApp({ db, config, odyssey });

const stopJobs = startScheduler([
  {
    name: 'odyssey-sync',
    everyMs: odyssey ? config.odyssey.syncMinutes * 60_000 : 0,
    run: async () => {
      const run = await runOdysseySync(db, odyssey, { trigger: 'schedule' });
      if (run.ok === false) console.error(`[jobs] Odyssey sync failed: ${run.error}`);
    },
  },
]);
const server = app.listen(config.port, () => {
  console.log(`[aether] listening on ${config.publicUrl} (port ${config.port})`);
  console.log(`[aether] Google sign-in ${config.google.enabled ? 'enabled' : 'disabled'}`);
  console.log(`[aether] Odyssey sync ${odyssey ? `every ${config.odyssey.syncMinutes} min from ${odyssey.url}` : 'not configured'}`);
  console.log(`[aether] file uploads ${config.filesDir ? `to ${config.filesDir}` : 'off (links only)'}`);
});

function shutdown(signal) {
  console.log(`[aether] ${signal} received, shutting down`);
  stopJobs();
  server.close(() => db.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
