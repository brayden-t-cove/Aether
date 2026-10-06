import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../server/db/pool.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { TEST_DATABASE_URL } from './helpers.js';

// Migration 019 folds Hardware and Setup into the six buckets. Returns filed before it, by the rules or by hand,
// must follow their sub-reason to the new bucket, secondary categories included.
describe.skipIf(!TEST_DATABASE_URL)('moving returns into the six buckets', () => {
  let db, dir;
  const ids = {};

  beforeAll(async () => {
    db = createPool({ connectionString: TEST_DATABASE_URL });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    dir = await mkdtemp(join(tmpdir(), 'aether-migrations-'));
    for (const m of await listMigrations()) if (m.version < '019') await cp(m.path, join(dir, m.file));
    await migrate(db, { dir, log: () => {} });

    const file = async (ref, category, subreason, source = 'manual') =>
      (
        await db.query(
          `INSERT INTO returns (channel, return_date, return_ref, quantity, category_id, subreason_id, category_source)
           SELECT 'tiktok', '2026-09-01', $1, 1, c.id, s.id, $4
             FROM return_categories c JOIN return_subreasons s ON s.category_id = c.id WHERE c.key = $2 AND s.key = $3
           RETURNING id`,
          [ref, category, subreason, source],
        )
      ).rows[0].id;
    ids.dead = await file('M-1', 'hardware', 'wont_power_on');
    ids.alexa = await file('M-2', 'setup', 'smart_home', 'rule');
    ids.app = await file('M-3', 'setup', 'app_setup');
    ids.fake = await file('M-4', 'setup', 'trust');
    // Filed under Performance, with Setup and Hardware as other problems the buyer mentioned.
    ids.blurry = await file('M-5', 'performance', 'image_quality');
    await db.query(
      `INSERT INTO return_secondary_categories (return_id, category_id)
       SELECT $1, id FROM return_categories WHERE key IN ('setup', 'hardware', 'fit')`,
      [ids.blurry],
    );

    await migrate(db, { log: () => {} });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await db?.end();
  });

  const filed = async (id) =>
    (
      await db.query(
        `SELECT c.key AS category, s.key AS subreason, r.category_source FROM returns r
           JOIN return_categories c ON c.id = r.category_id JOIN return_subreasons s ON s.id = r.subreason_id WHERE r.id = $1`,
        [id],
      )
    ).rows[0];

  it('moves each return with its sub-reason, keeping who filed it', async () => {
    expect(await filed(ids.dead)).toEqual({ category: 'performance', subreason: 'wont_power_on', category_source: 'manual' });
    expect(await filed(ids.alexa)).toEqual({ category: 'connectivity', subreason: 'smart_home', category_source: 'rule' });
    expect(await filed(ids.app)).toEqual({ category: 'performance', subreason: 'app_setup', category_source: 'manual' });
    expect(await filed(ids.fake)).toEqual({ category: 'non_specific', subreason: 'trust', category_source: 'manual' });
  });

  it('turns secondary Hardware and Setup into Performance / Hardware, dropping it when that is the main bucket', async () => {
    const { rows } = await db.query(
      'SELECT c.key FROM return_secondary_categories x JOIN return_categories c ON c.id = x.category_id WHERE x.return_id = $1',
      [ids.blurry],
    );
    expect(rows.map((r) => r.key)).toEqual(['fit']);
  });

  it('leaves no Hardware or Setup bucket behind', async () => {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM return_categories WHERE key IN ('hardware', 'setup')");
    expect(rows[0].n).toBe(0);
  });
});
