import { config, assertConfig } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

assertConfig();

const db = createPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
await migrate(db);

const app = createApp({ db, config });
const server = app.listen(config.port, () => {
  console.log(`[aether] listening on ${config.publicUrl} (port ${config.port})`);
  console.log(`[aether] Google sign-in ${config.google.enabled ? 'enabled' : 'disabled'}`);
});

function shutdown(signal) {
  console.log(`[aether] ${signal} received, shutting down`);
  server.close(() => db.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
