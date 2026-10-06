import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RETURN_FLAGS } from '../shared/workflow.js';
import { suggestFlags } from '../server/lib/returnRules.js';
import { listReturns } from '../server/lib/returns.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe('suggesting flags from a note', () => {
  it('spots each flag', () => {
    expect(suggestFlags('Called customer service twice and they could not fix it')).toEqual(['support_unresolved']);
    expect(suggestFlags('The ad said it records without a subscription')).toEqual(['cites_claim']);
    expect(suggestFlags('Both cameras drop offline')).toEqual(['all_units']);
    expect(suggestFlags('It has scratches and looks used')).toEqual(['looks_used']);
  });

  it('needs more than one unit, or words that say so, for "all units"', () => {
    expect(suggestFlags('Three cameras would not connect', { units: 1 })).toEqual([]);
    expect(suggestFlags('Three cameras would not connect', { units: 3 })).toEqual(['all_units']);
  });

  it('does not mistake the camera’s live view for a TikTok Live claim', () => {
    expect(suggestFlags('Live view takes forever to load')).toEqual([]);
    expect(suggestFlags('The host on the TikTok Live said it works outside')).toEqual(['cites_claim']);
    expect(suggestFlags('This was supposed to be a camera with no fees. Marketing fraud')).toEqual(['cites_claim']);
  });

  it('suggests nothing for an empty note', () => {
    expect(suggestFlags('')).toEqual([]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('flags and secondary categories on returns', () => {
  let db, editor, viewer;
  // Made-up TikTok requests.
  const TIKTOK = [
    { 'Return Order ID': 'FL-1', 'Product Name': 'Sample Cam', 'Return Reason': 'Defective item', 'Buyer Note': 'Support could not help, both cameras keep going offline', 'Return Quantity': '2', 'Time Requested': '09/08/2026 10:00:00' },
    { 'Return Order ID': 'FL-2', 'Product Name': 'Sample Cam', 'Return Reason': 'No longer needed', 'Buyer Note': 'Too big for the porch light', 'Time Requested': '09/09/2026 10:00:00' },
  ];
  const idOf = async (ref) => (await db.query('SELECT id FROM returns WHERE return_ref = $1', [ref])).rows[0].id;
  const flagsOf = async (ref) => (await listReturns(db)).find((r) => r.return_ref === ref).flags;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: TIKTOK }).expect(200);
  });
  afterAll(() => db?.end());

  it('uses the same flag keys in the database and the app', async () => {
    const id = await idOf('FL-2');
    for (const flag of Object.keys(RETURN_FLAGS)) {
      await db.query("INSERT INTO return_flags (return_id, flag, source, active) VALUES ($1, $2, 'manual', false)", [id, flag]);
    }
    await expect(db.query("INSERT INTO return_flags (return_id, flag, source) VALUES ($1, 'bogus', 'rule')", [id])).rejects.toThrow(/check constraint/);
    await db.query('DELETE FROM return_flags WHERE return_id = $1', [id]);
  });

  it('flags returns as they are imported', async () => {
    expect(await flagsOf('FL-1')).toEqual(['all_units', 'support_unresolved']);
    expect(await flagsOf('FL-2')).toEqual([]);
    const { body } = await viewer.get('/api/activity').expect(200);
    expect(body.activity.find((a) => a.action === 'imported').changes).toMatchObject({ sorted: 2, unsorted: 0, flagged: 1 });
  });

  it('lets editors turn flags on and off, and re-sorting keeps their call', async () => {
    const id = await idOf('FL-1');
    await viewer.put(`/api/returns/${id}/flags/all_units`).send({ on: false }).expect(403);
    await editor.put(`/api/returns/${id}/flags/all_units`).send({ on: false }).expect(200);
    await editor.put(`/api/returns/${id}/flags/cites_claim`).send({ on: true }).expect(200);
    await editor.post('/api/returns/sort').expect(200);
    expect(await flagsOf('FL-1')).toEqual(['cites_claim', 'support_unresolved']);

    await editor.put(`/api/returns/${id}/flags/nope`).send({ on: true }).expect(404);
    await editor.put(`/api/returns/${id}/flags/looks_used`).send({ on: 'yes' }).expect(400);
    await editor.put('/api/returns/00000000-0000-0000-0000-000000000000/flags/looks_used').send({ on: true }).expect(404);

    const { body } = await viewer.get('/api/activity').expect(200);
    expect(body.activity.find((a) => a.action === 'flag_removed').changes).toEqual({ label: 'Sample Cam', flag: 'Multi-unit / all units affected' });
    expect(body.activity.find((a) => a.action === 'flag_added').changes.flag).toBe('Cites listing / Live / ad claim');
  });

  it('filters the review lists and the returns list by flag', async () => {
    const { body } = await viewer.get('/api/returns/review?view=unreviewed&flag=support_unresolved').expect(200);
    expect(body.returns.map((r) => r.return_ref)).toEqual(['FL-1']);
    expect(body.returns[0].flags).toEqual(['cites_claim', 'support_unresolved']);
    const all = await viewer.get('/api/returns?flag=looks_used').expect(200);
    expect(all.body.returns).toEqual([]);
  });

  it('records other problems the buyer mentions, never the main category', async () => {
    const id = await idOf('FL-2'); // main category: Fit & Installation
    await viewer.put(`/api/returns/${id}/secondary`).send({ categories: ['performance'] }).expect(403);
    const res = await editor.put(`/api/returns/${id}/secondary`).send({ categories: ['performance', 'fit', 'no_comment', 'performance'] }).expect(200);
    expect(res.body.secondary).toEqual(['Performance / Hardware']);
    expect((await listReturns(db)).find((r) => r.return_ref === 'FL-2').secondary).toEqual(['performance']);

    await editor.put(`/api/returns/${id}/secondary`).send({ categories: ['made_up'] }).expect(400);
    await editor.put(`/api/returns/${id}/secondary`).send({ categories: 'performance' }).expect(400);
    await editor.put(`/api/returns/${id}/secondary`).send({ categories: [] }).expect(200);
    expect((await listReturns(db)).find((r) => r.return_ref === 'FL-2').secondary).toEqual([]);

    const { body } = await viewer.get('/api/activity').expect(200);
    expect(body.activity.filter((a) => a.action === 'secondary_updated').map((a) => a.changes.categories)).toEqual([[], ['Performance / Hardware']]);
  });
});
