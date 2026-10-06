import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractMatches, unmatchedReason } from '../client/src/lib/matchWorkbook.js';
import { confidenceKey } from '../server/lib/returnMatches.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe('reading the customer-match workbook', () => {
  // Shaped like the workbook: a title sheet, a matches tab with a confidence per customer checked, and an unmatched tab.
  const sheets = [
    { sheet: 'Summary', data: [['TikTok returns → customer contact match'], ['Total', 4]] },
    {
      sheet: 'Return Matches',
      data: [
        ['Return Requested', 'Return Reason', 'Buyer Note', 'Match Confidence', 'Customer Name', 'Customer Phone', 'Return Order ID'],
        ['2026-09-01 08:00', 'Defective item', 'Offline', 'Low', 'Sample Person', '000-000-0000', '4100000000000000001'],
        ['2026-09-01 08:00', 'Defective item', 'Offline', 'High', 'Other Person', '000-000-0001', '4100000000000000001'],
        ['2026-09-02 08:00', 'No longer needed', '', 'Medium', 'Third Person', '', ' 4100000000000000002 '],
        ['', '', '', 'High', '', '', ''],
      ],
    },
    {
      sheet: 'Unmatched Returns',
      data: [
        ['Title row'],
        ['Return Requested', 'Return Order ID', 'Match Status'],
        ['2026-09-03', '4100000000000000003', 'No activation found for zip'],
        ['2026-09-04', '4100000000000000005', 'Order not found in Shopify export'],
      ],
    },
    { sheet: 'Notes', data: [['Return Order ID', 'Comment'], ['4100000000000000004', 'no confidence column here']] },
  ];

  it('keeps only return IDs and confidences, from the tabs that have them', () => {
    const { matches, used } = extractMatches(sheets);
    expect(matches).toEqual([
      { return_ref: '4100000000000000001', confidence: 'Low' },
      { return_ref: '4100000000000000001', confidence: 'High' },
      { return_ref: '4100000000000000002', confidence: 'Medium' },
      { return_ref: '4100000000000000003', confidence: 'unmatched', unmatched_reason: 'no_activation' },
      { return_ref: '4100000000000000005', confidence: 'unmatched', unmatched_reason: 'order_not_found' },
    ]);
    expect(used).toEqual([
      { sheet: 'Return Matches', rows: 3 },
      { sheet: 'Unmatched Returns', rows: 2 },
    ]);
    expect(JSON.stringify(matches)).not.toMatch(/Person|000-000/);
  });

  it('skips and counts IDs Excel stored as numbers and rounded', () => {
    const { matches, rounded } = extractMatches([
      {
        sheet: 'Return Matches',
        data: [
          ['Return Order ID', 'Match Confidence'],
          [Number('4100000000000000001'), 'High'],
          ['4100000000000000002', 'Medium'],
          [12345, 'Low'],
        ],
      },
    ]);
    expect(rounded).toBe(1);
    expect(matches.map((m) => m.return_ref)).toEqual(['4100000000000000002', '12345']);
  });

  it('reads why a return was unmatched', () => {
    expect(unmatchedReason('No activation found for zip')).toBe('no_activation');
    expect(unmatchedReason('Order not found in Shopify export')).toBe('order_not_found');
    expect(unmatchedReason('')).toBeNull();
  });

  it('reads confidence words loosely', () => {
    expect(confidenceKey(' High ')).toBe('high');
    expect(confidenceKey('MEDIUM')).toBe('medium');
    expect(confidenceKey('Unmatched')).toBe('unmatched');
    expect(confidenceKey('maybe')).toBeNull();
    expect(confidenceKey('toString')).toBeNull();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('match confidence on the Returns page', () => {
  let db, editor, viewer;
  const ref = (n) => `41000000000000000${String(n).padStart(2, '0')}`;
  // Made-up TikTok returns: two product problems, a fit problem, one with no note, and a sample.
  const tiktok = (n, o) => ({
    'Return Order ID': `${ref(n)}\t`,
    'Order ID': `51000000000000000${n}\t`,
    'Seller SKU': 'SC-1',
    'Product Name': 'Sample Cam',
    'Time Requested': '15/09/2026 10:00:00\t',
    'Return Reason': 'Defective item',
    'Return Quantity': '1',
    'Buyer Note': '',
    ...o,
  });
  const TIKTOK = [
    tiktok(1, { 'Buyer Note': 'Keeps going offline' }),
    tiktok(2, { 'Return Reason': 'No longer needed', 'Buyer Note': 'Too big for the porch light' }),
    tiktok(3, { 'Buyer Note': 'It keeps going offline every night' }),
    tiktok(4, { 'Return Reason': 'No longer needed' }),
    tiktok(5, { 'Return Reason': 'Congrats on meeting your refundable sample criteria!' }),
  ];
  const AMAZON = [
    { 'return-date': '2026-09-16', 'order-id': '111-9', sku: 'SC-1', 'product-name': 'Sample Cam', quantity: '1', reason: 'QUALITY_UNACCEPTABLE', 'license-plate-number': 'LPN9', 'customer-comments': 'The picture is blurry at night' },
  ];
  const MATCHES = [
    { return_ref: ref(1), confidence: 'Low' },
    { return_ref: ref(1), confidence: 'High' }, // listed again for another customer: the strongest wins
    { return_ref: ref(2), confidence: 'Low' },
    { return_ref: ref(3), confidence: 'unmatched' },
    { return_ref: ref(4), confidence: 'Medium' },
    { return_ref: ref(99), confidence: 'Medium' }, // not imported from TikTok yet
    { return_ref: ref(6), confidence: 'maybe' },
    { return_ref: '', confidence: 'High' },
  ];
  const summary = async (q = '') => (await viewer.get(`/api/returns/summary?${q}`).expect(200)).body.totals;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: TIKTOK }).expect(200);
    await editor.post('/api/returns/import').send({ channel: 'amazon', rows: AMAZON }).expect(200);
  });
  afterAll(() => db?.end());

  it('counts categories from the notes, leaving out samples', async () => {
    expect(await summary()).toMatchObject({ units: 5, set_aside_units: 1, share_units: 4, fault_units: 1, unclear_units: 2, conditions_units: 1, no_comment_units: 1, unsorted_units: 0 });
    const { body } = await viewer.get('/api/returns/summary').expect(200);
    expect(body.byCategory.map((c) => [c.key, c.units])).toEqual([
      ['connectivity', 2],
      ['fit', 1],
      ['performance', 1],
    ]);
  });

  it('previews an upload without saving it', async () => {
    await viewer.post('/api/returns/matches').send({ channel: 'tiktok', matches: MATCHES }).expect(403);
    await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: [] }).expect(400);
    await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: [{ return_ref: ref(1), confidence: 'maybe' }] }).expect(400);
    const { body } = await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: MATCHES, dryRun: true }).expect(200);
    expect(body.summary).toEqual({
      rows: 8,
      returns: 5,
      invalid: 2,
      byConfidence: { high: 1, medium: 2, low: 1, unmatched: 1 },
      noActivation: 0,
      added: 5,
      changed: 0,
      unchanged: 0,
      notImported: 1,
    });
    expect((await db.query('SELECT count(*)::int AS n FROM return_matches')).rows[0].n).toBe(0);
  });

  it('saves matches, logs the upload, and hides Low and unmatched returns on request', async () => {
    await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: MATCHES, filename: 'matches.xlsx' }).expect(200);
    const { rows } = await db.query("SELECT return_ref, confidence FROM return_matches WHERE return_ref = $1", [ref(1)]);
    expect(rows).toEqual([{ return_ref: ref(1), confidence: 'high' }]);
    const { rows: log } = await db.query("SELECT changes FROM activity_log WHERE action = 'matches_uploaded'");
    expect(log[0].changes).toMatchObject({ label: 'matches.xlsx', added: 5, changed: 0, high: 1, low: 1 });

    const { body: overview } = await viewer.get('/api/returns/matches').expect(200);
    expect(overview.matches.find((m) => m.confidence === 'medium')).toMatchObject({ channel: 'tiktok', returns: 2, imported: 1 });

    // All returns: unchanged. Strong matches: the Low (fit) and unmatched (offline) TikTok returns drop out; Amazon has no rating and stays.
    expect(await summary('match=all')).toMatchObject({ units: 5, share_units: 4, fault_units: 1, unclear_units: 2 });
    expect(await summary('match=strong')).toMatchObject({ units: 3, share_units: 2, fault_units: 1, unclear_units: 1, conditions_units: 0, no_comment_units: 1 });
    expect(await summary('match=strong&channel=amazon')).toMatchObject({ units: 1 });
    expect(await summary('match=nonsense')).toMatchObject({ units: 5 });
  });

  it('replaces a confidence when a newer workbook rates the return differently', async () => {
    const { body } = await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: [...MATCHES, { return_ref: ref(2), confidence: 'High' }] }).expect(200);
    expect(body.summary).toMatchObject({ added: 0, changed: 1, unchanged: 4 });
    expect(await summary('match=strong')).toMatchObject({ units: 4, share_units: 3 });
  });
  it('keeps unmatched returns where no camera went online, and splits unclear connectivity by activation', async () => {
    // Return 3 ("keeps going offline", unclear) turns out to have no activation in the buyer's zip.
    await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: [{ return_ref: ref(3), confidence: 'Unmatched', unmatched_reason: 'no_activation' }] }).expect(200);
    const strong = await summary('match=strong');
    expect(strong).toMatchObject({ units: 5, unclear_units: 2, unclear_online_units: 1, unclear_never_units: 1 });
    // A reason only belongs to an unmatched return.
    const { body } = await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: [{ return_ref: ref(4), confidence: 'Medium', unmatched_reason: 'no_activation' }], dryRun: true }).expect(200);
    expect(body.summary).toMatchObject({ noActivation: 0, unchanged: 1 });
    // Order not found says nothing, so it is hidden like a Low match.
    await editor.post('/api/returns/matches').send({ channel: 'tiktok', matches: [{ return_ref: ref(3), confidence: 'unmatched', unmatched_reason: 'order_not_found' }] }).expect(200);
    expect(await summary('match=strong')).toMatchObject({ units: 4, unclear_units: 1, unclear_never_units: 0 });
    // With no activation data, the page says why: a weak match here, and once the workbook doesn't list it, "not in the workbook yet".
    expect(await summary('match=all')).toMatchObject({ unclear_units: 2, unclear_online_units: 1, unclear_not_tiktok_units: 0, unclear_not_in_workbook_units: 0 });
    await db.query('DELETE FROM return_matches WHERE return_ref = $1', [ref(3)]);
    expect(await summary('match=all')).toMatchObject({ unclear_units: 2, unclear_not_in_workbook_units: 1 });
  });
});
