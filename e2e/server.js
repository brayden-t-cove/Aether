/**
 * Starts everything the end-to-end suite needs, on fixed ports:
 *   4100  Aether (built client + API), APP_ENV=staging, uploads on
 *   4101  fake Odyssey (test/fake-odyssey.js)
 *   4102  fake Slack webhook, with GET /messages to read what was posted
 * The database in E2E_DATABASE_URL is wiped and migrated on every start.
 */
import express from 'express';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool } from '../server/db/pool.js';
import { migrate } from '../server/db/migrate.js';
import { createApp } from '../server/app.js';
import { createUser } from '../server/lib/users.js';
import { startFakeOdyssey } from '../test/fake-odyssey.js';
import { E2E_PASSWORD, USERS } from './users.js';

const DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgres://aether:aether@localhost:5432/aether_e2e';

const db = createPool({ connectionString: DATABASE_URL });
await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate(db, { log: () => {} });
for (const u of Object.values(USERS)) await createUser(db, { ...u, password: E2E_PASSWORD });

const odyssey = await startFakeOdyssey({ port: 4101, apiKey: 'e2e-key' });

const slackMessages = [];
const slack = express();
slack.use(express.json());
slack.post('/hook', (req, res) => {
  slackMessages.push(req.body.text);
  res.send('ok');
});
slack.get('/messages', (req, res) => res.json(slackMessages));
await new Promise((resolve) => slack.listen(4102, '127.0.0.1', resolve));

const app = createApp({
  db,
  config: {
    isProduction: false,
    appEnv: 'staging',
    publicUrl: 'http://localhost:4100',
    sessionSecret: 'e2e',
    adminEmail: '',
    google: { enabled: false },
    filesDir: mkdtempSync(join(tmpdir(), 'aether-e2e-files-')),
    maxUploadMb: 5,
    odyssey: { apiUrl: odyssey.url, apiKey: 'e2e-key', syncMinutes: 15 },
    slack: { webhookUrl: 'http://127.0.0.1:4102/hook', digestHourUtc: 14 },
  },
});
app.listen(4100, () => console.log('[e2e] Aether on http://localhost:4100'));
