import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('products, markets and launch tracking', () => {
  let db, app, admin, editor, viewer, uk, camera;

  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    editor = await signedInAgent(app, db, { email: 'intl@lunahome.com', role: 'editor', name: 'Intl' });
    viewer = await signedInAgent(app, db, { email: 'viewer@lunahome.com', role: 'viewer' });
  });
  afterAll(() => db?.end());

  const byTitle = (items, text) => items.find((i) => i.title.includes(text));

  describe('markets', () => {
    it('comes with a starting set of markets', async () => {
      const { body } = await viewer.agent.get('/api/markets').expect(200);
      expect(body.markets.map((m) => m.code)).toEqual(['AU', 'CA', 'EU', 'UK', 'US']);
      uk = body.markets.find((m) => m.code === 'UK');
      expect(uk).toMatchObject({ plug_types: ['G'], required_marks: ['UKCA'], voltage: '230V' });
    });

    it('lets editors add and edit markets, and upper-cases the code', async () => {
      await viewer.agent.post('/api/markets').send({ code: 'mx', name: 'Mexico' }).expect(403);
      const { body } = await editor.agent
        .post('/api/markets')
        .send({ code: 'mx', name: 'Mexico', plug_types: 'A; B', required_marks: ['NOM'] })
        .expect(201);
      expect(body.market).toMatchObject({ code: 'MX', plug_types: ['A', 'B'], required_marks: ['NOM'] });
      await editor.agent.post('/api/markets').send({ code: 'MX', name: 'Dup' }).expect(409);
      const { body: updated } = await editor.agent.patch(`/api/markets/${body.market.id}`).send({ languages: ['Spanish'] }).expect(200);
      expect(updated.market.languages).toEqual(['Spanish']);
    });
  });

  describe('products', () => {
    it('validates input', async () => {
      await editor.agent.post('/api/products').send({}).expect(400);
      await editor.agent.post('/api/products').send({ name: 'X', lifecycle: 'retired' }).expect(400);
      await editor.agent.post('/api/products').send({ name: 'X', launch_date: '2026-Q2' }).expect(400);
      await editor.agent.post('/api/products').send({ name: 'X', lifecycle: 'toString' }).expect(400);
    });

    it('creates, lists, filters and updates products, logging the change', async () => {
      const { body } = await editor.agent
        .post('/api/products')
        .send({ name: 'Lightbulb Camera', sku: 'LUNA-LBC-01', category: 'Camera', lifecycle: 'active', launch_date: '2025-03-01', channels: 'Amazon;TikTok' })
        .expect(201);
      camera = body.product;
      expect(camera).toMatchObject({ launch_date: '2025-03-01', channels: ['Amazon', 'TikTok'], source: 'aether' });

      await editor.agent.post('/api/products').send({ name: 'Old Doorbell', lifecycle: 'sunset' }).expect(201);
      await editor.agent.post('/api/products').send({ name: 'Dup', sku: 'LUNA-LBC-01' }).expect(409);

      const { body: active } = await viewer.agent.get('/api/products?lifecycle=active').expect(200);
      expect(active.products.map((p) => p.name)).toEqual(['Lightbulb Camera']);
      const { body: search } = await viewer.agent.get('/api/products?q=door').expect(200);
      expect(search.products.map((p) => p.name)).toEqual(['Old Doorbell']);

      await viewer.agent.patch(`/api/products/${camera.id}`).send({ name: 'Nope' }).expect(403);
      const { body: updated } = await editor.agent.patch(`/api/products/${camera.id}`).send({ category: 'Indoor camera', sku: '' }).expect(200);
      expect(updated.product).toMatchObject({ category: 'Indoor camera', sku: null });

      const { body: log } = await viewer.agent.get(`/api/activity?entityType=product&entityId=${camera.id}`);
      expect(log.activity[0].changes).toMatchObject({ category: { from: 'Camera', to: 'Indoor camera' }, label: 'Lightbulb Camera' });
    });
  });

  describe('projects and checklists', () => {
    let project, items;

    it('needs a market for the market launch template', async () => {
      await editor.agent.post('/api/projects').send({ name: 'No market', template: 'market_launch' }).expect(400);
      await editor.agent.post('/api/projects').send({ name: 'Bad template', template: 'nope' }).expect(400);
      await viewer.agent.post('/api/projects').send({ name: 'Viewer' }).expect(403);
    });

    it('builds a market-specific checklist with blockers from a template', async () => {
      const { body } = await editor.agent
        .post('/api/projects')
        .send({
          name: 'Lightbulb Camera — UK launch',
          type: 'launch',
          product_id: camera.id,
          market_id: uk.id,
          owner_id: editor.user.id,
          target_date: '2026-11-30',
          template: 'market_launch',
        })
        .expect(201);
      project = body.project;

      const res = await viewer.agent.get(`/api/projects/${project.id}`).expect(200);
      items = res.body.items;
      expect(res.body.project).toMatchObject({ product_name: 'Lightbulb Camera', market_code: 'UK', owner_name: 'Intl', target_date: '2026-11-30' });
      expect(byTitle(items, 'UKCA certification')).toBeTruthy();
      expect(byTitle(items, 'type G plug')).toBeTruthy();

      const cert = byTitle(items, 'UKCA certification');
      expect(cert.blocked_by.map((b) => b.title)).toEqual([expect.stringContaining('Compliance testing')]);
      expect(cert.waiting).toBe(true);
      expect(byTitle(items, 'Compliance testing').waiting).toBe(false);
      expect(res.body.activity[0]).toMatchObject({ action: 'created', changes: { template: 'market_launch', items: items.length } });
    });

    it("won't mark an item done while it waits on something open", async () => {
      const testing = byTitle(items, 'Compliance testing');
      const cert = byTitle(items, 'UKCA certification');

      const { body } = await editor.agent.patch(`/api/items/${cert.id}`).send({ state: 'done' }).expect(409);
      expect(body.error).toContain('Compliance testing');

      const { body: done } = await editor.agent.patch(`/api/items/${testing.id}`).send({ state: 'done' }).expect(200);
      expect(done.item.completed_at).toBeTruthy();
      await editor.agent.patch(`/api/items/${cert.id}`).send({ state: 'done', evidence_url: 'https://example.com/ukca.pdf' }).expect(200);

      const { body: reopened } = await editor.agent.patch(`/api/items/${testing.id}`).send({ state: 'in_progress' }).expect(200);
      expect(reopened.item.completed_at).toBeNull();
    });

    it('rejects loops of items waiting on each other', async () => {
      const a = byTitle(items, 'Manual localized');
      const b = byTitle(items, 'Packaging artwork');
      const c = byTitle(items, 'Marketplace listing');
      // Template already has: artwork waits on manual, listing waits on artwork.
      await editor.agent.post(`/api/items/${a.id}/dependencies`).send({ blocked_by_id: b.id }).expect(409);
      await editor.agent.post(`/api/items/${a.id}/dependencies`).send({ blocked_by_id: c.id }).expect(409);
      await editor.agent.post(`/api/items/${a.id}/dependencies`).send({ blocked_by_id: a.id }).expect(400);
    });

    it('supports blockers in another project, and removing them', async () => {
      const { body: other } = await editor.agent.post('/api/projects').send({ name: 'Plug supplier', type: 'other' }).expect(201);
      const { body: created } = await editor.agent.post(`/api/projects/${other.project.id}/items`).send({ title: 'G-plug adapter samples', category: 'testing' }).expect(201);
      const power = byTitle(items, 'type G plug');

      await editor.agent.post(`/api/items/${power.id}/dependencies`).send({ blocked_by_id: created.item.id }).expect(201);
      let res = await viewer.agent.get(`/api/projects/${project.id}`);
      expect(byTitle(res.body.items, 'type G plug').blocked_by[0]).toMatchObject({ title: 'G-plug adapter samples', project_name: 'Plug supplier' });

      await editor.agent.delete(`/api/items/${power.id}/dependencies/${created.item.id}`).expect(200);
      res = await viewer.agent.get(`/api/projects/${project.id}`);
      expect(byTitle(res.body.items, 'type G plug').blocked_by).toEqual([]);
      expect(res.body.activity.map((a) => a.action)).toEqual(expect.arrayContaining(['dependency_added', 'dependency_removed']));
    });

    it('adds, edits and removes items, validating links and owners', async () => {
      const { body } = await editor.agent.post(`/api/projects/${project.id}/items`).send({ title: 'Amazon UK A+ content', category: 'listing' }).expect(201);
      expect(body.item.position).toBe(items.length);
      await editor.agent.post(`/api/projects/${project.id}/items`).send({ category: 'listing' }).expect(400);
      await editor.agent.patch(`/api/items/${body.item.id}`).send({ evidence_url: 'not a link' }).expect(400);
      await editor.agent.patch(`/api/items/${body.item.id}`).send({ evidence_url: 'javascript:alert(1)' }).expect(400);
      await editor.agent.patch(`/api/items/${body.item.id}`).send({ owner_id: '00000000-0000-0000-0000-000000000000' }).expect(400);
      await viewer.agent.delete(`/api/items/${body.item.id}`).expect(403);
      await editor.agent.delete(`/api/items/${body.item.id}`).expect(200);
    });

    it('summarises progress, blockers and overdue items on the dashboard', async () => {
      const listing = byTitle(items, 'Marketplace listing');
      await editor.agent.patch(`/api/items/${listing.id}`).send({ due_date: '2020-01-01' }).expect(200);
      const logistics = byTitle(items, 'Importer');
      await editor.agent.patch(`/api/items/${logistics.id}`).send({ state: 'blocked', notes: 'Waiting on distributor contract' }).expect(200);

      const { body } = await viewer.agent.get('/api/dashboard').expect(200);
      const summary = body.projects.find((p) => p.id === project.id);
      expect(summary).toMatchObject({ item_count: items.length, done_count: 1, overdue_count: 1, blocked_count: 1 });
      expect(summary.waiting_count).toBeGreaterThan(0);
      expect(body.counts).toMatchObject({ open_projects: 2, blocked_items: 1, overdue_items: 1 });
      expect(body.overdue[0]).toMatchObject({ title: listing.title, project_name: project.name });
      expect(body.overdue[0].waiting_on.length).toBeGreaterThan(0);
      // Only items someone marked Blocked count; waiting on an earlier step is normal sequencing.
      expect(body.blocked).toHaveLength(1);
      expect(body.blocked[0]).toMatchObject({ title: logistics.title, holds_up: 1 });
    });

    it('filters projects and ignores bad filters', async () => {
      const { body } = await viewer.agent.get(`/api/projects?productId=${camera.id}`).expect(200);
      expect(body.projects.map((p) => p.id)).toEqual([project.id]);
      await viewer.agent.get('/api/projects?type=toString&state=nope&productId=abc').expect(200);
      const { body: productPage } = await viewer.agent.get(`/api/products/${camera.id}`).expect(200);
      expect(productPage.projects).toHaveLength(1);
    });

    it("won't delete a product that projects use; only admins delete projects", async () => {
      await admin.agent.delete(`/api/products/${camera.id}`).expect(409);
      await editor.agent.delete(`/api/projects/${project.id}`).expect(403);
      await admin.agent.delete(`/api/projects/${project.id}`).expect(200);
      await viewer.agent.get(`/api/projects/${project.id}`).expect(404);
      await admin.agent.delete(`/api/products/${camera.id}`).expect(200);
    });
  });
});
