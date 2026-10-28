import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeTiktok } from './fake-tiktok.js';
import { signRequest, toImportRow } from '../server/lib/tiktokShop.js';

describe('TikTok request signing and rows', () => {
  it('signs secret + path + sorted params (not sign or access_token) + body + secret with HMAC-SHA256', () => {
    const a = signRequest({ secret: 's', path: '/x', query: { b: '2', a: '1', sign: 'old', access_token: 't' }, body: '{"k":1}' });
    const b = signRequest({ secret: 's', path: '/x', query: { a: '1', b: '2' }, body: '{"k":1}' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(signRequest({ secret: 's', path: '/x', query: { a: '1', b: '3' }, body: '{"k":1}' })).not.toBe(a);
  });

  it('turns a return into a row of TikTok’s returns export, one row per request', () => {
    const row = toImportRow({
      return_id: 1,
      order_id: 2,
      return_reason_text: 'Defective',
      buyer_remarks: 'Stopped working',
      create_time: Date.parse('2026-10-03T16:00:00Z') / 1000,
      return_status: 'REQUEST_SUCCESS',
      return_line_items: [{ product_name: 'Cam', seller_sku: 'C-1', sku_id: '9', product_id: '7' }, { product_name: 'Cam', seller_sku: 'C-1' }],
    });
    expect(row).toEqual({
      'Return Order ID': '1',
      'Order ID': '2',
      'Product Name': 'Cam',
      'Seller SKU': 'C-1',
      'SKU ID': '9',
      'Product ID': '7',
      Quantity: '2',
      'Return Reason': 'Defective',
      'Buyer Note': 'Stopped working',
      'Time Requested': '2026-10-03 09:00:00', // Phoenix time
      'Return Status': 'REQUEST_SUCCESS',
    });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('automatic TikTok returns imports', () => {
  let db, fake, app, admin, editor;

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeTiktok();
    app = makeApp(db, { tiktokShop: { ...fake.keys, apiUrl: fake.apiUrl, authUrl: fake.authUrl } });
    ({ agent: admin } = await signedInAgent(app, db, { email: 'boss@example.com', role: 'admin' }));
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' }));
    const { rows } = await db.query("INSERT INTO products (name) VALUES ('Sample Bulb Cam') RETURNING id");
    await db.query("INSERT INTO product_listings (product_id, channel, sku, state) VALUES ($1, 'tiktok', 'SBC-1', 'live')", [rows[0].id]);
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('waits for the shop to be authorized', async () => {
    const { body } = await editor.get('/api/returns/auto-imports').expect(200);
    expect(body.tiktok).toMatchObject({ configured: true, authorized: false });
    const res = await editor.post('/api/returns/auto-imports/tiktok').send({}).expect(502);
    expect(res.body.error).toMatch(/isn't authorized for the shop yet/);
  });

  it('takes the code TikTok sends back after an admin authorizes the shop, and keeps the tokens', async () => {
    await editor.get('/api/integrations/tiktok/callback?code=auth-code-1').expect(403);
    await request(app).get('/api/integrations/tiktok/callback?code=auth-code-1').expect(401);
    const bad = await admin.get('/api/integrations/tiktok/callback?code=wrong').expect(302);
    expect(bad.headers.location).toMatch(/tiktok=TikTok%20refused/);
    const ok = await admin.get('/api/integrations/tiktok/callback?code=auth-code-1').expect(302);
    expect(ok.headers.location).toBe('/admin/integrations?tiktok=connected');
    const { body } = await admin.get('/api/admin/integrations').expect(200);
    expect(body.tiktok).toMatchObject({ configured: true, authorized: true, shop: 'Sample Shop', callbackUrl: 'http://localhost:3001/api/integrations/tiktok/callback' });
  });

  it('imports the shop’s returns like the export: one per request, matched, notes sorted, and what TikTok sent noted', async () => {
    const { body } = await editor.post('/api/returns/auto-imports/tiktok').send({ from: '2026-10-01', to: '2026-10-14' }).expect(200);
    expect(body.run).toMatchObject({ ok: true, rows_read: 3, returns_created: 3 });
    expect(body.run.detail).toMatch(/^Fields TikTok sent: buyer_remarks, create_time, order_id, .*return_line_items\.product_name/);
    expect(fake.state.badSign).toBe(0);

    const { rows } = await db.query(
      `SELECT r.return_ref, r.quantity, r.customer_comment, r.status, p.name AS product, c.key AS category
         FROM returns r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN return_categories c ON c.id = r.category_id ORDER BY r.return_ref`,
    );
    expect(rows).toEqual([
      { return_ref: '5770001', quantity: 1, customer_comment: 'Too big for my porch light and keeps going offline', status: 'AWAITING_BUYER_SHIP', product: 'Sample Bulb Cam', category: 'connectivity' },
      { return_ref: '5770002', quantity: 2, customer_comment: '', status: 'REQUEST_SUCCESS', product: 'Sample Bulb Cam', category: 'no_comment' },
      { return_ref: '5770003', quantity: 1, customer_comment: 'Stopped working after a week', status: 'RETURN_OR_REFUND_CANCEL', product: 'Sample Bulb Cam', category: 'performance' },
    ]);
    // Both problems in the first note are mentions.
    const { rows: mentions } = await db.query(
      "SELECT c.key FROM return_mentions m JOIN returns r ON r.id = m.return_id JOIN return_categories c ON c.id = m.category_id WHERE r.return_ref = '5770001' AND NOT m.dismissed ORDER BY c.key",
    );
    expect(mentions.map((m) => m.key)).toEqual(['connectivity', 'fit']);
  });

  it('never imports a return twice, and refreshes an expired token on its own, keeping the newest refresh token', async () => {
    fake.state.expireAccess = true;
    const before = fake.state.refreshes;
    const { body } = await editor.post('/api/returns/auto-imports/tiktok').send({ from: '2026-09-20', to: '2026-10-14' }).expect(200);
    expect(body.run).toMatchObject({ rows_read: 3, returns_created: 0 });
    expect(fake.state.refreshes).toBe(before + 1);
    const { rows } = await db.query("SELECT value FROM job_state WHERE key = 'tiktok_tokens'");
    expect(JSON.parse(rows[0].value)).toMatchObject({ refresh_token: fake.state.refreshToken, shop_cipher: 'ROW_sample_cipher' });
  });

  it('lists TikTok runs with Amazon’s on the Import page', async () => {
    const { body } = await editor.get('/api/returns/auto-imports').expect(200);
    expect(body.amazon).toMatchObject({ configured: false });
    expect(body.tiktok.runs.map((r) => [r.ok, r.returns_created])).toEqual([
      [true, 0],
      [true, 3],
      [false, 0],
    ]);
  });
});
