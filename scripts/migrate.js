import { config, assertConfig } from '../server/config.js';
import { createPool } from '../server/db/pool.js';
import { migrate } from '../server/db/migrate.js';

assertConfig();
const db = createPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
try {
  await migrate(db);
} finally {
  await db.end();
}
