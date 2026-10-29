import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeAmazon } from './fake-amazon.js';
import { createAmazonSpClient } from '../server/lib/amazonSp.js';
import { runAutoImport } from '../server/lib/autoImports.js';

describe.skipIf(!TEST_DATABASE_URL)('automatic Amazon returns imports', () => {
  let db, fake, editor, viewer, admin;
  const amazonConfig = () => ({ ...fake.keys, apiUrl: fake.apiUrl, lwaUrl: fake.lwaUrl, pollMs: 5 });

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeAmazon();
    const app = makeApp(db, { amazonSp: amazonConfig() });
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    ({ agent: admin } = await signedInAgent(app, db, { email: 'boss@example.com', role: 'admin' }));
    const { rows } = await db.query("INSERT INTO products (name, model) VALUES ('Sample Doorbell', 'SD1') RETURNING id");
    await db.query("INSERT INTO product_listings (product_id, channel, external_id, state) VALUES ($1, 'amazon', 'B0SAMPLE1', 'live')", [rows[0].id]);
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('says when Amazon is not connected', async () => {
    const plain = makeApp(db);
    const { agent } = await signedInAgent(plain, db, { email: 'other@example.com', role: 'editor' });
    expect((await agent.get('/api/returns/auto-imports').expect(200)).body.amazon).toMatchObject({ configured: false });
    await agent.post('/api/returns/auto-imports/amazon').send({}).expect(503);
  });

  it('fetches the returns report and imports it like an upload: units grouped per order, matched, sorted', async () => {
    await viewer.post('/api/returns/auto-imports/amazon').send({}).expect(403);
    const { body } = await editor.post('/api/returns/auto-imports/amazon').send({ from: '2026-10-01', to: '2026-10-14' }).expect(200);
    expect(body.run).toMatchObject({ ok: true, rows_read: 3, returns_created: 2 });
    expect(body.message).toBe('2 new of 3 rows from Amazon (2026-10-01 to 2026-10-14); the rest were already imported.');
    expect(fake.state.created.at(-1)).toEqual({ dataStartTime: '2026-10-01T00:00:00Z', dataEndTime: '2026-10-14T23:59:59Z' });

    const { rows } = await db.query(
      `SELECT r.order_ref, r.quantity, r.customer_comment, p.name AS product, c.key AS category, i.filename
         FROM returns r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN return_categories c ON c.id = r.category_id
         JOIN return_imports i ON i.id = r.import_id ORDER BY r.order_ref`,
    );
    expect(rows).toEqual([
      // Windows-1252 from Amazon reads right: a curly quote, not a garbled character.
      { order_ref: '111-0001-0001', quantity: 1, customer_comment: 'Keeps going offline’ every night', product: 'Sample Doorbell', category: 'connectivity', filename: 'Amazon API · 2026-10-01 to 2026-10-14' },
      { order_ref: '111-0002-0002', quantity: 2, customer_comment: '', product: 'Sample Doorbell', category: 'no_comment', filename: 'Amazon API · 2026-10-01 to 2026-10-14' },
    ]);
  });

  it('never counts a return twice when windows overlap', async () => {
    const { body } = await editor.post('/api/returns/auto-imports/amazon').send({ from: '2026-09-28', to: '2026-10-14' }).expect(200);
    expect(body.run).toMatchObject({ rows_read: 3, returns_created: 0 });
    const { rows } = await db.query('SELECT count(*)::int AS n FROM returns');
    expect(rows[0].n).toBe(2);
  });

  it('handles a range with no returns, which Amazon cancels', async () => {
    const { body } = await editor.post('/api/returns/auto-imports/amazon').send({ from: '2026-06-01', to: '2026-06-30' }).expect(200);
    expect(body).toMatchObject({ run: { ok: true, rows_read: 0, returns_created: 0 }, message: 'No returns from Amazon for 2026-06-01 to 2026-06-30.' });
    await editor.post('/api/returns/auto-imports/amazon').send({ from: '2026-06-30', to: '2026-06-01' }).expect(400);
  });

  it('records a failure clearly when Amazon refuses the keys, and lists runs for admins', async () => {
    const wrong = createAmazonSpClient({ ...amazonConfig(), clientSecret: 'nope' });
    const run = await runAutoImport(db, { channel: 'amazon', client: wrong, from: '2026-10-01', to: '2026-10-02' });
    expect(run).toMatchObject({ ok: false });
    expect(run.error).toMatch(/Amazon refused the app's keys/);

    const { body } = await admin.get('/api/admin/integrations').expect(200);
    expect(body.amazon).toMatchObject({ configured: true, marketplaceId: 'ATVPDKIKX0DER' });
    expect(body.amazon.runs.map((r) => [r.ok, r.returns_created])).toEqual([
      [false, 0],
      [true, 0],
      [true, 0],
      [true, 2],
    ]);
    const { body: status } = await viewer.get('/api/returns/auto-imports').expect(200);
    expect(status.amazon.runs[3].started_by_name).toBe('Ed');
  });
});
