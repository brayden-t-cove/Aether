import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCodebook } from '../server/lib/returnCodebook.js';
import { listReturns } from '../server/lib/returns.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('returns codebook', () => {
  let db, app, codebook;
  const category = (key) => codebook.find((c) => c.key === key);
  const subreason = (categoryKey, key) => category(categoryKey).subreasons.find((s) => s.key === key);

  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    codebook = await getCodebook(db);
  });
  afterAll(() => db?.end());

  it('seeds every category and sub-reason', () => {
    expect(codebook).toHaveLength(12);
    expect(codebook.flatMap((c) => c.subreasons)).toHaveLength(50);
    expect(category('connectivity').subreasons.map((s) => s.name)).toEqual([
      "Won't connect / pair at setup",
      'Drops offline / unstable',
      'Router / ISP / 5GHz incompatibility',
      'Bluetooth / phone pairing',
      'Weak signal outdoors / through window',
    ]);
  });

  it('breaks ties shipping first and non-specific last', () => {
    const ranked = codebook.filter((c) => c.tie_break_rank !== null).sort((a, b) => a.tie_break_rank - b.tie_break_rank);
    expect(ranked.map((c) => c.key)).toEqual([
      'shipping', 'connectivity', 'subscription', 'fit', 'performance', 'hardware', 'setup', 'changed_mind', 'non_specific',
    ]);
  });

  it('leaves No Comment out of the shares and sets aside samples and non-customer returns', () => {
    expect(codebook.filter((c) => !c.in_share).map((c) => c.key)).toEqual(['no_comment', 'sample', 'not_customer']);
    expect(codebook.filter((c) => c.set_aside).map((c) => c.key)).toEqual(['sample', 'not_customer']);
  });

  it('serves the codebook to anyone signed in', async () => {
    await request(app).get('/api/returns/codebook').expect(401);
    const { agent } = await signedInAgent(app, db, { email: 'reader@example.com' });
    const res = await agent.get('/api/returns/codebook').expect(200);
    expect(res.body.categories).toHaveLength(12);
    expect(res.body.categories[1]).toMatchObject({ key: 'connectivity', in_share: true, set_aside: false });
  });

  describe('on a return', () => {
    let returnId;
    const set = (fields) => {
      const cols = Object.keys(fields);
      return db.query(
        `UPDATE returns SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [returnId, ...Object.values(fields)],
      );
    };

    beforeAll(async () => {
      const { rows } = await db.query(
        `INSERT INTO returns (channel, return_date, return_ref, customer_comment) VALUES ('tiktok', '2026-09-08', 'R-CODEBOOK', 'Keeps dropping offline') RETURNING id`,
      );
      returnId = rows[0].id;
    });

    it('stores a category with its sub-reason and shows both names', async () => {
      await set({ category_id: category('connectivity').id, subreason_id: subreason('connectivity', 'drops_offline').id, category_source: 'rule', category_why: 'note matched: offline' });
      const [row] = await listReturns(db);
      expect(row).toMatchObject({
        category_key: 'connectivity',
        category_name: 'Connectivity',
        subreason_key: 'drops_offline',
        subreason_name: 'Drops offline / unstable',
        category_source: 'rule',
        category_why: 'note matched: offline',
      });
    });

    it('rejects a sub-reason from another category', async () => {
      await expect(set({ category_id: category('connectivity').id, subreason_id: subreason('fit', 'window').id })).rejects.toThrow(/foreign key/);
    });

    it('requires a sub-reason and a source whenever there is a category', async () => {
      await expect(set({ subreason_id: null })).rejects.toThrow(/check constraint/);
      await expect(set({ category_source: '' })).rejects.toThrow(/check constraint/);
      await set({ category_id: null, subreason_id: null, category_source: '', category_why: '' });
      await expect(set({ category_source: 'manual' })).rejects.toThrow(/check constraint/);
    });
  });
});
