import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { change, channelFigures, lastTwoComplete, productBreakdown, weeklyGroups, weekLabel, weekTotals } from '../client/src/lib/returnTrends.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

const WEEKS = [
  { week: '2026-09-14', end: '2026-09-20', partial: false },
  { week: '2026-09-21', end: '2026-09-27', partial: false },
  { week: '2026-09-28', end: '2026-10-04', partial: true },
];
const row = (o) => ({ channel: 'tiktok', product_id: 'p1', product_name: 'Sample Cam', category_key: 'connectivity', category_name: 'Connectivity', cause: 'unclear', blank: false, returns: 1, units: 1, ...o });

describe('adding up weekly returns', () => {
  const data = {
    weeks: WEEKS,
    rows: [
      row({ week: '2026-09-14', units: 2, returns: 2 }),
      row({ week: '2026-09-21', units: 6, returns: 5 }),
      row({ week: '2026-09-21', category_key: 'fit', category_name: 'Fit & Installation', cause: 'conditions', channel: 'amazon' }),
      row({ week: '2026-09-21', category_key: 'no_comment', category_name: 'No Comment', cause: null, blank: true, returns: 3, units: 3 }),
      row({ week: '2026-09-28', units: 9, returns: 9 }), // this week so far: never compared
    ],
  };

  it('compares the last two finished weeks', () => {
    expect(lastTwoComplete(WEEKS).map((w) => w.week)).toEqual(['2026-09-14', '2026-09-21']);
    expect(lastTwoComplete(WEEKS.slice(0, 1))).toEqual([undefined, WEEKS[0]]);
  });

  it('calls a rise of 3+ units and 50%+ rising', () => {
    expect(change(2, 6)).toEqual({ prev: 2, last: 6, delta: 4, pct: 200, rising: true });
    expect(change(10, 12)).toMatchObject({ delta: 2, rising: false });
    expect(change(10, 14)).toMatchObject({ pct: 40, rising: false });
    expect(change(0, 3)).toMatchObject({ pct: null, rising: true });
    expect(change(5, 1)).toMatchObject({ delta: -4, pct: -80, rising: false });
  });

  it('groups returns with a reason by category or cause, leaving out No Comment', () => {
    expect(weeklyGroups(data).map((g) => [g.key, g.prev, g.last, g.rising])).toEqual([
      ['connectivity', 2, 6, true],
      ['fit', 0, 1, false],
    ]);
    expect(weeklyGroups(data, 'cause').map((g) => [g.key, g.label, g.last])).toEqual([
      ['conditions', 'Conditions & compatibility', 1],
      ['unclear', 'Connectivity, cause unclear', 6],
    ]);
  });

  it('totals each week, with blank notes counted in returns', () => {
    expect(weekTotals(data).map((w) => [w.week, w.units, w.returns, w.blank, w.byChannel])).toEqual([
      ['2026-09-14', 2, 2, 0, { tiktok: 2 }],
      ['2026-09-21', 10, 9, 3, { tiktok: 9, amazon: 1 }],
      ['2026-09-28', 9, 9, 0, { tiktok: 9 }],
    ]);
  });

  it('sums a channel and splits products', () => {
    const tiktok = channelFigures(data.rows.filter((r) => r.channel === 'tiktok'));
    expect(tiktok).toMatchObject({ units: 20, returns: 19, shareUnits: 17, blank: 3, causes: { unclear: 17, fault: 0 } });
    expect(tiktok.categories).toEqual({ connectivity: { label: 'Connectivity', units: 17 } });
    expect(productBreakdown(data.rows)).toEqual([
      { key: 'p1', productId: 'p1', name: 'Sample Cam', units: 21, returns: 20, blank: 3, byChannel: { tiktok: 20, amazon: 1 } },
    ]);
  });

  it('labels weeks', () => {
    expect(weekLabel(WEEKS[1])).toBe('Sep 21–27');
    expect(weekLabel(WEEKS[2])).toBe('Sep 28 – Oct 4');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('the weekly returns API', () => {
  let db, editor, viewer;
  const tiktok = (n, date, note, o = {}) => ({
    'Return Order ID': `43000000000000000${n}\t`,
    'Order ID': `53000000000000000${n}\t`,
    'Seller SKU': 'SC-1',
    'Product Name': 'Sample Cam',
    'Time Requested': `${date} 10:00:00\t`,
    'Return Reason': 'Defective item',
    'Return Quantity': '1',
    'Buyer Note': note,
    ...o,
  });
  const ROWS = [
    tiktok(1, '15/09/2026', 'Keeps going offline'), // Tuesday of the week of Sep 14
    tiktok(2, '21/09/2026', 'Keeps going offline'), // Monday: first day of the week of Sep 21
    tiktok(3, '27/09/2026', ''), // Sunday: last day of the week of Sep 21, no note
    tiktok(4, '27/09/2026', '', { 'Return Reason': 'Congrats on meeting your refundable sample criteria!' }), // set aside
    tiktok(5, '28/09/2026', 'Too big for the porch light'),
  ];
  const weekly = async (q) => (await viewer.get(`/api/returns/weekly?${q}`).expect(200)).body;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' }));
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS }).expect(200);
  });
  afterAll(() => db?.end());

  it('lists Monday-to-Sunday weeks up to the given date', async () => {
    const body = await weekly('weeks=3&end=2026-10-02');
    expect(body.weeks).toEqual([
      { week: '2026-09-14', end: '2026-09-20', partial: false },
      { week: '2026-09-21', end: '2026-09-27', partial: false },
      { week: '2026-09-28', end: '2026-10-04', partial: false },
    ]);
    expect(body.latestReturn).toBe('2026-09-28');
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('marks the current MST week as partial', async () => {
    const { rows: [{ today }] } = await db.query("SELECT (now() AT TIME ZONE 'America/Phoenix')::date::text AS today");
    const body = await weekly('weeks=2');
    expect(body.today).toBe(today);
    expect(body.weeks.at(-1)).toMatchObject({ partial: true });
    expect(body.weeks.at(-1).week <= today && today <= body.weeks.at(-1).end).toBe(true);
  });

  it('puts each return in its week, with its cause and whether it has a note, leaving out samples', async () => {
    const { rows } = await weekly('weeks=3&end=2026-10-02');
    const pick = (r) => [r.week, r.category_key, r.cause, r.blank, r.units];
    expect(rows.map(pick).sort()).toEqual(
      [
        ['2026-09-14', 'connectivity', 'unclear', false, 1],
        ['2026-09-21', 'connectivity', 'unclear', false, 1],
        ['2026-09-21', 'no_comment', null, true, 1],
        ['2026-09-28', 'fit', 'conditions', false, 1],
      ].sort(),
    );
  });

  it('applies the filters, and lists returns with no note', async () => {
    expect((await weekly('weeks=3&end=2026-10-02&channel=amazon')).rows).toEqual([]);
    expect((await weekly('weeks=2&end=2026-10-02')).rows.map((r) => r.week).sort()).toEqual(['2026-09-21', '2026-09-21', '2026-09-28']);
    const { body } = await viewer.get('/api/returns?blank=1').expect(200);
    expect(body.returns.map((r) => r.return_ref)).toEqual(['430000000000000003']);
    await viewer.get('/api/returns/weekly?weeks=nonsense&end=garbage').expect(200);
  });
});
