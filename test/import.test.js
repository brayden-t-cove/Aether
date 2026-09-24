import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Sample rows shaped like a pasted spreadsheet: loose headers, "--" blanks, team wording.
const SHEET = [
  { Name: 'Sample Doorbell', SKU: '--', Category: 'Doorbell', Lifecycle: 'Active', Launch_Date: '--', Markets: 'US; Mex', Channels: 'Amazon; Tiktok', Odyssey_Name: 'DB1', Notes: '' },
  { Name: 'Sample Cam', SKU: '--', Category: 'Indoor', Lifecycle: 'Active', Launch_Date: '3/15/2025', Markets: 'US; CA; South Africa; Narnia', Channels: 'amazon', Odyssey_Name: 'IC1', Notes: 'Old' },
  { Name: 'Sample Doorbell (V2)', Category: 'Doorbell', Lifecycle: 'Development', Markets: 'US', Channels: 'Amazon', Odyssey_Name: 'DB2', Replaces: 'DB1' },
  { Name: 'Old Thing', Lifecycle: 'Discontinued', Odyssey_Name: 'OT1' },
  { Name: 'Weird', Lifecycle: 'Someday' },
  { Name: 'Sample Cam copy', Odyssey_Name: 'IC1' },
];

const PROJECTS = [
  {
    name: 'Sample Doorbell (V2) — US launch',
    type: 'new_product',
    product: 'DB2',
    market: 'US',
    owner: 'admin@lunahome.com',
    state: 'in_progress',
    target_date: '2026-11-06',
    items: [
      { title: 'Samples received', category: 'testing', state: 'in_progress', due_date: '2026-10-02', owner: 'nobody@lunahome.com' },
      { title: 'Regression test', category: 'testing', state: 'done', waits_on: ['Samples received'] },
      { title: 'Manual', category: 'manual', waits_on: ['Regression test', 'Not a real item'] },
    ],
  },
  { name: 'Loop project', items: [{ title: 'A', waits_on: ['B'] }, { title: 'B', waits_on: ['A'] }] },
];

describe.skipIf(!TEST_DATABASE_URL)('import', () => {
  let db, app, admin, editor;
  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    editor = await signedInAgent(app, db, { email: 'editor@lunahome.com', role: 'editor' });
  });
  afterAll(() => db?.end());

  const byName = (rows, name) => rows.find((r) => r.name === name);

  it('is admin only and rejects empty or malformed requests', async () => {
    await editor.agent.post('/api/admin/import').send({ products: SHEET }).expect(403);
    await admin.agent.post('/api/admin/import').send({}).expect(400);
    await admin.agent.post('/api/admin/import').send({ products: 'nope' }).expect(400);
  });

  it('previews without writing anything', async () => {
    const { body } = await admin.agent.post('/api/admin/import').send({ products: SHEET, projects: PROJECTS, dryRun: true }).expect(200);
    expect(body.dryRun).toBe(true);
    expect(body.summary).toMatchObject({ productsCreate: 4, productsUpdate: 0, projectsCreate: 1, errors: 3 });

    expect(byName(body.products, 'Weird')).toMatchObject({ action: 'error', error: 'Unknown lifecycle "Someday"' });
    expect(byName(body.products, 'Sample Cam copy')).toMatchObject({ action: 'error', error: 'Listed twice in this import' });
    expect(byName(body.products, 'Sample Cam').warnings).toEqual([expect.stringContaining('Unknown market "Narnia"')]);
    expect(byName(body.projects, 'Loop project')).toMatchObject({ action: 'error' });

    const project = byName(body.projects, 'Sample Doorbell (V2) — US launch');
    expect(project.itemCount).toBe(3);
    expect(project.warnings.join(' ')).toMatch(/nobody@lunahome.com/);
    expect(project.warnings.join(' ')).toMatch(/Not a real item/);
    expect(project.warnings.join(' ')).toMatch(/imported as In review/);

    const { rows } = await db.query('SELECT count(*)::int AS n FROM products');
    expect(rows[0].n).toBe(0);
  });

  it('imports products and projects, cleaning up spreadsheet values', async () => {
    const { body } = await admin.agent.post('/api/admin/import').send({ products: SHEET, projects: PROJECTS }).expect(200);
    expect(body.summary).toMatchObject({ productsCreate: 4, projectsCreate: 1 });

    const { body: list } = await admin.agent.get('/api/products').expect(200);
    const doorbell = byName(list.products, 'Sample Doorbell');
    expect(doorbell).toMatchObject({ model: 'DB1', sku: null, lifecycle: 'active', channels: ['Amazon', 'TikTok'], market_codes: ['MX', 'US'] });
    expect(byName(list.products, 'Sample Cam')).toMatchObject({ launch_date: '2025-03-15', channels: ['Amazon'], market_codes: ['CA', 'US', 'ZA'] });
    expect(byName(list.products, 'Old Thing').lifecycle).toBe('sunset');

    const v2 = byName(list.products, 'Sample Doorbell (V2)');
    expect(v2).toMatchObject({ lifecycle: 'upcoming', replaces_id: doorbell.id, replaces_model: 'DB1' });
    const { body: detail } = await admin.agent.get(`/api/products/${doorbell.id}`);
    expect(detail.product.replaced_by).toEqual([expect.objectContaining({ id: v2.id, model: 'DB2' })]);

    const projectId = byName(body.projects, 'Sample Doorbell (V2) — US launch').id;
    const { body: page } = await admin.agent.get(`/api/projects/${projectId}`).expect(200);
    expect(page.project).toMatchObject({ product_id: v2.id, market_code: 'US', owner_name: 'Admin', target_date: '2026-11-06', state: 'in_progress' });
    const items = Object.fromEntries(page.items.map((i) => [i.title, i]));
    expect(items['Samples received']).toMatchObject({ owner_id: null, due_date: '2026-10-02' });
    expect(items['Regression test']).toMatchObject({ state: 'in_review', waiting: true });
    expect(items.Manual.blocked_by.map((b) => b.title)).toEqual(['Regression test']);
    expect(page.activity[0]).toMatchObject({ action: 'created', changes: { imported: true, items: 3 } });
  });

  it('updates matching products and skips existing projects when run again', async () => {
    const again = [{ Name: 'Renamed in sheet', Odyssey_Name: 'db1', Notes: 'Now with notes', Markets: 'US' }];
    const { body } = await admin.agent.post('/api/admin/import').send({ products: again, projects: PROJECTS.slice(0, 1) }).expect(200);
    expect(body.summary).toMatchObject({ productsCreate: 0, productsUpdate: 1, projectsCreate: 0, projectsSkip: 1 });

    const { body: list } = await admin.agent.get('/api/products?q=DB1');
    expect(list.products[0]).toMatchObject({ name: 'Sample Doorbell', notes: 'Now with notes', market_codes: ['US'], channels: ['Amazon', 'TikTok'] });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('product markets and replacements', () => {
  let db, app, editor;
  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    editor = await signedInAgent(app, db, { email: 'editor@lunahome.com', role: 'editor', name: 'Ed' });
  });
  afterAll(() => db?.end());

  it('sets markets and what a product replaces, and logs market changes', async () => {
    const { body: m } = await editor.agent.get('/api/markets');
    const id = (code) => m.markets.find((x) => x.code === code).id;

    const { body: old } = await editor.agent.post('/api/products').send({ name: 'Old', model: 'O1', market_ids: [id('US')] }).expect(201);
    expect(old.product.market_codes).toEqual(['US']);
    await editor.agent.post('/api/products').send({ name: 'Dup model', model: 'o1' }).expect(409);
    await editor.agent.post('/api/products').send({ name: 'Bad', market_ids: ['nope'] }).expect(400);

    const { body: next } = await editor.agent
      .post('/api/products')
      .send({ name: 'New', lifecycle: 'upcoming', replaces_id: old.product.id, market_ids: [id('UK'), id('US')] })
      .expect(201);
    expect(next.product).toMatchObject({ replaces_name: 'Old', market_codes: ['UK', 'US'] });

    await editor.agent.patch(`/api/products/${next.product.id}`).send({ replaces_id: next.product.id }).expect(400);
    const { body: updated } = await editor.agent.patch(`/api/products/${next.product.id}`).send({ market_ids: [id('ZA')] }).expect(200);
    expect(updated.product.market_codes).toEqual(['ZA']);

    const { body: log } = await editor.agent.get(`/api/activity?entityType=product&entityId=${next.product.id}`);
    expect(log.activity[0].changes.markets).toEqual({ from: ['UK', 'US'], to: ['ZA'] });
  });
});
