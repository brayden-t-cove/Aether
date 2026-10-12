import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Made-up TikTok returns: one through a listing, one the import matched by the product's name in the title,
// and one with no ID at all.
const ret = (ref, o) => ({
  'Return Order ID': ref,
  'Order ID': `O-${ref}`,
  'Return Quantity': '1',
  'Return Reason': 'No longer needed',
  'Time Requested': '10/09/2026 10:00:00',
  'Buyer Note': '',
  ...o,
});
const ROWS = [
  ret('C-1', { 'SKU ID': '111', 'Seller SKU': 'PORCH-1', 'Product Name': 'Sample Porch Cam 2K Wireless' }),
  ret('C-2', { 'SKU ID': '111', 'Seller SKU': 'PORCH-1', 'Product Name': 'Sample Porch Cam 2K Wireless', 'Return Quantity': '2' }),
  // The title mentions "Hallway Cam", so the import guesses that product, though it's really the Porch Cam.
  ret('C-3', { 'Seller SKU': 'PORCH-2', 'Product Name': 'Hallway Cam style Porch Cam bundle' }),
  ret('C-4', { 'Seller SKU': '', 'Product Name': 'Hallway Cam' }),
];

describe.skipIf(!TEST_DATABASE_URL)("what's connected to each product", () => {
  let db, editor, viewer, porch, hallway;
  const connections = async () => (await viewer.get('/api/products/connections').expect(200)).body;
  const groupsOf = async (id) => (await connections()).groups.filter((g) => g.product_id === id).map((g) => [g.sku || g.product_label, g.units, g.via]);

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'vi@example.com', role: 'viewer' }));
    ({ body: { product: porch } } = await editor.post('/api/products').send({ name: 'Porch Cam', model: 'PC1' }).expect(201));
    ({ body: { product: hallway } } = await editor.post('/api/products').send({ name: 'Hallway Cam', model: 'HC1' }).expect(201));
    await editor.post(`/api/products/${porch.id}/listings`).send({ channel: 'tiktok', sku: 'PORCH-1', state: 'live' }).expect(201);
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: ROWS }).expect(200);
  });
  afterAll(() => db?.end());

  it('lists each product’s listings and its returns, saying how each group was matched', async () => {
    const data = await connections();
    expect(data.listings.find((l) => l.product_id === porch.id)).toMatchObject({ sku: 'PORCH-1', units: 3 });
    expect(await groupsOf(porch.id)).toEqual([['PORCH-1', 3, 'listing']]);
    expect(await groupsOf(hallway.id)).toEqual([
      ['Hallway Cam', 1, 'guess'],
      ['PORCH-2', 1, 'guess'],
    ]);
  });

  it('flags returns filed under a product when their listing says another', async () => {
    await db.query("UPDATE returns SET product_id = $1 WHERE return_ref = 'C-1'", [hallway.id]);
    const g = (await connections()).groups.find((x) => x.product_id === hallway.id && x.sku === 'PORCH-1');
    expect(g).toMatchObject({ via: 'conflict', listing_product_id: porch.id, listing_product_name: 'Porch Cam' });
    await db.query("UPDATE returns SET product_id = $1 WHERE return_ref = 'C-1'", [porch.id]);
  });

  it('moves a guessed group to the right product, adding its listing so the next import follows', async () => {
    const body = { channel: 'tiktok', sku: 'PORCH-2', to_product_id: porch.id };
    await viewer.post(`/api/products/${hallway.id}/move-returns`).send(body).expect(403);
    const { body: res } = await editor.post(`/api/products/${hallway.id}/move-returns`).send(body).expect(200);
    expect(res).toEqual({ moved: 1, listing: 'added' });
    expect(await groupsOf(porch.id)).toEqual([['PORCH-1', 3, 'listing'], ['PORCH-2', 1, 'listing']]);
    expect(await groupsOf(hallway.id)).toEqual([['Hallway Cam', 1, 'guess']]);
    const { rows } = await db.query("SELECT action, changes FROM activity_log WHERE action LIKE 'returns_moved%' ORDER BY action");
    expect(rows.map((r) => [r.action, r.changes.label, r.changes.rows])).toEqual([
      ['returns_moved', 'Hallway Cam', 1],
      ['returns_moved_in', 'Porch Cam', 1],
    ]);
  });

  it('moves a listing with its returns, and sends a group back to unmatched, removing its listing', async () => {
    const { body: moved } = await editor.post(`/api/products/${porch.id}/move-returns`).send({ channel: 'tiktok', sku: 'PORCH-1', to_product_id: hallway.id }).expect(200);
    expect(moved).toEqual({ moved: 2, listing: 'moved' });
    expect((await connections()).listings.find((l) => l.sku === 'PORCH-1').product_id).toBe(hallway.id);

    const { body: back } = await editor.post(`/api/products/${hallway.id}/move-returns`).send({ channel: 'tiktok', sku: 'PORCH-1' }).expect(200);
    expect(back).toEqual({ moved: 2, listing: 'removed' });
    const data = await connections();
    expect(data.listings.some((l) => l.sku === 'PORCH-1')).toBe(false);
    expect(data.groups.find((g) => g.sku === 'PORCH-1')).toMatchObject({ product_id: null, via: 'unmatched', units: 3 });
  });

  it('moves returns with no ID by their title, and refuses nonsense', async () => {
    const { body } = await editor.post(`/api/products/${hallway.id}/move-returns`).send({ channel: 'tiktok', product_label: 'Hallway Cam', to_product_id: porch.id }).expect(200);
    expect(body).toEqual({ moved: 1, listing: 'none' });
    await editor.post(`/api/products/${porch.id}/move-returns`).send({ channel: 'tiktok' }).expect(400);
    await editor.post(`/api/products/${porch.id}/move-returns`).send({ channel: 'fax', sku: 'X' }).expect(400);
    await editor.post(`/api/products/${porch.id}/move-returns`).send({ channel: 'tiktok', sku: 'X', to_product_id: porch.id }).expect(400);
    await editor.post('/api/products/not-a-product/move-returns').send({ channel: 'tiktok', sku: 'X' }).expect(404);
  });
});
