import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listActivity, logActivity } from '../lib/activity.js';
import { diff, updateRow, withTransaction } from '../lib/db.js';
import { parse, v } from '../lib/validate.js';
import { addAttribute, COMPARISON_FIELDS, COMPETITOR_FIELDS, getComparisonGrid, STARTER_ATTRIBUTES } from '../lib/comparisons.js';

async function loadComparison(db, id) {
  const { rows } = await db.query('SELECT * FROM comparisons WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Comparison not found');
  return rows[0];
}

const log = (db, id, action, changes, userId) => logActivity(db, { entityType: 'comparison', entityId: id, action, changes, userId });

export function comparisonRoutes({ db }) {
  const router = Router();

  // ── Competitor products ───────────────────────────────────────────────────

  router.get(
    '/api/competitors',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { rows } = await db.query(
        `SELECT k.*, (SELECT count(*)::int FROM comparison_competitors cc WHERE cc.competitor_id = k.id) AS comparison_count
           FROM competitors k ORDER BY k.brand, k.name`,
      );
      res.json({ competitors: rows });
    }),
  );

  router.post(
    '/api/competitors',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const f = parse(req.body, COMPETITOR_FIELDS, { required: ['brand', 'name'] });
      const { rows } = await db.query(
        `INSERT INTO competitors (brand, name, model, category, price, url, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [f.brand, f.name, f.model ?? '', f.category ?? '', f.price ?? null, f.url ?? '', f.notes ?? '', req.user.id],
      );
      await logActivity(db, { entityType: 'competitor', entityId: rows[0].id, action: 'created', changes: { label: `${f.brand} ${f.name}` }, userId: req.user.id });
      res.status(201).json({ competitor: rows[0] });
    }),
  );

  router.patch(
    '/api/competitors/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query('SELECT * FROM competitors WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Competitor not found');
      const fields = parse(req.body, COMPETITOR_FIELDS);
      const competitor = await updateRow(db, 'competitors', rows[0].id, fields, Object.keys(COMPETITOR_FIELDS));
      const changes = diff({ ...rows[0], price: rows[0].price === null ? null : Number(rows[0].price) }, fields, Object.keys(fields));
      if (Object.keys(changes).length) {
        await logActivity(db, { entityType: 'competitor', entityId: competitor.id, action: 'updated', changes: { ...changes, label: `${competitor.brand} ${competitor.name}` }, userId: req.user.id });
      }
      res.json({ competitor });
    }),
  );

  router.delete(
    '/api/competitors/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query('DELETE FROM competitors WHERE id = $1 RETURNING *', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Competitor not found');
      await logActivity(db, { entityType: 'competitor', entityId: rows[0].id, action: 'deleted', changes: { label: `${rows[0].brand} ${rows[0].name}` }, userId: req.user.id });
      res.json({ ok: true });
    }),
  );

  // ── Comparisons ───────────────────────────────────────────────────────────

  router.get(
    '/api/comparisons',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { rows } = await db.query(
        `SELECT c.*, p.name AS product_name,
                (SELECT count(*)::int FROM comparison_competitors cc WHERE cc.comparison_id = c.id) AS competitor_count,
                (SELECT count(*)::int FROM comparison_attributes a WHERE a.comparison_id = c.id) AS attribute_count
           FROM comparisons c LEFT JOIN products p ON p.id = c.product_id
          ORDER BY c.updated_at DESC`,
      );
      res.json({ comparisons: rows });
    }),
  );

  router.get(
    '/api/comparisons/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const grid = await getComparisonGrid(db, req.params.id);
      if (!grid) throw new HttpError(404, 'Comparison not found');
      res.json({ ...grid, activity: await listActivity(db, { entityType: 'comparison', entityId: req.params.id, limit: 30 }) });
    }),
  );

  router.post(
    '/api/comparisons',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const f = parse(req.body, COMPARISON_FIELDS, { required: ['name'] });
      const id = await withTransaction(db, async (tx) => {
        const { rows } = await tx.query('INSERT INTO comparisons (name, product_id, notes, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [
          f.name,
          f.product_id ?? null,
          f.notes ?? '',
          req.user.id,
        ]);
        if (req.body?.starter_attributes !== false) {
          for (const name of STARTER_ATTRIBUTES) await addAttribute(tx, rows[0].id, name);
        }
        await log(tx, rows[0].id, 'created', { label: f.name }, req.user.id);
        return rows[0].id;
      });
      res.status(201).json(await getComparisonGrid(db, id));
    }),
  );

  router.patch(
    '/api/comparisons/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const before = await loadComparison(db, req.params.id);
      const fields = parse(req.body, COMPARISON_FIELDS);
      await updateRow(db, 'comparisons', before.id, fields, Object.keys(COMPARISON_FIELDS));
      const changes = diff(before, fields, Object.keys(fields));
      if (Object.keys(changes).length) await log(db, before.id, 'updated', { ...changes, label: fields.name ?? before.name }, req.user.id);
      res.json(await getComparisonGrid(db, before.id));
    }),
  );

  router.delete(
    '/api/comparisons/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const c = await loadComparison(db, req.params.id);
      await db.query('DELETE FROM comparisons WHERE id = $1', [c.id]);
      await log(db, c.id, 'deleted', { label: c.name }, req.user.id);
      res.json({ ok: true });
    }),
  );

  // Columns: add an existing competitor, or create one on the spot.
  router.post(
    '/api/comparisons/:id/competitors',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const c = await loadComparison(db, req.params.id);
      let competitorId = req.body?.competitor_id;
      if (competitorId) {
        competitorId = v.id({ label: 'Competitor', required: true })(competitorId);
      } else {
        const f = parse(req.body, COMPETITOR_FIELDS, { required: ['brand', 'name'] });
        const { rows } = await db.query(
          `INSERT INTO competitors (brand, name, model, category, price, url, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [f.brand, f.name, f.model ?? '', f.category ?? '', f.price ?? null, f.url ?? '', f.notes ?? '', req.user.id],
        );
        competitorId = rows[0].id;
      }
      await db.query(
        `INSERT INTO comparison_competitors (comparison_id, competitor_id, position)
         VALUES ($1, $2, (SELECT COALESCE(max(position), -1) + 1 FROM comparison_competitors WHERE comparison_id = $1))
         ON CONFLICT DO NOTHING`,
        [c.id, competitorId],
      );
      await db.query('UPDATE comparisons SET updated_at = now() WHERE id = $1', [c.id]);
      await log(db, c.id, 'competitor_added', { label: c.name, competitor_id: competitorId }, req.user.id);
      res.status(201).json(await getComparisonGrid(db, c.id));
    }),
  );

  router.delete(
    '/api/comparisons/:id/competitors/:competitorId',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const c = await loadComparison(db, req.params.id);
      await withTransaction(db, async (tx) => {
        await tx.query('DELETE FROM comparison_competitors WHERE comparison_id = $1 AND competitor_id = $2', [c.id, req.params.competitorId]);
        await tx.query(
          'DELETE FROM comparison_values v USING comparison_attributes a WHERE a.id = v.attribute_id AND a.comparison_id = $1 AND v.competitor_id = $2',
          [c.id, req.params.competitorId],
        );
      });
      await log(db, c.id, 'competitor_removed', { label: c.name }, req.user.id);
      res.json(await getComparisonGrid(db, c.id));
    }),
  );

  // Rows
  router.post(
    '/api/comparisons/:id/attributes',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const c = await loadComparison(db, req.params.id);
      const name = v.text({ label: 'Attribute', required: true, max: 100 })(req.body?.name);
      await addAttribute(db, c.id, name);
      await log(db, c.id, 'attribute_added', { label: c.name, attribute: name }, req.user.id);
      res.status(201).json(await getComparisonGrid(db, c.id));
    }),
  );

  router.patch(
    '/api/comparison-attributes/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query('SELECT * FROM comparison_attributes WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Attribute not found');
      const fields = parse(req.body, { name: v.text({ label: 'Attribute', required: true, max: 100 }), position: v.int({ label: 'Position' }) });
      const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
      if (sets.length) await db.query(`UPDATE comparison_attributes SET ${sets.join(', ')} WHERE id = $1`, [rows[0].id, ...Object.values(fields)]);
      res.json(await getComparisonGrid(db, rows[0].comparison_id));
    }),
  );

  router.delete(
    '/api/comparison-attributes/:id',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const { rows } = await db.query('DELETE FROM comparison_attributes WHERE id = $1 RETURNING *', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Attribute not found');
      await log(db, rows[0].comparison_id, 'attribute_removed', { attribute: rows[0].name }, req.user.id);
      res.json(await getComparisonGrid(db, rows[0].comparison_id));
    }),
  );

  // One cell. competitor_id null = the Luna product's column.
  router.put(
    '/api/comparisons/:id/values',
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const c = await loadComparison(db, req.params.id);
      const f = parse(
        req.body,
        { attribute_id: v.id({ label: 'Attribute', required: true }), competitor_id: v.id({ label: 'Competitor' }), value: v.text({ label: 'Value', max: 1000 }) },
        { required: ['attribute_id'] },
      );
      const { rows: a } = await db.query('SELECT name FROM comparison_attributes WHERE id = $1 AND comparison_id = $2', [f.attribute_id, c.id]);
      if (!a[0]) throw new HttpError(400, "That attribute isn't in this comparison");
      if (f.competitor_id) {
        const { rows: inGrid } = await db.query('SELECT 1 FROM comparison_competitors WHERE comparison_id = $1 AND competitor_id = $2', [c.id, f.competitor_id]);
        if (!inGrid[0]) throw new HttpError(400, "That competitor isn't in this comparison");
      }
      await db.query(
        `INSERT INTO comparison_values (attribute_id, competitor_id, value) VALUES ($1, $2, $3)
         ON CONFLICT (attribute_id, COALESCE(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [f.attribute_id, f.competitor_id ?? null, f.value ?? ''],
      );
      await db.query('UPDATE comparisons SET updated_at = now() WHERE id = $1', [c.id]);
      await log(db, c.id, 'value_updated', { label: c.name, attribute: a[0].name, value: f.value ?? '' }, req.user.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
