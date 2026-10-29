import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Made-up returns for three products over a few months, to filter by several products and longer ranges.
describe.skipIf(!TEST_DATABASE_URL)('returns filters: several products and any range', () => {
  let db, viewer;
  const ids = {};

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    for (const [key, name, lifecycle] of [['door', 'Sample Doorbell', 'active'], ['bulb', 'Sample Bulb Cam', 'active'], ['flex', 'Sample Flex Cam', 'sunset']]) {
      ids[key] = (await db.query('INSERT INTO products (name, lifecycle) VALUES ($1, $2) RETURNING id', [name, lifecycle])).rows[0].id;
    }
    const add = (ref, product, date, qty = 1) =>
      db.query("INSERT INTO returns (channel, return_date, return_ref, quantity, product_id) VALUES ('amazon', $1, $2, $3, $4)", [date, ref, qty, ids[product]]);
    await add('F-1', 'door', '2026-07-10');
    await add('F-2', 'door', '2026-08-10', 2);
    await add('F-3', 'bulb', '2026-08-12');
    await add('F-4', 'flex', '2026-09-03');
    await add('F-5', 'bulb', '2026-09-20');
  });
  afterAll(() => db?.end());

  const summary = async (query) => (await viewer.get(`/api/returns/summary?${new URLSearchParams(query)}`).expect(200)).body.totals;

  it('counts any range, not just one month', async () => {
    expect(await summary({ from: '2026-07-01', to: '2026-09-30' })).toMatchObject({ reviews: 5, units: 6 });
    expect(await summary({ from: '2026-08-01', to: '2026-08-31' })).toMatchObject({ reviews: 2, units: 3 });
  });

  it('narrows to several products at once, ignoring anything that is not an ID', async () => {
    expect(await summary({ from: '2026-07-01', to: '2026-09-30', products: `${ids.door},${ids.flex}` })).toMatchObject({ reviews: 3, units: 4 });
    expect(await summary({ from: '2026-07-01', to: '2026-09-30', products: `${ids.bulb},nope` })).toMatchObject({ reviews: 2 });
    // An old single-product link still works.
    expect(await summary({ from: '2026-07-01', to: '2026-09-30', productId: ids.flex })).toMatchObject({ reviews: 1 });
  });

  it('opens one product within a product filter only when it is one of them', async () => {
    const list = async (query) => (await viewer.get(`/api/returns?${new URLSearchParams(query)}`).expect(200)).body.returns.map((r) => r.return_ref).sort();
    expect(await list({ products: `${ids.door},${ids.bulb}`, productId: ids.bulb })).toEqual(['F-3', 'F-5']);
    expect(await list({ products: `${ids.door},${ids.bulb}`, productId: ids.flex })).toEqual([]);
  });

  it('shows up to two years of weeks for a custom range', async () => {
    const { body } = await viewer.get(`/api/returns/weekly?weeks=60&end=2026-09-30&products=${ids.bulb}`).expect(200);
    expect(body.weeks).toHaveLength(60);
    expect(body.rows.reduce((n, r) => n + r.returns, 0)).toBe(2);
  });
});
