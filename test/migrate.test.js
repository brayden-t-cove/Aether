import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, listMigrations } from '../server/db/migrate.js';
import { setupDb, TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('migrations', () => {
  let db;
  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(() => db?.end());

  it('records every migration once', async () => {
    const files = await listMigrations();
    const { rows } = await db.query('SELECT name FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.name)).toEqual(files.map((f) => f.file));
  });

  it('is a no-op when re-run', async () => {
    expect(await migrate(db, { log: () => {} })).toEqual([]);
  });

  it('uses unique three-digit versions', async () => {
    const versions = (await listMigrations()).map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
