import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { suggestFlags } from '../server/lib/returnRules.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe('the "points to a camera fault" flag', () => {
  it('catches notes that rule out the buyer’s setup', () => {
    for (const note of [
      'It does not stay connected and it’s 6 ft away from the router',
      'Goes offline even right next to my router',
      'My other two cameras work fine on the same network',
      'I have another camera that has no issues',
      'Called support and they said the camera was defective',
      'Tech support recommended a replacement',
    ]) {
      expect(suggestFlags(note), note).toContain('points_to_fault');
    }
  });

  it('leaves notes that say nothing about the cause', () => {
    for (const note of ['Won’t connect to my WiFi', 'Keeps going offline', 'I tried it next to the window', 'Wanted another camera instead']) {
      expect(suggestFlags(note), note).not.toContain('points_to_fault');
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)('what’s behind the returns', () => {
  let db, editor, viewer;
  // Made-up TikTok returns, one per kind of cause.
  const tiktok = (n, note, o = {}) => ({
    'Return Order ID': `42000000000000000${n}\t`,
    'Order ID': `52000000000000000${n}\t`,
    'Seller SKU': 'SC-1',
    'Product Name': 'Sample Cam',
    'Time Requested': '15/09/2026 10:00:00\t',
    'Return Reason': 'Defective item',
    'Return Quantity': '1',
    'Buyer Note': note,
    ...o,
  });
  const ROWS = [
    tiktok(1, 'It won’t turn on at all'), // hardware → fault
    tiktok(2, 'Won’t connect to my WiFi'), // connectivity, no clue → unclear
    tiktok(3, 'Keeps going offline and it’s 6 ft from the router'), // unclear, but the flag moves it to fault
    tiktok(4, 'Only works on 2.4GHz and my router is 5GHz only'), // router / ISP → conditions
    tiktok(5, 'Too big for the porch light'), // fit → conditions
    tiktok(6, 'Didn’t know a subscription was needed', { 'Return Reason': 'No longer needed' }), // no cause → other
    tiktok(7, '', { 'Return Reason': 'Congrats on meeting your refundable sample criteria!', 'Return Quantity': '2' }), // set aside
  ];
  const totals = async () => (await viewer.get('/api/returns/summary').expect(200)).body;
  const idOf = async (n) => (await db.query('SELECT id FROM returns WHERE return_ref = $1', [`42000000000000000${n}`])).rows[0].id;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS }).expect(200);
  });
  afterAll(() => db?.end());

  it('gives every connectivity, fit and performance / hardware sub-reason a cause', async () => {
    const { rows } = await db.query(
      `SELECT c.key AS category, s.key, s.cause FROM return_subreasons s JOIN return_categories c ON c.id = s.category_id
        WHERE c.key IN ('connectivity', 'fit', 'performance') AND s.key <> 'trust' ORDER BY c.sort_order, s.sort_order`,
    );
    expect(rows.filter((r) => r.cause === null)).toEqual([]);
    expect(rows.filter((r) => r.category === 'connectivity').map((r) => [r.key, r.cause])).toEqual([
      ['wont_connect', 'unclear'],
      ['drops_offline', 'unclear'],
      ['router_isp', 'conditions'],
      ['bluetooth', 'unclear'],
      ['weak_signal', 'conditions'],
      ['smart_home', 'conditions'],
    ]);
  });

  it('splits returns with a reason into fault, conditions, unclear and other, and lists what was set aside', async () => {
    const body = await totals();
    expect(body.totals).toMatchObject({ units: 6, share_units: 6, fault_units: 2, conditions_units: 2, unclear_units: 1, other_cause_units: 1, set_aside_units: 2 });
    expect(body.setAside).toEqual([{ category_key: 'sample', key: 'refundable_sample', name: 'Refundable sample', units: 2 }]);
  });

  it('moves a return between unclear and fault when a person changes the flag', async () => {
    await editor.put(`/api/returns/${await idOf(3)}/flags/points_to_fault`).send({ on: false }).expect(200);
    await editor.put(`/api/returns/${await idOf(2)}/flags/points_to_fault`).send({ on: true }).expect(200);
    await editor.post('/api/returns/sort').expect(200); // re-sorting keeps both calls
    expect((await totals()).totals).toMatchObject({ fault_units: 2, unclear_units: 1 });
    await editor.put(`/api/returns/${await idOf(2)}/flags/points_to_fault`).send({ on: false }).expect(200);
    expect((await totals()).totals).toMatchObject({ fault_units: 1, unclear_units: 2 });
  });

  it('only lets the flag move unclear returns, not ones already put down to conditions', async () => {
    await editor.put(`/api/returns/${await idOf(4)}/flags/points_to_fault`).send({ on: true }).expect(200);
    expect((await totals()).totals).toMatchObject({ fault_units: 1, conditions_units: 2 });
  });
});
