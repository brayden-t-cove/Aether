import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../server/db/pool.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { TEST_DATABASE_URL } from './helpers.js';

// Migration 026 keeps each person's team, makes project owners and item owners the project's people, and gives
// every item its category's team.
describe.skipIf(!TEST_DATABASE_URL)('moving to several teams and project people', () => {
  let db, dir;
  const ids = {};

  beforeAll(async () => {
    db = createPool({ connectionString: TEST_DATABASE_URL });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    dir = await mkdtemp(join(tmpdir(), 'aether-migrations-'));
    for (const m of await listMigrations()) if (m.version < '026') await cp(m.path, join(dir, m.file));
    await migrate(db, { dir, log: () => {} });

    const user = async (email, team) => (await db.query('INSERT INTO users (email, team) VALUES ($1, $2) RETURNING id', [email, team])).rows[0].id;
    ids.owner = await user('owner@example.com', 'leadership');
    ids.doer = await user('doer@example.com', null);
    ids.project = (await db.query("INSERT INTO projects (name, owner_id) VALUES ('Launch', $1) RETURNING id", [ids.owner])).rows[0].id;
    await db.query(
      `INSERT INTO checklist_items (project_id, title, category, owner_id) VALUES
         ($1, 'FCC', 'certification', NULL), ($1, 'Drop test', 'testing', $2), ($1, 'Box', 'packaging', NULL), ($1, 'Misc', 'other', NULL)`,
      [ids.project, ids.doer],
    );
    await migrate(db, { log: () => {} });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await db?.end();
  });

  it('keeps each person’s team as one of their teams', async () => {
    const { rows } = await db.query('SELECT user_id, team FROM user_teams');
    expect(rows).toEqual([{ user_id: ids.owner, team: 'leadership' }]);
  });

  it('makes the project owner and item owners its people', async () => {
    const { rows } = await db.query('SELECT user_id FROM project_members WHERE project_id = $1 ORDER BY user_id', [ids.project]);
    expect(rows.map((r) => r.user_id).sort()).toEqual([ids.owner, ids.doer].sort());
  });

  it('gives every item its category’s team', async () => {
    const { rows } = await db.query('SELECT title, team FROM checklist_items ORDER BY title');
    expect(rows).toEqual([
      { title: 'Box', team: 'design' },
      { title: 'Drop test', team: 'product_development' },
      { title: 'FCC', team: 'international' },
      { title: 'Misc', team: 'leadership' },
    ]);
  });
});
