import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOdysseyClient } from '../server/lib/odyssey.js';
import { runOdysseySync } from '../server/lib/sync.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeOdyssey } from './fake-odyssey.js';

describe.skipIf(!TEST_DATABASE_URL)('phase 3: Odyssey sync and vendors', () => {
  let db, fake, app, admin, editor, viewer, w4;

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeOdyssey();
    const odyssey = createOdysseyClient({ apiUrl: fake.url, apiKey: fake.apiKey });
    app = makeApp(db, { odyssey: { apiUrl: fake.url, apiKey: fake.apiKey } });
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    editor = await signedInAgent(app, db, { email: 'pd@lunahome.com', role: 'editor', name: 'PD' });
    viewer = await signedInAgent(app, db, { email: 'boss@lunahome.com', role: 'viewer' });
    // An Aether product whose model matches an Odyssey name, so sync should link rather than duplicate it.
    ({ body: { product: w4 } } = await editor.agent.post('/api/products').send({ name: 'Window Camera', model: 'W4', lifecycle: 'active', notes: 'Aether notes' }).expect(201));
    expect(odyssey).toBeTruthy();
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('reports connection status', async () => {
    const { body } = await viewer.agent.get('/api/odyssey/status').expect(200);
    expect(body).toMatchObject({ configured: true, runs: [], lastSuccessAt: null });
  });

  it('only lets editors run a sync', async () => {
    await viewer.agent.post('/api/odyssey/sync').expect(403);
  });

  it('links matching products, adds new ones read-only, and copies sessions and vendors', async () => {
    const { body } = await editor.agent.post('/api/odyssey/sync').expect(200);
    expect(body.run).toMatchObject({ ok: true, trigger: 'manual', products_linked: 1, products_created: 2, sessions_synced: 2, vendors_created: 2 });

    const { body: list } = await viewer.agent.get('/api/products').expect(200);
    expect(list.products).toHaveLength(3);
    const linked = list.products.find((p) => p.id === w4.id);
    expect(linked).toMatchObject({ odyssey_id: 'ody-w4', source: 'aether', notes: 'Aether notes', name: 'Window Camera' });
    const hub = list.products.find((p) => p.odyssey_id === 'ody-hub');
    expect(hub).toMatchObject({ source: 'odyssey', name: 'Sample Hub', model: 'HB1 V2', lifecycle: 'upcoming', category: 'hub' });
    expect(list.products.find((p) => p.odyssey_id === 'ody-old').lifecycle).toBe('sunset');

    const { body: sessions } = await viewer.agent.get(`/api/test-sessions?productId=${w4.id}`).expect(200);
    expect(sessions.sessions).toEqual([expect.objectContaining({ odyssey_id: 'ses-1', pass_count: 37, fail_count: 2, issue_count: 3 })]);

    const { body: vendors } = await viewer.agent.get('/api/vendors').expect(200);
    const factory = vendors.vendors.find((v) => v.name === 'Sample Factory');
    expect(factory).toMatchObject({ source: 'odyssey', status: 'active', contact_count: 1 });
    const { body: detail } = await viewer.agent.get(`/api/vendors/${factory.id}`);
    expect(detail.contacts[0]).toMatchObject({ name: 'Alex', email: 'alex@factory.example', messaging: 'WeChat: alex_w' });
  });

  it('is idempotent, and picks up changes on the next run', async () => {
    fake.state.catalog.find((p) => p.id === 'ody-hub').status = 'active';
    fake.state.sessions[1].passCount = 10;
    const { body } = await editor.agent.post('/api/odyssey/sync').expect(200);
    expect(body.run).toMatchObject({ ok: true, products_created: 0, products_linked: 0, products_updated: 1, vendors_created: 0, vendors_updated: 0 });
    const { body: list } = await viewer.agent.get('/api/products?lifecycle=active');
    expect(list.products.map((p) => p.name).sort()).toEqual(['Sample Hub', 'Window Camera']);
  });

  it("keeps synced fields read-only but lets the team edit Aether's own fields", async () => {
    const { body: list } = await viewer.agent.get('/api/products');
    const hub = list.products.find((p) => p.odyssey_id === 'ody-hub');
    const { body: err } = await editor.agent.patch(`/api/products/${hub.id}`).send({ name: 'Renamed' }).expect(409);
    expect(err.error).toMatch(/Change name in Odyssey/);
    await editor.agent.patch(`/api/products/${hub.id}`).send({ notes: 'Launch in Q1', channels: ['Amazon'] }).expect(200);
    // Sending the unchanged synced value is fine (forms send every field).
    await editor.agent.patch(`/api/products/${hub.id}`).send({ name: 'Sample Hub', notes: 'Launch in Q2' }).expect(200);
  });

  it('keeps the last copy and records the failure when Odyssey is down', async () => {
    fake.state.down = true;
    const { body } = await editor.agent.post('/api/odyssey/sync').expect(502);
    expect(body.error).toMatch(/Odyssey returned 503/);
    fake.state.down = false;
    const { body: status } = await viewer.agent.get('/api/odyssey/status');
    expect(status.runs[0]).toMatchObject({ ok: false });
    expect(status.lastSuccessAt).toBeTruthy();
    const { body: list } = await viewer.agent.get('/api/products');
    expect(list.products).toHaveLength(3);
  });

  it('reports a wrong service key clearly', async () => {
    const bad = createOdysseyClient({ apiUrl: fake.url, apiKey: 'wrong' });
    const run = await runOdysseySync(db, bad, { trigger: 'schedule' });
    expect(run).toMatchObject({ ok: false, error: expect.stringMatching(/refused the service key/) });
  });

  it('sends a new Aether product to Odyssey once', async () => {
    const { body } = await editor.agent.post('/api/products').send({ name: 'Pet Camera', model: 'PC1', manufacturer: 'Sample Factory' }).expect(201);
    await viewer.agent.post(`/api/products/${body.product.id}/send-to-odyssey`).expect(403);
    const { body: sent } = await editor.agent.post(`/api/products/${body.product.id}/send-to-odyssey`).send({}).expect(200);
    expect(fake.state.created.at(-1)).toMatchObject({ name: 'Pet Camera', modelNumber: 'PC1', category: 'camera', entity: ['Luna'] });
    const { body: product } = await viewer.agent.get(`/api/products/${body.product.id}`);
    expect(product.product.odyssey_id).toBe(sent.odyssey_id);
    await editor.agent.post(`/api/products/${body.product.id}/send-to-odyssey`).expect(409);

    // The next sync sees it in Odyssey and doesn't create a duplicate.
    const { body: next } = await editor.agent.post('/api/odyssey/sync').expect(200);
    expect(next.run.products_created).toBe(0);
  });

  it('manages Aether vendors, contacts and product links; synced vendors stay read-only', async () => {
    const { body } = await editor.agent.post('/api/vendors').send({ name: 'UK Test Lab', type: 'cert_lab', country: 'UK', website: 'https://lab.example' }).expect(201);
    const lab = body.vendor;
    await editor.agent.post('/api/vendors').send({ name: 'uk test lab' }).expect(409);
    await editor.agent.post('/api/vendors').send({ name: 'Bad site', website: 'javascript:1' }).expect(400);
    await editor.agent.post(`/api/vendors/${lab.id}/contacts`).send({ name: 'Sam', email: 'sam@lab.example' }).expect(201);
    await editor.agent.post(`/api/vendors/${lab.id}/products`).send({ product_id: w4.id, role: 'cert_lab' }).expect(201);

    const { body: markets } = await viewer.agent.get('/api/markets');
    const uk = markets.markets.find((m) => m.code === 'UK');
    await editor.agent.post('/api/certifications').send({ product_id: w4.id, market_id: uk.id, mark: 'UKCA', lab_vendor_id: lab.id }).expect(201);

    const { body: detail } = await viewer.agent.get(`/api/vendors/${lab.id}`);
    expect(detail.products).toEqual([expect.objectContaining({ id: w4.id, role: 'cert_lab' })]);
    expect(detail.certifications).toEqual([expect.objectContaining({ mark: 'UKCA', market_code: 'UK' })]);
    const { body: productPage } = await viewer.agent.get(`/api/products/${w4.id}`);
    expect(productPage.vendors).toEqual([expect.objectContaining({ name: 'UK Test Lab', role: 'cert_lab' })]);

    const { body: all } = await viewer.agent.get('/api/vendors?type=cert_lab');
    expect(all.vendors.map((v) => v.name)).toEqual(['UK Test Lab']);

    const factory = (await viewer.agent.get('/api/vendors')).body.vendors.find((v) => v.name === 'Sample Factory');
    await editor.agent.patch(`/api/vendors/${factory.id}`).send({ name: 'Renamed' }).expect(409);
    await editor.agent.patch(`/api/vendors/${factory.id}`).send({ type: 'manufacturer', country: 'China' }).expect(200);
    await editor.agent.post(`/api/vendors/${factory.id}/contacts`).send({ name: 'X' }).expect(409);
    await editor.agent.delete(`/api/vendors/${lab.id}`).expect(403);
    await admin.agent.delete(`/api/vendors/${lab.id}`).expect(200);
  });
});
