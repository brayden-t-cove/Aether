import { updateRow } from './db.js';
import { v } from './validate.js';

export const MARKET_FIELDS = {
  code: (value) => v.text({ label: 'Code', required: true, max: 10 })(value).toUpperCase(),
  name: v.text({ label: 'Name', required: true, max: 100 }),
  plug_types: v.list({ label: 'Plug types' }),
  voltage: v.text({ label: 'Voltage', max: 50 }),
  frequency: v.text({ label: 'Frequency', max: 50 }),
  required_marks: v.list({ label: 'Required marks' }),
  languages: v.list({ label: 'Languages' }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

const COLUMNS = Object.keys(MARKET_FIELDS);

export async function listMarkets(db) {
  const { rows } = await db.query(
    `SELECT m.*,
            (SELECT count(*)::int FROM projects p WHERE p.market_id = m.id) AS project_count,
            (SELECT count(*)::int FROM projects p WHERE p.market_id = m.id AND p.state <> 'done') AS open_project_count
       FROM markets m
      ORDER BY m.code`,
  );
  return rows;
}

export async function getMarket(db, id) {
  const { rows } = await db.query('SELECT * FROM markets WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createMarket(db, fields) {
  const { rows } = await db.query(
    `INSERT INTO markets (code, name, plug_types, voltage, frequency, required_marks, languages, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      fields.code,
      fields.name,
      fields.plug_types ?? [],
      fields.voltage ?? '',
      fields.frequency ?? '',
      fields.required_marks ?? [],
      fields.languages ?? [],
      fields.notes ?? '',
    ],
  );
  return rows[0];
}

export const updateMarket = (db, id, fields) => updateRow(db, 'markets', id, fields, COLUMNS);

export async function deleteMarket(db, id) {
  const { rowCount } = await db.query('DELETE FROM markets WHERE id = $1', [id]);
  return rowCount > 0;
}
