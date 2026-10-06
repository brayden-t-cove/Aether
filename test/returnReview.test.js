import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Made-up TikTok requests: one the rules place, one they can't, one with no note.
const TIKTOK = [
  { 'Return Order ID': 'RV-1', 'Product Name': 'Sample Cam', 'Return Reason': 'No longer needed', 'Buyer Note': 'Keeps going offline', 'Time Requested': '09/08/2026 10:00:00' },
  { 'Return Order ID': 'RV-2', 'Product Name': 'Sample Cam', 'Return Reason': 'No longer needed', 'Buyer Note': 'Thanks anyway', 'Time Requested': '09/09/2026 10:00:00' },
  { 'Return Order ID': 'RV-3', 'Product Name': 'Sample Cam', 'Return Reason': 'Defective item', 'Buyer Note': '', 'Time Requested': '09/10/2026 10:00:00' },
];
// A made-up Amazon return that never reached a customer: set aside, so never queued for review.
const AMAZON = [{ 'return-date': '2026-09-11T10:00:00+00:00', 'order-id': '111-9', sku: 'S-1', 'product-name': 'Sample Cam', quantity: '1', reason: 'UNDELIVERABLE_UNKNOWN', 'license-plate-number': 'LPN-RV', 'customer-comments': 'Not Compatible|Wifi' }];

describe.skipIf(!TEST_DATABASE_URL)('reviewing returns', () => {
  let db, editor, viewer;
  const idOf = async (ref) => (await db.query('SELECT id FROM returns WHERE return_ref = $1', [ref])).rows[0].id;
  const row = async (ref) =>
    (
      await db.query(
        `SELECT c.key AS category, s.key AS subreason, r.category_source, r.category_why, r.reviewed_by, r.reviewed_at
           FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id LEFT JOIN return_subreasons s ON s.id = r.subreason_id
          WHERE r.return_ref = $1`,
        [ref],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: TIKTOK }).expect(200);
    await editor.post('/api/returns/import').send({ channel: 'amazon', rows: AMAZON }).expect(200);
  });
  afterAll(() => db?.end());

  it('lists what the rules could not place on the Other page, with counts for the progress line', async () => {
    const { body } = await viewer.get('/api/returns/review').expect(200);
    expect(body.view).toBe('unsorted');
    expect(body.returns.map((r) => r.return_ref)).toEqual(['RV-2']);
    expect(body.returns[0]).toMatchObject({ note_clean: 'Thanks anyway', reason: 'No longer needed', category_key: null });
    // Two returns have a note and aren't set aside; none reviewed yet.
    expect(body.counts).toEqual({ unsorted: 1, unreviewed: 1, noted: 2, reviewed: 0 });
  });

  it('lists the rules’ calls no one has checked, leaving out blanks and set-asides', async () => {
    const { body } = await viewer.get('/api/returns/review?view=unreviewed').expect(200);
    expect(body.returns.map((r) => r.return_ref)).toEqual(['RV-1']);
    expect(body.returns[0]).toMatchObject({ category_key: 'connectivity', subreason_key: 'drops_offline', category_why: 'note matched: "keeps going off"' });
    const amazonOnly = await viewer.get('/api/returns/review?view=unreviewed&channel=amazon').expect(200);
    expect(amazonOnly.body.returns).toEqual([]);
  });

  it('lets editors file a return, and the rules never change it back', async () => {
    const id = await idOf('RV-2');
    await viewer.patch(`/api/returns/${id}/category`).send({ category: 'non_specific', subreason: 'vague' }).expect(403);
    const res = await editor.patch(`/api/returns/${id}/category`).send({ category: 'non_specific', subreason: 'vague' }).expect(200);
    expect(res.body).toEqual({ ok: true, confirmed: false });
    expect(await row('RV-2')).toMatchObject({ category: 'non_specific', subreason: 'vague', category_source: 'manual', category_why: '' });
    expect((await row('RV-2')).reviewed_at).toBeTruthy();

    await editor.post('/api/returns/sort').expect(200);
    expect(await row('RV-2')).toMatchObject({ category: 'non_specific', category_source: 'manual' });

    const { body } = await viewer.get('/api/activity').expect(200);
    expect(body.activity.find((a) => a.action === 'categorized')).toMatchObject({
      entity_type: 'return',
      entity_id: id,
      changes: { label: 'Sample Cam', from: null, to: 'Other / Vague ("doesn\'t work", "not as expected")' },
    });
  });

  it('lets editors confirm the rules’ call, keeping the reason it was made', async () => {
    const id = await idOf('RV-1');
    const res = await editor.patch(`/api/returns/${id}/category`).send({ category: 'connectivity', subreason: 'drops_offline' }).expect(200);
    expect(res.body.confirmed).toBe(true);
    expect(await row('RV-1')).toMatchObject({ category_source: 'manual', category_why: 'note matched: "keeps going off"' });

    const { body } = await viewer.get('/api/returns/review?view=unreviewed').expect(200);
    expect(body.returns).toEqual([]);
    expect(body.counts).toEqual({ unsorted: 0, unreviewed: 0, noted: 2, reviewed: 2 });
    const log = await viewer.get('/api/activity').expect(200);
    expect(log.body.activity.find((a) => a.action === 'confirmed').changes).toMatchObject({ from: 'Connectivity / Drops offline / unstable', to: 'Connectivity / Drops offline / unstable' });
  });

  it('rejects a sub-reason from another category and unknown returns', async () => {
    const id = await idOf('RV-3');
    await editor.patch(`/api/returns/${id}/category`).send({ category: 'fit', subreason: 'drops_offline' }).expect(400);
    await editor.patch(`/api/returns/${id}/category`).send({ category: 'fit' }).expect(400);
    await editor.patch('/api/returns/not-an-id/category').send({ category: 'fit', subreason: 'window' }).expect(404);
    await editor.patch('/api/returns/00000000-0000-0000-0000-000000000000/category').send({ category: 'fit', subreason: 'window' }).expect(404);
    expect(await row('RV-3')).toMatchObject({ category: 'no_comment', category_source: 'rule' });
  });
});
