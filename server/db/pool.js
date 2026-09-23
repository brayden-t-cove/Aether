import pg from 'pg';

export function createPool({ connectionString, ssl = false }) {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 10,
  });
}
