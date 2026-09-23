/**
 * Minimal versioned migrations.
 *
 * Each file in ./migrations is named NNN_description.sql and runs once,
 * in order, inside a transaction. Applied versions are recorded in
 * schema_migrations. Never edit a migration that has shipped — add a new one.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
// Arbitrary constant so concurrent deploys don't run migrations twice.
const LOCK_ID = 7_310_442;

export async function listMigrations(dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  return files.map((file) => ({ version: file.slice(0, 3), file, path: join(dir, file) }));
}

export async function migrate(pool, { log = console.log, dir } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    const pending = (await listMigrations(dir)).filter((m) => !applied.has(m.version));
    for (const m of pending) {
      const sql = await readFile(m.path, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
          m.version,
          m.file,
        ]);
        await client.query('COMMIT');
        log(`[migrate] applied ${m.file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.file} failed: ${err.message}`, { cause: err });
      }
    }
    if (!pending.length) log('[migrate] database is up to date');
    return pending.map((m) => m.file);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
