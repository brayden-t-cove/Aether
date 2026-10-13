import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../server/db/pool.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { sortReturns } from '../server/lib/returnRules.js';
import { TEST_DATABASE_URL } from './helpers.js';

// Migration 022 turns what's already filed into mentions, moves Vague notes to Generic, and drops "also about".
describe.skipIf(!TEST_DATABASE_URL)('carrying filed returns over to mentions', () => {
  let db, dir;
  const ids = {};

  beforeAll(async () => {
    db = createPool({ connectionString: TEST_DATABASE_URL });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    dir = await mkdtemp(join(tmpdir(), 'aether-migrations-'));
    for (const m of await listMigrations()) if (m.version < '022') await cp(m.path, join(dir, m.file));
    await migrate(db, { dir, log: () => {} });

    const file = async (ref, note, category, subreason, source) =>
      (
        await db.query(
          `INSERT INTO returns (channel, return_date, return_ref, quantity, customer_comment, note_clean, category_id, subreason_id, category_source, category_why)
           SELECT 'tiktok', '2026-09-01', $1, 1, $2, $2, c.id, s.id, $5, CASE WHEN $5 = 'rule' THEN 'note matched: "x"' ELSE '' END
             FROM return_categories c JOIN return_subreasons s ON s.category_id = c.id WHERE c.key = $3 AND s.key = $4
           RETURNING id`,
          [ref, note, category, subreason, source],
        )
      ).rows[0].id;
    ids.both = await file('MM-1', 'Too big for the porch light and it keeps going offline', 'connectivity', 'drops_offline', 'rule');
    ids.byHand = await file('MM-2', 'The mount fell off', 'fit', 'mount', 'manual');
    ids.vague = await file('MM-3', "Doesn't work", 'non_specific', 'vague', 'rule');
    // A person marked MM-2 as also about Subscription.
    await db.query("INSERT INTO return_secondary_categories (return_id, category_id) SELECT $1, id FROM return_categories WHERE key = 'subscription'", [ids.byHand]);

    await migrate(db, { log: () => {} });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await db?.end();
  });

  const mentions = async (id) =>
    (
      await db.query(
        `SELECT c.key AS category, s.key AS subreason, m.source, m.checked_at IS NOT NULL AS checked FROM return_mentions m
           JOIN return_categories c ON c.id = m.category_id LEFT JOIN return_subreasons s ON s.id = m.subreason_id
          WHERE m.return_id = $1 AND NOT m.dismissed ORDER BY c.sort_order`,
        [id],
      )
    ).rows;
  const category = async (id) => (await db.query('SELECT c.key FROM returns r JOIN return_categories c ON c.id = r.category_id WHERE r.id = $1', [id])).rows[0].key;

  it('makes each filed return’s main category a mention, keeping who made it, and "also about" a person’s mention', async () => {
    expect(await mentions(ids.both)).toEqual([{ category: 'connectivity', subreason: 'drops_offline', source: 'rule', checked: false }]);
    expect(await mentions(ids.byHand)).toEqual([
      { category: 'fit', subreason: 'mount', source: 'manual', checked: true },
      { category: 'subscription', subreason: null, source: 'manual', checked: true },
    ]);
  });

  it('moves Vague to Generic, with no mention', async () => {
    expect(await category(ids.vague)).toBe('generic');
    expect(await mentions(ids.vague)).toEqual([]);
  });

  it('then finds the other mentions when the server sorts returns not yet read for them', async () => {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM returns WHERE NOT mentions_sorted');
    expect(rows[0].n).toBe(3);
    await sortReturns(db, { unsortedMentions: true });
    expect((await mentions(ids.both)).map((m) => m.category)).toEqual(['connectivity', 'fit']);
    // A person's calls stay as they are.
    expect((await mentions(ids.byHand)).map((m) => m.category)).toEqual(['fit', 'subscription']);
    expect(await category(ids.byHand)).toBe('fit');
    const { rows: after } = await db.query('SELECT count(*)::int AS n FROM returns WHERE NOT mentions_sorted');
    expect(after[0].n).toBe(0);
  });
});
