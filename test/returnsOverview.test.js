import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedBuckets } from '../shared/returnBuckets.js';
import { commonPhrases } from '../client/src/lib/phrases.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe('platform reasons and buckets', () => {
  it('says which buckets a platform reason points to', () => {
    expect(expectedBuckets('No longer needed')).toEqual(['changed_mind']);
    expect(expectedBuckets('Defective item')).toEqual(['performance', 'connectivity']);
    expect(expectedBuckets("Product wouldn't arrive on time")).toEqual(['shipping']);
    expect(expectedBuckets("Item doesn't match description")).toEqual([]);
    expect(expectedBuckets('Something new TikTok added')).toEqual([]);
  });
});

describe('what keeps coming up in Other', () => {
  it('finds phrases and words used in more than one note, phrases first', () => {
    const notes = [
      'I wish it had a silicone cover like my phone',
      'Needs a silicone cover for the rain',
      'A rain cover would help',
      'Too bright at night',
    ];
    expect(commonPhrases(notes)).toEqual([
      { phrase: 'cover', count: 3 },
      { phrase: 'silicone cover', count: 2 },
      { phrase: 'rain', count: 2 },
    ]);
    expect(commonPhrases(['one note only'])).toEqual([]);
  });
});

// Made-up TikTok returns for September and October.
const ret = (ref, date, reason, note, extra = {}) => ({
  'Return Order ID': ref,
  'Order ID': `O-${ref}`,
  'Seller SKU': 'SC-1',
  'Product Name': 'Sample Cam',
  'Return Quantity': '1',
  'Return Reason': reason,
  'Time Requested': date,
  'Buyer Note': note,
  ...extra,
});
const ROWS = [
  ret('OV-1', '03/09/2026 10:00:00', 'No longer needed', 'It keeps going offline every night'),
  ret('OV-2', '04/09/2026 10:00:00', 'No longer needed', 'Changed my mind, no longer needed'),
  ret('OV-3', '05/09/2026 10:00:00', 'Defective item', 'Would not connect to wifi'),
  ret('OV-4', '06/09/2026 10:00:00', 'No longer needed', ''),
  ret('OV-5', '07/09/2026 10:00:00', 'No longer needed', 'I wish it had a silicone cover'),
  ret('OV-6', '08/09/2026 10:00:00', "Item doesn't match description", 'The silicone cover was missing from the photos', { 'Return Quantity': '2' }),
  ret('OV-7', '02/10/2026 10:00:00', 'Defective item', 'Would not connect to wifi'),
  ret('OV-8', '20/08/2026 10:00:00', 'Defective item', 'Would not connect to wifi'),
];

describe.skipIf(!TEST_DATABASE_URL)('the Returns overview', () => {
  let db, editor, viewer;
  const SEPT = 'from=2026-09-01&to=2026-09-30&match=all';
  const summary = async (q = SEPT) => (await viewer.get(`/api/returns/summary?${q}`).expect(200)).body;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS }).expect(200);
  });
  afterAll(() => db?.end());

  it('counts returns with a comment and without, for the month only', async () => {
    const { totals } = await summary();
    expect(totals).toMatchObject({ units: 7, noted_units: 6, blank_units: 1 });
  });

  it('breaks the buckets down by sub-reason, with unfiled notes under Other', async () => {
    const { bySubreason } = await summary();
    const of = (bucket) => bySubreason.filter((s) => s.bucket === bucket).map((s) => [s.key, s.units]);
    expect(of('connectivity')).toEqual([['wont_connect', 1], ['drops_offline', 1]]);
    expect(of('changed_mind')).toEqual([['circumstances', 1]]);
    // Neither "silicone cover" note fits a rule: they wait in Other, unfiled.
    expect(of('non_specific')).toEqual([[null, 3]]);
  });

  it('pairs the platform reason with the bucket the note landed in', async () => {
    const { reasonVsBucket } = await summary();
    expect(reasonVsBucket).toEqual(
      expect.arrayContaining([
        { reason: 'No longer needed', bucket: 'connectivity', units: 1 },
        { reason: 'No longer needed', bucket: 'changed_mind', units: 1 },
        { reason: 'Defective item', bucket: 'connectivity', units: 1 },
      ]),
    );
    expect(reasonVsBucket.some((r) => r.bucket === 'no_comment')).toBe(false);
  });

  it('gives each product its buckets, and the trend runs from an earlier month up to this one', async () => {
    const { productBuckets, byProduct, byMonth } = await summary(`${SEPT}&trendFrom=2026-01-01`);
    expect(productBuckets.find((p) => p.bucket === 'connectivity').units).toBe(2);
    expect(byProduct[0]).toMatchObject({ units: 7, noted_units: 6 });
    expect(byMonth.map((m) => [m.month, m.units])).toEqual([['2026-08', 1], ['2026-09', 7]]);
  });

  it('lists a bucket’s notes, Other including those not filed yet', async () => {
    const { body } = await viewer.get(`/api/returns?${SEPT}&bucket=non_specific&noted=1`).expect(200);
    expect(body.returns.map((r) => r.return_ref).sort()).toEqual(['OV-5', 'OV-6']);
    const { body: conn } = await viewer.get(`/api/returns?${SEPT}&bucket=connectivity`).expect(200);
    expect(conn.returns.map((r) => r.return_ref).sort()).toEqual(['OV-1', 'OV-3']);
  });

  it('lets editors change a bucket’s definition, and logs it', async () => {
    await viewer.patch('/api/returns/categories/fit').send({ description: 'Nope' }).expect(403);
    await editor.patch('/api/returns/categories/made_up').send({ description: 'Nope' }).expect(404);
    const { body } = await editor.patch('/api/returns/categories/fit').send({ description: 'Doesn’t suit the home.' }).expect(200);
    expect(body.category).toMatchObject({ key: 'fit', description: 'Doesn’t suit the home.' });
    const { body: codebook } = await viewer.get('/api/returns/codebook');
    expect(codebook.categories.find((c) => c.key === 'fit').description).toBe('Doesn’t suit the home.');
    const { rows } = await db.query("SELECT entity_id, changes FROM activity_log WHERE action = 'definition_updated'");
    expect(rows).toEqual([{ entity_id: 'fit', changes: expect.objectContaining({ label: 'Fit & Installation', to: 'Doesn’t suit the home.' }) }]);
  });
});
