/** Test results added by hand: a lab report or an in-house test, with its PDF or link in attachments. */
import { TEST_RESULTS } from '../../shared/workflow.js';
import { v } from './validate.js';

export const TEST_REPORT_FIELDS = {
  title: v.text({ label: 'Title', required: true, max: 200 }),
  result: (value) => (value === '' || value == null ? '' : v.oneOf(TEST_RESULTS, { label: 'Result' })(value)),
  tested_on: v.date({ label: 'Test date' }),
  tested_by: v.text({ label: 'Tested by', max: 200 }),
  notes: v.text({ label: 'Notes', max: 5000 }),
};

const SELECT = `
  SELECT t.*, t.tested_on::text AS tested_on, p.name AS product_name, j.name AS project_name, u.name AS created_by_name
    FROM test_reports t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN projects j ON j.id = t.project_id
    LEFT JOIN users u ON u.id = t.created_by`;

export async function listTestReports(db, productId) {
  const { rows } = await db.query(`${SELECT} WHERE t.product_id = $1 ORDER BY t.tested_on DESC NULLS LAST, t.created_at DESC`, [productId]);
  return rows;
}

export async function getTestReport(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}

export async function createTestReport(db, { productId, projectId, fields, userId }) {
  const { rows } = await db.query(
    `INSERT INTO test_reports (product_id, project_id, title, result, tested_on, tested_by, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [productId, projectId ?? null, fields.title, fields.result ?? '', fields.tested_on ?? null, fields.tested_by ?? '', fields.notes ?? '', userId],
  );
  return getTestReport(db, rows[0].id);
}

export async function updateTestReport(db, id, fields) {
  const keys = Object.keys(fields);
  if (keys.length) {
    await db.query(
      `UPDATE test_reports SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...keys.map((k) => fields[k])],
    );
  }
  return getTestReport(db, id);
}
