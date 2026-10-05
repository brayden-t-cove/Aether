import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dateOrder, parseMoney, parseReportDate } from '../server/lib/returnsImport.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Made-up rows shaped like TikTok Shop → Orders → Manage returns → All → Export. TikTok pads IDs and times with a tab.
const request = (o) => ({
  'Return Order ID': '4000000000000000001\t',
  'Order ID': '5000000000000000001\t',
  'Order Amount': '$23.05',
  'Order Status': 'Completed',
  'SKU ID': '1700000000000000001\t',
  'Seller SKU': 'SC-1',
  'Product Name': 'Sample Cam',
  'SKU Name': 'White',
  'Buyer Username': 'sample_buyer_123',
  'Return Type': 'Return and refund',
  'Time Requested': '28/09/2026 12:07:32\t',
  'Return Reason': 'No longer needed',
  'Return unit price': '$22.65',
  'Return Quantity': '1',
  'Return Status': 'Completed',
  'Return Sub Status': '',
  'Buyer Note': '',
  ...o,
});

describe('reading TikTok values', () => {
  it('works out whether dates are day or month first', () => {
    expect(dateOrder(['05/09/2026', '28/09/2026'], 'other')).toBe('dmy');
    expect(dateOrder(['09/05/2026', '09/28/2026'], 'tiktok')).toBe('mdy');
    expect(dateOrder(['05/09/2026'], 'tiktok')).toBe('dmy');
    expect(dateOrder(['05/09/2026', '2026-09-05'], 'amazon')).toBe('mdy');
    expect(parseReportDate('05/09/2026 10:00:00\t', 'dmy')).toBe('2026-09-05');
    expect(parseReportDate('05/09/2026 10:00:00', 'mdy')).toBe('2026-05-09');
  });

  it('reads money with or without a currency', () => {
    expect(parseMoney('$22.65')).toBe(22.65);
    expect(parseMoney('USD 1,022.65')).toBe(1022.65);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('importing a TikTok returns export', () => {
  let db, editor;
  const ROWS = [
    request({ 'Return Order ID': '4000000000000000001\t', 'Time Requested': '05/09/2026 09:00:00\t', 'Return Quantity': '2', 'Buyer Note': 'Both keep going offline' }),
    request({ 'Return Order ID': '4000000000000000002\t', 'Time Requested': '28/09/2026 12:07:32\t', 'Return Status': 'Refund rejected', 'Buyer Note': 'Too big for the porch light' }),
    request({ 'Return Order ID': '4000000000000000003\t', 'Return Reason': 'Congrats on meeting your refundable sample criteria!', 'Return unit price': '$0.00' }),
  ];
  const row = async (ref) =>
    (
      await db.query(
        `SELECT r.*, r.return_date::text AS return_date, r.refund_value::float AS refund_value, c.key AS category
           FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id WHERE r.return_ref = $1`,
        [ref],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
  });
  afterAll(() => db?.end());

  it('previews with dates read day first', async () => {
    const { body } = await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS, dryRun: true }).expect(200);
    expect(body.dateOrder).toBe('dmy');
    expect(body.summary).toMatchObject({ create: 3, units: 4, errors: 0 });
    expect(body.rows.map((r) => r.return_date)).toEqual(['2026-09-05', '2026-09-28', '2026-09-28']);
  });

  it('imports one return per request with its value, keeping rejected refunds and setting samples aside', async () => {
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS }).expect(200);
    expect(await row('4000000000000000001')).toMatchObject({
      return_date: '2026-09-05',
      order_ref: '5000000000000000001',
      sku: 'SC-1',
      quantity: 2,
      refund_value: 45.3,
      reason: 'No longer needed',
      note_clean: 'Both keep going offline',
      category: 'connectivity',
    });
    expect(await row('4000000000000000002')).toMatchObject({ status: 'Refund rejected', refund_value: 22.65, category: 'fit' });
    expect(await row('4000000000000000003')).toMatchObject({ refund_value: 0, category: 'sample' });
  });

  it('keeps buyer names out of the database', async () => {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM returns r WHERE row_to_json(r)::text LIKE '%sample_buyer_123%'");
    expect(rows[0].n).toBe(0);
  });

  it('never double counts a re-imported export', async () => {
    const { body } = await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS, dryRun: true }).expect(200);
    expect(body.summary).toMatchObject({ create: 0, duplicates: 3 });
  });
});
