import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../server/db/pool.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { TEST_DATABASE_URL } from './helpers.js';

// Migration 016 turns each checklist item's notes into its first update. Run everything before it, add items
// with notes the old way, then run 016 and check the notes became dated, credited entries.
describe.skipIf(!TEST_DATABASE_URL)('moving item notes into updates', () => {
  let db, dir;

  beforeAll(async () => {
    db = createPool({ connectionString: TEST_DATABASE_URL });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    dir = await mkdtemp(join(tmpdir(), 'aether-migrations-'));
    for (const m of await listMigrations()) if (m.version < '016') await cp(m.path, join(dir, m.file));
    await migrate(db, { dir, log: () => {} });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await db?.end();
  });

  it('moves non-empty notes into the thread and drops the notes field', async () => {
    const { rows: [user] } = await db.query("INSERT INTO users (email, name, role) VALUES ('ed@example.com', 'Ed', 'editor') RETURNING id");
    const { rows: [project] } = await db.query("INSERT INTO projects (name, created_by) VALUES ('Sample launch', $1) RETURNING id", [user.id]);
    const add = async (title, notes, state = 'not_started') =>
      (
        await db.query(
          `INSERT INTO checklist_items (project_id, title, notes, state, created_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, '2026-09-01T10:00:00Z') RETURNING id`,
          [project.id, title, notes, state, user.id],
        )
      ).rows[0].id;
    const withNotes = await add('Book the lab', 'Waiting on a quote from the lab', 'blocked');
    const blank = await add('Order adapters', '   ');

    await migrate(db, { log: () => {} });

    const { rows } = await db.query('SELECT item_id, body, state, state_from, created_by, created_at FROM item_comments');
    expect(rows).toEqual([
      { item_id: withNotes, body: 'Waiting on a quote from the lab', state: 'blocked', state_from: null, created_by: user.id, created_at: new Date('2026-09-01T10:00:00Z') },
    ]);
    expect(rows.some((r) => r.item_id === blank)).toBe(false);
    const { rows: cols } = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'checklist_items' AND column_name = 'notes'");
    expect(cols).toEqual([]);
  });
});
