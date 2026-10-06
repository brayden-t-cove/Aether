import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeText } from '../client/src/lib/table.js';
import { rollUpUnits } from '../server/lib/returnsImport.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Made-up rows shaped like Amazon's FBA customer returns report: one row per unit.
const unit = (o) => ({
  'return-date': '2026-09-03T15:00:00+00:00',
  'order-id': '111-0000001-0000001',
  sku: 'SC-1',
  asin: 'B0SAMPLE',
  fnsku: 'X00SAMPLE',
  'product-name': 'Sample Cam',
  quantity: '1',
  'fulfillment-center-id': 'AAA1',
  'detailed-disposition': 'SELLABLE',
  reason: 'NOT_COMPATIBLE',
  status: 'Unit returned to inventory',
  'license-plate-number': 'LPN-A1',
  'customer-comments': '',
  ...o,
});
const SEPTEMBER = [
  // Two units of one order, returned on different days with different comments.
  unit({ 'license-plate-number': 'LPN-A1', 'return-date': '2026-09-03T15:00:00+00:00', 'customer-comments': 'Not Compatible|Wifi' }),
  unit({ 'license-plate-number': 'LPN-A2', 'return-date': '2026-09-01T09:00:00+00:00', reason: 'DEFECTIVE', 'customer-comments': 'Not as Expected|Would not stay connected to my wifi|No' }),
  unit({ 'order-id': '111-0000002-0000002', 'license-plate-number': 'LPN-B1', reason: 'UNWANTED_ITEM', 'customer-comments': 'Changed Mind|My needs changed' }),
  unit({ 'order-id': '111-0000003-0000003', 'license-plate-number': 'LPN-C1', reason: 'UNDELIVERABLE_UNKNOWN', quantity: '2' }),
  unit({ 'order-id': '', 'license-plate-number': 'LPN-X' }),
];
// October's report: one more unit of the first order, and a new order.
const OCTOBER = [
  unit({ 'license-plate-number': 'LPN-A3', 'return-date': '2026-10-02T10:00:00+00:00', 'customer-comments': 'Defective|Both cameras keep going offline every night, even next to the router' }),
  unit({ 'order-id': '111-0000004-0000004', 'license-plate-number': 'LPN-D1', 'return-date': '2026-10-02T10:00:00+00:00', 'customer-comments': 'Defective|Won&#39;t turn on' }),
];

describe('reading report files', () => {
  it('reads UTF-8, and falls back to Windows-1252 for Amazon reports', () => {
    expect(decodeText(new TextEncoder().encode('Lo necesitaba inalámbrico'))).toBe('Lo necesitaba inalámbrico');
    expect(decodeText(new Uint8Array([0x63, 0xe1, 0x6d, 0x61, 0x72, 0x61]))).toBe('cámara');
  });
});

describe('rolling units up into a return', () => {
  it('takes the earliest date, the total units, and the unit with the most to say', () => {
    const r = rollUpUnits([
      { unit_date: '2026-09-03', quantity: 1, reason_code: 'NOT_COMPATIBLE', customer_comment: 'Not Compatible|Wifi', sku: 'A' },
      { unit_date: '2026-09-01', quantity: 2, reason_code: 'DEFECTIVE', customer_comment: 'Defective|Would not stay connected|No', sku: 'B' },
    ]);
    expect(r).toMatchObject({ return_date: '2026-09-01', quantity: 3, reason_code: 'DEFECTIVE', sku: 'B', customer_comment: 'Defective|Would not stay connected|No' });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('importing an Amazon returns report', () => {
  let db, editor, admin;
  const ret = async (order) =>
    (
      await db.query(
        `SELECT r.id, r.return_date::text AS return_date, r.quantity, r.reason_code, r.note_clean, c.key AS category, s.key AS subreason,
                (SELECT count(*)::int FROM return_units u WHERE u.return_id = r.id) AS units
           FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id LEFT JOIN return_subreasons s ON s.id = r.subreason_id
          WHERE r.channel = 'amazon' AND r.order_ref = $1`,
        [order],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: admin } = await signedInAgent(app, db, { email: 'ad@example.com', role: 'admin' }));
  });
  afterAll(() => db?.end());

  it('previews one return per order', async () => {
    const { body } = await editor.post('/api/returns/import').send({ channel: 'amazon', rows: SEPTEMBER, dryRun: true }).expect(200);
    expect(body.grouped).toBe(true);
    expect(body.summary).toEqual({ rows: 5, create: 3, units: 5, added: 0, duplicates: 0, errors: 1, unmatched: 3, with_note: 2 });
    expect(body.rows.find((r) => r.line === 6)).toMatchObject({ action: 'error', error: 'No order ID' });
    expect(body.rows.find((r) => r.line === 2)).toMatchObject({ action: 'create', order_ref: '111-0000001-0000001' });
  });

  it('groups units into returns and sorts them from the most telling note', async () => {
    const { body } = await editor.post('/api/returns/import').send({ channel: 'amazon', rows: SEPTEMBER, filename: 'sep.csv' }).expect(200);
    expect(body.import).toMatchObject({ created_count: 3, duplicate_count: 0 });
    expect(await ret('111-0000001-0000001')).toMatchObject({
      return_date: '2026-09-01',
      quantity: 2,
      units: 2,
      reason_code: 'DEFECTIVE',
      note_clean: 'Would not stay connected to my wifi',
      category: 'connectivity',
      subreason: 'drops_offline',
    });
    expect(await ret('111-0000002-0000002')).toMatchObject({ category: 'no_comment', subreason: 'preset_needs_changed', note_clean: '' });
    expect(await ret('111-0000003-0000003')).toMatchObject({ quantity: 2, category: 'not_customer', subreason: 'undeliverable' });
  });

  it('never double counts a re-imported report', async () => {
    const { body } = await editor.post('/api/returns/import').send({ channel: 'amazon', rows: SEPTEMBER, dryRun: true }).expect(200);
    expect(body.summary).toMatchObject({ create: 0, added: 0, duplicates: 4, errors: 1 });
    expect(body.rows.filter((r) => r.action === 'duplicate').map((r) => r.reason_dup)).toEqual(Array(4).fill('Already imported'));
  });

  it('adds next month’s units to an order already imported, and undoing that import takes them off again', async () => {
    const preview = await editor.post('/api/returns/import').send({ channel: 'amazon', rows: OCTOBER, dryRun: true }).expect(200);
    expect(preview.body.summary).toMatchObject({ create: 1, added: 1, units: 2 });
    expect(preview.body.rows[0]).toMatchObject({ action: 'add', reason_dup: 'Adds to an earlier return' });

    const { body } = await editor.post('/api/returns/import').send({ channel: 'amazon', rows: OCTOBER, filename: 'oct.csv' }).expect(200);
    expect(body.import.created_count).toBe(1);
    expect(await ret('111-0000001-0000001')).toMatchObject({ quantity: 3, units: 3, return_date: '2026-09-01', note_clean: 'Both cameras keep going offline every night, even next to the router' });
    expect(await ret('111-0000004-0000004')).toMatchObject({ note_clean: "Won't turn on", category: 'hardware', subreason: 'wont_power_on' });

    await admin.delete(`/api/returns/imports/${body.import.id}`).expect(200);
    expect(await ret('111-0000004-0000004')).toBeUndefined();
    expect(await ret('111-0000001-0000001')).toMatchObject({ quantity: 2, units: 2, note_clean: 'Would not stay connected to my wifi', category: 'connectivity' });
  });

  it('counts identical rows without a license plate as separate units, and a reused license plate on another order', async () => {
    const twoUnits = { 'order-id': 'Shopify #1001 0000000001', 'license-plate-number': '', reason: 'UNDELIVERABLE_UNKNOWN', 'return-date': '2026-09-14T22:10:00+00:00' };
    const rows = [unit(twoUnits), unit(twoUnits), unit({ 'order-id': '111-0000005-0000005', 'license-plate-number': 'LPN-A1', 'return-date': '2026-09-25T12:30:00+00:00' })];
    const { body } = await editor.post('/api/returns/import').send({ channel: 'amazon', rows }).expect(200);
    expect(body.import.created_count).toBe(2);
    expect(await ret('Shopify #1001 0000000001')).toMatchObject({ quantity: 2, units: 2, category: 'not_customer' });
    expect(await ret('111-0000005-0000005')).toMatchObject({ quantity: 1 });
    const again = await editor.post('/api/returns/import').send({ channel: 'amazon', rows, dryRun: true }).expect(200);
    expect(again.body.summary).toMatchObject({ create: 0, duplicates: 3 });
  });

  it('skips units imported before units were kept, when each unit was its own return', async () => {
    await db.query("INSERT INTO returns (channel, return_date, return_ref, order_ref, product_label) VALUES ('amazon', '2026-08-20', 'LPN-OLD', '111-0000009-0000009', 'Sample Cam')");
    const { body } = await editor
      .post('/api/returns/import')
      .send({ channel: 'amazon', rows: [unit({ 'order-id': '111-0000009-0000009', 'license-plate-number': 'LPN-OLD' })], dryRun: true })
      .expect(200);
    expect(body.summary).toMatchObject({ create: 0, duplicates: 1 });
  });
});
