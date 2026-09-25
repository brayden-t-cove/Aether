import request from 'supertest';
import { createPool } from '../server/db/pool.js';
import { migrate } from '../server/db/migrate.js';
import { createApp } from '../server/app.js';
import { createUser } from '../server/lib/users.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export const testConfig = {
  isProduction: false,
  publicUrl: 'http://localhost:3001',
  sessionSecret: 'test-secret',
  adminEmail: 'boss@lunahome.com',
  google: { enabled: false },
  odyssey: {},
};

/** Fresh schema + migrated database. Destroys everything in TEST_DATABASE_URL. */
export async function setupDb() {
  const db = createPool({ connectionString: TEST_DATABASE_URL });
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db, { log: () => {} });
  return db;
}

export function makeApp(db, overrides = {}) {
  return createApp({ db, config: { ...testConfig, ...overrides } });
}

export const PASSWORD = 'correct horse battery';

/** Create a user with a password and return a supertest agent signed in as them. */
export async function signedInAgent(app, db, { email, role = 'viewer', name = '' }) {
  const user = await createUser(db, { email, role, name, password: PASSWORD });
  const agent = request.agent(app);
  await agent.post('/auth/local').send({ email, password: PASSWORD }).expect(200);
  return { agent, user };
}
