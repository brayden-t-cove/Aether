import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MERGED_SET_TABLES, MIN_SCORE, MOVED_TABLES, OTHER_PRODUCT_TABLES, scorePair } from '../server/lib/productMerge.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeOdyssey } from './fake-odyssey.js';

const aether = (name, model = null, manufacturer = '') => ({ name, model, manufacturer });

describe('scoring look-alike products', () => {
  it('matches a model with the version in the name to the same model with a version', () => {
    const { score, reasons } = scorePair(aether('Porch Cam (V2)', 'AB-12345'), aether('AB12345 V2', 'AB12345 V2'));
    expect(score).toBeGreaterThanOrEqual(90);
    expect(reasons[0]).toBe('Same model number: AB-12345 and AB12345 V2');
  });

  it('matches a model missing its prefix, with the shorter name', () => {
    const { score, reasons } = scorePair(aether('2K Hallway Camera', 'Qx7v3'), aether('Hallway Camera', 'ZQx7v3'));
    expect(score).toBeGreaterThanOrEqual(70);
    expect(reasons).toContain('Model Qx7v3 is part of ZQx7v3');
    expect(reasons).toContain('Every word of "Hallway Camera" is in "2K Hallway Camera"');
  });

  it('counts the same manufacturer, and names a letter apart', () => {
    const { score, reasons } = scorePair(aether('Garden Floodlight', null, 'Sample Factory'), aether('Garden Flodlight', null, 'Sample Factory'));
    expect(score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(reasons).toEqual(['Names differ by a letter or two', 'Same manufacturer (Sample Factory)']);
  });

  it("doesn't pair different versions, different products, or a shared resolution", () => {
    expect(scorePair(aether('Porch Cam', 'AB12345 V1'), aether('AB12345 V2', 'AB12345 V2')).score).toBeLessThan(MIN_SCORE);
    expect(scorePair(aether('2K Indoor Camera'), aether('2K Outdoor Camera')).score).toBeLessThan(MIN_SCORE);
    expect(scorePair(aether('Doorbell'), aether('Video Doorbell Pro')).score).toBeLessThan(MIN_SCORE);
    expect(scorePair(aether('Smart Plug', 'SP1'), aether('Garage Sensor', 'GS9')).score).toBe(0);
    // "v3" inside a model number isn't a version.
    expect(scorePair(aether('Hallway', 'Qx7v3'), aether('Hallway', 'ZQx7v2')).reasons).not.toContain('But one is V3 and the other V2');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('merging duplicate products', () => {
  let db, fake, app, editor, viewer, porch, hallway, markets;
  const catalog = [
    { id: 'ody-porch', name: 'AB12345 V2', manufacturer: 'Sample Factory', modelNumber: 'AB12345', version: 'V2', category: 'doorbell', status: 'active' },
    { id: 'ody-hall', name: 'Hallway Camera', modelNumber: 'ZQx7v3', category: 'camera', status: 'active' },
    { id: 'ody-garage', name: 'Garage Sensor', modelNumber: 'GS9', category: 'sensor', status: 'active' },
  ];
  const sessions = [{ id: 'ses-porch', productName: 'AB12345 V2', catalogId: 'ody-porch', status: 'completed', testCaseCount: 5, passCount: 5 }];
  const synced = async (odysseyId) => (await db.query('SELECT * FROM products WHERE odyssey_id = $1', [odysseyId])).rows[0];

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeOdyssey({ data: { catalog, sessions, vendors: [] } });
    app = makeApp(db, { odyssey: { apiUrl: fake.url, apiKey: fake.apiKey } });
    editor = await signedInAgent(app, db, { email: 'pd@lunahome.com', role: 'editor', name: 'PD' });
    viewer = await signedInAgent(app, db, { email: 'boss@lunahome.com', role: 'viewer' });
    ({ body: { markets } } = await viewer.agent.get('/api/markets').expect(200));
    const market = (code) => markets.find((m) => m.code === code).id;
    // Added by hand, with names and models a little off from Odyssey's, so sync can't link them.
    ({ body: { product: porch } } = await editor.agent
      .post('/api/products')
      .send({ name: 'Porch Cam (V2)', model: 'AB-12345', category: 'Doorbell', lifecycle: 'active', channels: ['Amazon'], market_ids: [market('US')], notes: 'Aether notes' })
      .expect(201));
    ({ body: { product: hallway } } = await editor.agent.post('/api/products').send({ name: '2K Hallway Camera', model: 'Qx7v3' }).expect(201));
    await db.query("INSERT INTO projects (name, product_id) VALUES ('Porch Cam launch', $1)", [porch.id]);
    await editor.agent.post('/api/odyssey/sync').expect(200);
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('every table that points at a product is handled by a merge', async () => {
    const { rows } = await db.query(
      "SELECT DISTINCT conrelid::regclass::text AS t FROM pg_constraint WHERE contype = 'f' AND confrelid = 'products'::regclass",
    );
    const handled = new Set([...MOVED_TABLES, ...Object.keys(MERGED_SET_TABLES), ...OTHER_PRODUCT_TABLES]);
    expect(rows.map((r) => r.t).filter((t) => !handled.has(t))).toEqual([]);
  });

  it('sync made copies of both, and suggests each pair with its reasons', async () => {
    expect(await synced('ody-porch')).toMatchObject({ source: 'odyssey', model: 'AB12345 V2' });
    const { body } = await viewer.agent.get('/api/products/duplicates').expect(200);
    expect(body.pairs.map((p) => [p.keep.name, p.merge.name])).toEqual([
      ['Porch Cam (V2)', 'AB12345 V2'],
      ['2K Hallway Camera', 'Hallway Camera'],
    ]);
    expect(body.pairs[0]).toMatchObject({ keep: { project_count: 1 }, merge: { test_session_count: 1 } });
    expect(body.pairs[0].reasons[0]).toBe('Same model number: AB-12345 and AB12345 V2');
  });

  it('"not the same" stops a pair being suggested', async () => {
    const copy = await synced('ody-hall');
    await viewer.agent.post('/api/products/duplicates/dismiss').send({ product_id: hallway.id, other_id: copy.id }).expect(403);
    await editor.agent.post('/api/products/duplicates/dismiss').send({ product_id: hallway.id, other_id: copy.id }).expect(200);
    const { body } = await viewer.agent.get('/api/products/duplicates');
    expect(body.pairs.map((p) => p.keep.name)).toEqual(['Porch Cam (V2)']);
    const { rows } = await db.query("SELECT changes FROM activity_log WHERE action = 'marked_distinct'");
    expect(rows[0].changes).toMatchObject({ label: '2K Hallway Camera', other: 'Hallway Camera' });
  });

  it('only merges the synced copy into the Aether product, for editors', async () => {
    const copy = await synced('ody-porch');
    await viewer.agent.post(`/api/products/${porch.id}/merge`).send({ merge_id: copy.id }).expect(403);
    const { body } = await editor.agent.post(`/api/products/${copy.id}/merge`).send({ merge_id: porch.id }).expect(400);
    expect(body.error).toMatch(/Keep the product made in Aether/);
    await editor.agent.post(`/api/products/${porch.id}/merge`).send({ merge_id: porch.id }).expect(400);
  });

  it('merging keeps the Aether name and data, and takes the Odyssey link, model and records', async () => {
    const copy = await synced('ody-porch');
    const uk = markets.find((m) => m.code === 'UK').id;
    // The team had started filling in the synced copy too.
    await editor.agent.patch(`/api/products/${copy.id}`).send({ market_ids: [uk], channels: ['TikTok'], sku: 'PC-2', notes: 'Copy notes' }).expect(200);
    await db.query("INSERT INTO product_listings (product_id, channel, external_id) VALUES ($1, 'tiktok', 'TT-1')", [copy.id]);

    const { body } = await editor.agent.post(`/api/products/${porch.id}/merge`).send({ merge_id: copy.id }).expect(200);
    expect(body.product).toMatchObject({
      id: porch.id,
      name: 'Porch Cam (V2)',
      source: 'aether',
      odyssey_id: 'ody-porch',
      model: 'AB12345 V2',
      manufacturer: 'Sample Factory',
      category: 'Doorbell',
      lifecycle: 'active',
      sku: 'PC-2',
      market_codes: ['UK', 'US'],
      notes: 'Aether notes\n\nCopy notes',
      aliases: ['AB-12345', 'AB12345 V2'],
      project_count: 1,
    });
    expect(body.product.channels.sort()).toEqual(['Amazon', 'TikTok']);
    await viewer.agent.get(`/api/products/${copy.id}`).expect(404);
    const { body: sessionsBody } = await viewer.agent.get(`/api/test-sessions?productId=${porch.id}`);
    expect(sessionsBody.sessions.map((s) => s.odyssey_id)).toEqual(['ses-porch']);
    const { rows: listings } = await db.query('SELECT product_id FROM product_listings');
    expect(listings).toEqual([{ product_id: porch.id }]);

    const { rows: log } = await db.query("SELECT entity_id, action, changes FROM activity_log WHERE action IN ('merged', 'merged_into') ORDER BY action");
    expect(log).toEqual([
      { entity_id: porch.id, action: 'merged', changes: { label: 'Porch Cam (V2)', merged: 'AB12345 V2', odyssey_id: 'ody-porch', model: { from: 'AB-12345', to: 'AB12345 V2' } } },
      { entity_id: copy.id, action: 'merged_into', changes: { label: 'AB12345 V2', into: 'Porch Cam (V2)' } },
    ]);

    // An alias finds the product in search.
    const { body: search } = await viewer.agent.get('/api/products?q=AB-12345');
    expect(search.products.map((p) => p.id)).toEqual([porch.id]);
  });

  it('the next sync updates the merged product instead of making a new copy', async () => {
    fake.state.catalog.find((p) => p.id === 'ody-porch').manufacturer = 'Other Factory';
    const { body } = await editor.agent.post('/api/odyssey/sync').expect(200);
    expect(body.run).toMatchObject({ products_created: 0, products_linked: 0, products_updated: 1 });
    const { body: detail } = await viewer.agent.get(`/api/products/${porch.id}`);
    expect(detail.product).toMatchObject({ name: 'Porch Cam (V2)', manufacturer: 'Other Factory', model: 'AB12345 V2' });
    const { rows } = await db.query("SELECT count(*)::int AS n FROM products WHERE odyssey_id = 'ody-porch'");
    expect(rows[0].n).toBe(1);
  });

  it('a linked product takes its model and manufacturer from Odyssey, but its name is still edited here', async () => {
    const { body } = await editor.agent.patch(`/api/products/${porch.id}`).send({ model: 'AB-12345' }).expect(409);
    expect(body.error).toBe('This product is linked to Odyssey. Change model in Odyssey.');
    await editor.agent.patch(`/api/products/${porch.id}`).send({ name: 'Porch Camera (V2)', model: 'AB12345 V2', manufacturer: 'Other Factory' }).expect(200);
  });
});
