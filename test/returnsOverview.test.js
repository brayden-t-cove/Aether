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
  // Two problems in one note, and one that says nothing specific.
  ret('OV-9', '09/09/2026 10:00:00', 'No longer needed', 'Too big for the porch light and it keeps going offline'),
  ret('OV-10', '10/09/2026 10:00:00', 'No longer needed', "Doesn't work"),
];

describe.skipIf(!TEST_DATABASE_URL)('the Returns overview', () => {
  let db, editor, viewer;
  const SEPT = 'from=2026-09-01&to=2026-09-30';
  const summary = async (q = SEPT) => (await viewer.get(`/api/returns/summary?${q}`).expect(200)).body;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS }).expect(200);
  });
  afterAll(() => db?.end());

  it('counts reviews, mentions, and reviews that mention more than one thing, for the month only', async () => {
    const { totals } = await summary();
    expect(totals).toMatchObject({
      reviews: 8,
      units: 9,
      noted_reviews: 7,
      blank_reviews: 1,
      generic_reviews: 1,
      no_comment_reviews: 1,
      mentions: 7,
      mentioning_reviews: 6,
      multi_reviews: 1,
    });
  });

  it('counts each mention in its bucket and sub-reason, with unfiled notes under Other', async () => {
    const { bySubreason, byCategory } = await summary();
    const of = (bucket) => bySubreason.filter((s) => s.bucket === bucket).map((s) => [s.key, s.mentions]);
    // "Too big … and it keeps going offline" counts in both Connectivity and Fit.
    expect(of('connectivity')).toEqual([['wont_connect', 1], ['drops_offline', 2]]);
    expect(of('fit')).toEqual([['fixture', 1]]);
    expect(of('changed_mind')).toEqual([['circumstances', 1]]);
    // Neither "silicone cover" note fits a rule: they wait in Other, unfiled. "Doesn't work" is Generic, not a mention.
    expect(of('non_specific')).toEqual([['unfiled', 2]]);
    expect(byCategory[0]).toEqual({ key: 'connectivity', name: 'Connectivity', mentions: 3 });
  });

  it('gives each review its platform reason and every bucket it mentions', async () => {
    const { reviewBuckets } = await summary();
    expect(reviewBuckets).toEqual(
      expect.arrayContaining([
        { reason: 'No longer needed', buckets: ['connectivity', 'fit'] },
        { reason: 'No longer needed', buckets: ['changed_mind'] },
        { reason: 'Defective item', buckets: ['connectivity'] },
      ]),
    );
    expect(reviewBuckets).toHaveLength(6);
  });

  it('gives each product its mentions, and the trend runs from an earlier month up to this one', async () => {
    const { productBuckets, byProduct, byMonth } = await summary(`${SEPT}&trendFrom=2026-01-01`);
    expect(productBuckets.find((p) => p.bucket === 'connectivity').mentions).toBe(3);
    expect(byProduct[0]).toMatchObject({ reviews: 8, units: 9, noted_reviews: 7 });
    expect(byMonth.map((m) => [m.month, m.units])).toEqual([['2026-08', 1], ['2026-09', 9]]);
  });

  it('lists the reviews that mention a bucket or sub-reason, a review under each it mentions', async () => {
    const refs = async (q) => (await viewer.get(`/api/returns?${SEPT}&${q}`).expect(200)).body.returns.map((r) => r.return_ref).sort();
    expect(await refs('bucket=connectivity')).toEqual(['OV-1', 'OV-3', 'OV-9']);
    expect(await refs('bucket=fit')).toEqual(['OV-9']);
    expect(await refs('bucket=connectivity&subreason=drops_offline')).toEqual(['OV-1', 'OV-9']);
    expect(await refs('bucket=non_specific&noted=1')).toEqual(['OV-5', 'OV-6']);
    expect(await refs('bucket=non_specific&subreason=unfiled')).toEqual(['OV-5', 'OV-6']);
    expect(await refs('bucket=generic')).toEqual(['OV-10']);
    const [r] = (await viewer.get(`/api/returns?${SEPT}&bucket=fit`)).body.returns;
    expect(r.mentions.map((m) => [m.category, m.subreason, m.why])).toEqual([
      ['connectivity', 'drops_offline', 'note matched: "keeps going off"'],
      ['fit', 'fixture', 'note matched: "too big"'],
    ]);
  });

  it('counts how many mentions a person has checked, and re-filing moves one', async () => {
    const sub = async (bucket, key) => (await summary()).bySubreason.find((s) => s.bucket === bucket && s.key === key);
    const id = async (ref) => (await db.query('SELECT id FROM returns WHERE return_ref = $1', [ref])).rows[0].id;
    expect(await sub('connectivity', 'drops_offline')).toMatchObject({ mentions: 2, checked: 0 });
    // Confirmed on the Review page, and with "Looks right" on the overview.
    await editor.patch(`/api/returns/${await id('OV-1')}/category`).send({ category: 'connectivity', subreason: 'drops_offline' }).expect(200);
    await editor.post(`/api/returns/${await id('OV-9')}/mentions`).send({ action: 'check', category: 'connectivity' }).expect(200);
    expect(await sub('connectivity', 'drops_offline')).toMatchObject({ mentions: 2, checked: 2 });
    // Re-filed: "Would not connect" was really about the mount.
    await editor.post(`/api/returns/${await id('OV-3')}/mentions`).send({ action: 'refile', category: 'connectivity', to: { category: 'fit', subreason: 'mount' } }).expect(200);
    expect(await sub('connectivity', 'wont_connect')).toBeUndefined();
    expect(await sub('fit', 'mount')).toMatchObject({ mentions: 1, checked: 1 });
    expect((await db.query("SELECT c.key FROM returns r JOIN return_categories c ON c.id = r.category_id WHERE r.return_ref = 'OV-3'")).rows[0].key).toBe('fit');
    // The rules never change what a person decided.
    await editor.post('/api/returns/sort').expect(200);
    expect(await sub('fit', 'mount')).toMatchObject({ mentions: 1, checked: 1 });
    expect(await sub('connectivity', 'wont_connect')).toBeUndefined();
  });

  it('files an unfiled or Generic note under a bucket by adding a mention', async () => {
    const id = async (ref) => (await db.query('SELECT id FROM returns WHERE return_ref = $1', [ref])).rows[0].id;
    await editor.post(`/api/returns/${await id('OV-5')}/mentions`).send({ action: 'add', to: { category: 'fit', subreason: 'environment' } }).expect(200);
    await editor.post(`/api/returns/${await id('OV-10')}/mentions`).send({ action: 'add', to: { category: 'performance', subreason: 'wont_power_on' } }).expect(200);
    const { totals } = await summary();
    expect(totals).toMatchObject({ generic_reviews: 0, unsorted_reviews: 1 });
    const cat = async (ref) => (await db.query('SELECT c.key FROM returns r JOIN return_categories c ON c.id = r.category_id WHERE r.return_ref = $1', [ref])).rows[0]?.key;
    expect(await cat('OV-5')).toBe('fit');
    expect(await cat('OV-10')).toBe('performance');
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
