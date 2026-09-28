import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyReason, parseReportDate } from '../server/lib/returnsImport.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Shaped like Amazon's FBA customer returns report (headers as Amazon writes them).
const AMAZON = [
  { 'return-date': '2026-08-03T10:12:00+00:00', 'order-id': '111-1', sku: 'DB-PRO', asin: 'B0DBPRO', 'product-name': 'Luna Doorbell Cam Pro 2K', quantity: '1', reason: 'DEFECTIVE', 'license-plate-number': 'LPN1', 'customer-comments': 'Stopped connecting' },
  { 'return-date': '2026-08-15T10:12:00+00:00', 'order-id': '111-2', sku: 'DB-PRO', asin: 'B0DBPRO', 'product-name': 'Luna Doorbell Cam Pro 2K', quantity: '2', reason: 'UNWANTED_ITEM', 'license-plate-number': 'LPN2' },
  { 'return-date': '2026-09-02T10:12:00+00:00', 'order-id': '111-3', sku: 'X-UNKNOWN', asin: 'B0MYSTERY', 'product-name': 'Mystery gadget', quantity: '1', reason: 'DAMAGED_BY_CARRIER', 'license-plate-number': 'LPN3' },
  { 'return-date': '', 'order-id': '111-4', sku: 'DB-PRO', quantity: '1', reason: 'DEFECTIVE' },
  { 'return-date': '2026-09-05', 'order-id': '111-5', sku: 'W4-SKU', 'product-name': 'Luna W4 window camera', quantity: '1', reason: 'NOT_AS_DESCRIBED', 'license-plate-number': 'LPN5' },
];

// Shaped like a TikTok Shop returns export: free-text reasons, no license plate.
const TIKTOK = [
  { 'Order ID': 'TT-1', 'Return Order ID': 'R-1', 'Product Name': 'Luna Doorbell Cam Pro', 'Seller SKU': 'DB-PRO', Quantity: '1', 'Return Reason': "Product doesn't work", 'Time Requested': '09/10/2026 08:00:00' },
  { 'Order ID': 'TT-2', 'Return Order ID': 'R-2', 'Product Name': 'Luna Doorbell Cam Pro', 'Seller SKU': 'DB-PRO', Quantity: '1', 'Return Reason': 'No longer needed', 'Time Requested': '09/12/2026 08:00:00' },
];

describe('returns parsing helpers', () => {
  it('reads the date formats marketplaces use', () => {
    expect(parseReportDate('2026-08-03T10:12:00+00:00')).toBe('2026-08-03');
    expect(parseReportDate('09/10/2026 08:00:00')).toBe('2026-09-10');
    expect(parseReportDate('2026/9/1')).toBe('2026-09-01');
    expect(parseReportDate('2026-02-30')).toBeNull();
    expect(parseReportDate('--')).toBeNull();
  });

  it('groups Amazon codes and free-text reasons', () => {
    expect(classifyReason('DEFECTIVE')).toEqual({ reason_code: 'DEFECTIVE', reason: 'Defective / does not work', reason_group: 'defect' });
    expect(classifyReason("Product doesn't work").reason_group).toBe('defect');
    expect(classifyReason('Arrived damaged').reason_group).toBe('shipping');
    expect(classifyReason('No longer needed').reason_group).toBe('changed_mind');
    expect(classifyReason('Not compatible with my phone').reason_group).toBe('not_as_described');
    expect(classifyReason('SOME_NEW_CODE')).toMatchObject({ reason: 'Some new code', reason_group: 'other' });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('phase 4: listings, returns, comparisons', () => {
  let db, app, admin, ecom, viewer, doorbell, w4, market;

  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    ecom = await signedInAgent(app, db, { email: 'ecom@lunahome.com', role: 'editor', name: 'Ecom' });
    viewer = await signedInAgent(app, db, { email: 'boss@lunahome.com', role: 'viewer' });
    ({ body: { product: doorbell } } = await ecom.agent.post('/api/products').send({ name: 'Doorbell Cam Pro', model: 'R8411', lifecycle: 'active' }));
    ({ body: { product: w4 } } = await ecom.agent.post('/api/products').send({ name: 'Window Camera', model: 'W4', lifecycle: 'active' }));
    market = Object.fromEntries((await viewer.agent.get('/api/markets')).body.markets.map((m) => [m.code, m]));
  });
  afterAll(() => db?.end());

  describe('listings', () => {
    it('tracks listings per channel and market, with unique listing IDs', async () => {
      await viewer.agent.post(`/api/products/${doorbell.id}/listings`).send({ channel: 'amazon' }).expect(403);
      const { body } = await ecom.agent
        .post(`/api/products/${doorbell.id}/listings`)
        .send({ channel: 'amazon', market_id: market.US.id, external_id: 'B0DBPRO', sku: 'DB-PRO', state: 'live', url: 'https://amazon.com/dp/B0DBPRO' })
        .expect(201);
      await ecom.agent.post(`/api/products/${w4.id}/listings`).send({ channel: 'amazon', external_id: 'b0dbpro' }).expect(409);
      await ecom.agent.post(`/api/products/${doorbell.id}/listings`).send({ channel: 'ebay' }).expect(400);
      await ecom.agent.patch(`/api/listings/${body.listing.id}`).send({ state: 'paused' }).expect(200);
      const { body: list } = await viewer.agent.get(`/api/products/${doorbell.id}/listings`);
      expect(list.listings).toEqual([expect.objectContaining({ state: 'paused', market_code: 'US' })]);
      await ecom.agent.patch(`/api/listings/${body.listing.id}`).send({ state: 'live' }).expect(200);
    });
  });

  describe('returns import', () => {
    it('previews Amazon rows: matches by listing, model and SKU, flags errors, writes nothing', async () => {
      await viewer.agent.post('/api/returns/import').send({ channel: 'amazon', rows: AMAZON, dryRun: true }).expect(403);
      const { body } = await ecom.agent.post('/api/returns/import').send({ channel: 'amazon', market_id: market.US.id, rows: AMAZON, dryRun: true }).expect(200);
      expect(body.summary).toEqual({ rows: 5, create: 4, units: 5, duplicates: 0, errors: 1, unmatched: 1 });
      expect(body.rows.find((r) => r.line === 5)).toMatchObject({ action: 'error', error: expect.stringMatching(/date/) });
      expect(body.rows.find((r) => r.line === 6)).toMatchObject({ product_name: 'Window Camera' }); // matched by model W4 in the name
      expect(body.unmatched).toEqual([expect.objectContaining({ external_id: 'B0MYSTERY', units: 1 })]);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM returns');
      expect(rows[0].n).toBe(0);
    });

    it('imports, and never double counts a re-imported report', async () => {
      const { body } = await ecom.agent.post('/api/returns/import').send({ channel: 'amazon', market_id: market.US.id, rows: AMAZON, filename: 'aug.tsv' }).expect(200);
      expect(body.import).toMatchObject({ created_count: 4, duplicate_count: 0, unmatched_count: 1, filename: 'aug.tsv' });

      const { body: again } = await ecom.agent.post('/api/returns/import').send({ channel: 'amazon', rows: AMAZON, dryRun: true }).expect(200);
      expect(again.summary).toMatchObject({ create: 0, duplicates: 4 });

      const { body: tt } = await ecom.agent.post('/api/returns/import').send({ channel: 'tiktok', rows: TIKTOK }).expect(200);
      expect(tt.import.created_count).toBe(2);
      const { body: tt2 } = await ecom.agent.post('/api/returns/import').send({ channel: 'tiktok', rows: TIKTOK }).expect(200);
      expect(tt2.import.created_count).toBe(0);
    });

    it('summarises returns by month, channel, reason and product', async () => {
      const { body } = await viewer.agent.get('/api/returns/summary').expect(200);
      expect(body.totals).toMatchObject({ units: 7, lines: 6, unmatched_units: 1, defect_units: 2, first_date: '2026-08-03', last_date: '2026-09-12' });
      expect(body.byMonth).toEqual([
        { month: '2026-08', channel: 'amazon', units: 3 },
        { month: '2026-09', channel: 'amazon', units: 2 },
        { month: '2026-09', channel: 'tiktok', units: 2 },
      ]);
      const top = body.byProduct[0];
      expect(top).toMatchObject({ product_id: doorbell.id, name: 'Doorbell Cam Pro', units: 5, defect_units: 2 });
      expect(body.byGroup.find((g) => g.group === 'changed_mind').units).toBe(3);

      const { body: sept } = await viewer.agent.get(`/api/returns/summary?from=2026-09-01&to=2026-09-30&channel=tiktok`).expect(200);
      expect(sept.totals.units).toBe(2);
      const { body: prod } = await viewer.agent.get(`/api/returns/summary?productId=${w4.id}`);
      expect(prod.topReasons).toEqual([expect.objectContaining({ reason_code: 'NOT_AS_DESCRIBED', units: 1 })]);
      await viewer.agent.get('/api/returns/summary?from=garbage&channel=nope').expect(200);
    });

    it('assigns unmatched returns to a product and remembers the match', async () => {
      const { body } = await viewer.agent.get('/api/returns/unmatched').expect(200);
      expect(body.unmatched).toEqual([expect.objectContaining({ channel: 'amazon', external_id: 'B0MYSTERY', units: 1 })]);
      const { body: done } = await ecom.agent.post('/api/returns/assign').send({ channel: 'amazon', external_id: 'B0MYSTERY', product_id: w4.id }).expect(200);
      expect(done.assigned).toBe(1);
      const { body: listings } = await viewer.agent.get(`/api/products/${w4.id}/listings`);
      expect(listings.listings.map((l) => l.external_id)).toContain('B0MYSTERY');
      expect((await viewer.agent.get('/api/returns/unmatched')).body.unmatched).toEqual([]);
    });

    it('lets admins undo an import', async () => {
      const { body } = await viewer.agent.get('/api/returns/imports');
      const tiktokImport = body.imports.find((i) => i.channel === 'tiktok' && i.created_count === 2);
      await ecom.agent.delete(`/api/returns/imports/${tiktokImport.id}`).expect(403);
      await admin.agent.delete(`/api/returns/imports/${tiktokImport.id}`).expect(200);
      const { body: s } = await viewer.agent.get('/api/returns/summary');
      expect(s.totals.units).toBe(5);
    });
  });

  describe('comparisons', () => {
    let grid;

    it('creates a comparison with starter rows and competitor columns', async () => {
      await viewer.agent.post('/api/comparisons').send({ name: 'x' }).expect(403);
      const { body } = await ecom.agent.post('/api/comparisons').send({ name: 'Doorbells 2026', product_id: doorbell.id }).expect(201);
      grid = body;
      expect(grid.comparison).toMatchObject({ name: 'Doorbells 2026', product_name: 'Doorbell Cam Pro' });
      expect(grid.attributes.map((a) => a.name)).toContain('Price');

      const { body: withRing } = await ecom.agent
        .post(`/api/comparisons/${grid.comparison.id}/competitors`)
        .send({ brand: 'Ring', name: 'Battery Doorbell', price: '$99.99', url: 'https://ring.example' })
        .expect(201);
      expect(withRing.competitors).toEqual([expect.objectContaining({ brand: 'Ring', price: '99.99' })]);
      await ecom.agent.post('/api/competitors').send({ brand: 'ring', name: 'battery doorbell' }).expect(409);
      await ecom.agent.post('/api/competitors').send({ brand: 'Wyze', name: 'Video Doorbell v2', price: 'cheap' }).expect(400);
      const { body: wyze } = await ecom.agent.post('/api/competitors').send({ brand: 'Wyze', name: 'Video Doorbell v2', price: 69 }).expect(201);
      const { body: both } = await ecom.agent.post(`/api/comparisons/${grid.comparison.id}/competitors`).send({ competitor_id: wyze.competitor.id }).expect(201);
      grid = both;
      expect(grid.competitors.map((c) => c.brand)).toEqual(['Ring', 'Wyze']);
    });

    it('fills cells for Luna and each competitor, and edits rows', async () => {
      const price = grid.attributes.find((a) => a.name === 'Price');
      const [ring] = grid.competitors;
      await ecom.agent.put(`/api/comparisons/${grid.comparison.id}/values`).send({ attribute_id: price.id, competitor_id: null, value: '$79.99' }).expect(200);
      await ecom.agent.put(`/api/comparisons/${grid.comparison.id}/values`).send({ attribute_id: price.id, competitor_id: ring.id, value: '$99.99' }).expect(200);
      await ecom.agent.put(`/api/comparisons/${grid.comparison.id}/values`).send({ attribute_id: price.id, competitor_id: null, value: '$74.99' }).expect(200);

      const { body: other } = await ecom.agent.post('/api/comparisons').send({ name: 'Other', starter_attributes: false }).expect(201);
      expect(other.attributes).toEqual([]);
      await ecom.agent.put(`/api/comparisons/${other.comparison.id}/values`).send({ attribute_id: price.id, value: 'x' }).expect(400);

      await ecom.agent.post(`/api/comparisons/${grid.comparison.id}/attributes`).send({ name: 'Works with Alexa' }).expect(201);
      await ecom.agent.post(`/api/comparisons/${grid.comparison.id}/attributes`).send({ name: 'works with alexa' }).expect(409);

      const { body } = await viewer.agent.get(`/api/comparisons/${grid.comparison.id}`).expect(200);
      const cells = body.values.filter((v) => v.attribute_id === price.id);
      expect(cells).toEqual(expect.arrayContaining([
        { attribute_id: price.id, competitor_id: null, value: '$74.99' },
        { attribute_id: price.id, competitor_id: ring.id, value: '$99.99' },
      ]));
      expect(body.activity.some((a) => a.action === 'value_updated')).toBe(true);

      const { body: removed } = await ecom.agent.delete(`/api/comparisons/${grid.comparison.id}/competitors/${ring.id}`).expect(200);
      expect(removed.competitors.map((c) => c.brand)).toEqual(['Wyze']);
      expect(removed.values.some((v) => v.competitor_id === ring.id)).toBe(false);
    });
  });
});
