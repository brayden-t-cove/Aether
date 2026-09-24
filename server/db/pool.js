import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates at local
// midnight, so dates round-trip exactly and never shift across time zones.
pg.types.setTypeParser(1082, (value) => value);

export function createPool({ connectionString, ssl = false }) {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 10,
  });
}
