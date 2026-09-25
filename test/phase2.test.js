import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

const isoDaysFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const countFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length : 0);

describe.skipIf(!TEST_DATABASE_URL)('phase 2: certifications, documents, design requests, files', () => {
  let db, app, filesDir, admin, editor, viewer, market, product, other;

  beforeAll(async () => {
    db = await setupDb();
    filesDir = mkdtempSync(join(tmpdir(), 'aether-files-'));
    app = makeApp(db, { filesDir, maxUploadMb: 1 });
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    editor = await signedInAgent(app, db, { email: 'design@lunahome.com', role: 'editor', name: 'Designer' });
    viewer = await signedInAgent(app, db, { email: 'boss@lunahome.com', role: 'viewer', name: 'Boss' });
    const { body: m } = await viewer.agent.get('/api/markets');
    market = Object.fromEntries(m.markets.map((x) => [x.code, x]));
    ({ body: { product } } = await editor.agent
      .post('/api/products')
      .send({ name: 'Window Cam V2', model: 'C6214', lifecycle: 'upcoming', market_ids: [market.US.id] })
      .expect(201));
    ({ body: { product: other } } = await editor.agent.post('/api/products').send({ name: 'Other' }).expect(201));
  });
  afterAll(async () => {
    await db?.end();
    rmSync(filesDir, { recursive: true, force: true });
  });

  describe('variants', () => {
    it('adds, edits and removes regional variants', async () => {
      await viewer.agent.post(`/api/products/${product.id}/variants`).send({ name: 'UK' }).expect(403);
      const { body } = await editor.agent
        .post(`/api/products/${product.id}/variants`)
        .send({ name: 'UK variant', market_id: market.UK.id, differences: 'Type G plug' })
        .expect(201);
      await editor.agent.patch(`/api/variants/${body.variant.id}`).send({ sku: 'C6214-UK' }).expect(200);
      const { body: list } = await viewer.agent.get(`/api/products/${product.id}/variants`).expect(200);
      expect(list.variants[0]).toMatchObject({ name: 'UK variant', market_code: 'UK', sku: 'C6214-UK' });
      await editor.agent.delete(`/api/variants/${body.variant.id}`).expect(200);
    });
  });

  describe('certifications', () => {
    let fcc;

    it('creates certifications and validates them', async () => {
      await viewer.agent.post('/api/certifications').send({ product_id: product.id, market_id: market.US.id, mark: 'FCC' }).expect(403);
      await editor.agent.post('/api/certifications').send({ product_id: product.id, mark: 'FCC' }).expect(400);
      await editor.agent.post('/api/certifications').send({ product_id: product.id, market_id: market.US.id, mark: 'FCC', state: 'done' }).expect(400);

      const { body: v } = await editor.agent.post(`/api/products/${other.id}/variants`).send({ name: 'Not mine' }).expect(201);
      await editor.agent
        .post('/api/certifications')
        .send({ product_id: product.id, market_id: market.US.id, mark: 'FCC', variant_id: v.variant.id })
        .expect(400);

      const { body } = await editor.agent
        .post('/api/certifications')
        .send({ product_id: product.id, market_id: market.US.id, mark: 'fcc', state: 'in_progress', lab: 'XMI' })
        .expect(201);
      fcc = body.certification;
      expect(fcc).toMatchObject({ mark: 'FCC', product_name: 'Window Cam V2', market_code: 'US', expiry_status: null });
    });

    it('flags expiring and expired certifications', async () => {
      await editor.agent.patch(`/api/certifications/${fcc.id}`).send({ state: 'certified', cert_number: '2A-TEST', expiry_date: isoDaysFromNow(30) }).expect(200);
      let { body } = await viewer.agent.get(`/api/certifications/${fcc.id}`).expect(200);
      expect(body.certification.expiry_status).toBe('expiring');
      expect(body.activity[0].changes.state).toEqual({ from: 'in_progress', to: 'certified' });

      await editor.agent.patch(`/api/certifications/${fcc.id}`).send({ expiry_date: isoDaysFromNow(-1) }).expect(200);
      ({ body } = await viewer.agent.get('/api/certifications?expiring=true').expect(200));
      expect(body.certifications).toEqual([expect.objectContaining({ id: fcc.id, expiry_status: 'expired' })]);

      await editor.agent.patch(`/api/certifications/${fcc.id}`).send({ expiry_date: isoDaysFromNow(400) }).expect(200);
      ({ body } = await viewer.agent.get('/api/certifications?expiring=true'));
      expect(body.certifications).toEqual([]);
    });
  });

  describe('documents and versions', () => {
    let manual;

    it('creates a document with a first version and numbers later versions', async () => {
      const { body } = await editor.agent
        .post('/api/documents')
        .send({ product_id: product.id, kind: 'manual', title: 'User manual', languages: 'English', first_version: { state: 'in_design' } })
        .expect(201);
      manual = body.document;
      expect(manual).toMatchObject({ latest_version: 'v1', latest_state: 'in_design', version_count: 1, languages: ['English'] });

      const { body: v2 } = await editor.agent.post(`/api/documents/${manual.id}/versions`).send({ state: 'in_review', notes: 'FCC section added' }).expect(201);
      expect(v2.version.version).toBe('v2');
      await editor.agent.post(`/api/documents/${manual.id}/versions`).send({ version: 'v2' }).expect(409);

      const { body: inReview } = await viewer.agent.get('/api/documents?state=in_review').expect(200);
      expect(inReview.documents.map((d) => d.id)).toEqual([manual.id]);
    });

    it('records who approved a version, and clears it when reopened', async () => {
      const { body } = await viewer.agent.get(`/api/documents/${manual.id}`).expect(200);
      const latest = body.versions[0];
      const { body: approved } = await admin.agent.patch(`/api/versions/${latest.id}`).send({ state: 'approved' }).expect(200);
      expect(approved.version.approved_at).toBeTruthy();
      const { body: detail } = await viewer.agent.get(`/api/documents/${manual.id}`);
      expect(detail.versions[0].approved_by_name).toBe('Admin');
      expect(detail.document.latest_state).toBe('approved');

      const { body: reopened } = await editor.agent.patch(`/api/versions/${latest.id}`).send({ state: 'in_review' }).expect(200);
      expect(reopened.version.approved_at).toBeNull();
      await editor.agent.patch(`/api/versions/${latest.id}`).send({ state: 'approved' }).expect(200);
    });
  });

  describe('design requests', () => {
    it('tracks requests from requested to approved', async () => {
      const { body } = await editor.agent
        .post('/api/design-requests')
        .send({ title: 'Box renders', type: 'render', product_id: product.id, assignee_id: editor.user.id, due_date: '2026-10-09' })
        .expect(201);
      expect(body.request).toMatchObject({ requested_by_name: 'Designer', assignee_name: 'Designer', state: 'requested' });
      await editor.agent.patch(`/api/design-requests/${body.request.id}`).send({ state: 'shipped' }).expect(400);
      await editor.agent.patch(`/api/design-requests/${body.request.id}`).send({ state: 'delivered' }).expect(200);

      const { body: open } = await viewer.agent.get('/api/design-requests?open=true').expect(200);
      expect(open.requests.map((r) => r.state)).toEqual(['delivered']);
    });
  });

  describe('attachments', () => {
    let cert;
    beforeAll(async () => {
      const { body } = await editor.agent.post('/api/certifications').send({ product_id: product.id, market_id: market.US.id, mark: 'PTCRB' }).expect(201);
      cert = body.certification;
    });

    it('reports whether uploads are on', async () => {
      const { body } = await viewer.agent.get('/api/attachments/config').expect(200);
      expect(body).toEqual({ uploads: true, maxUploadMb: 1 });
    });

    it('adds links, rejecting non-web links', async () => {
      const target = { entity_type: 'certification', entity_id: cert.id };
      await editor.agent.post('/api/attachments/link').send({ ...target, url: 'javascript:alert(1)' }).expect(400);
      await editor.agent.post('/api/attachments/link').send({ entity_type: 'user', entity_id: cert.id, url: 'https://x.test' }).expect(400);
      await editor.agent.post('/api/attachments/link').send({ ...target, entity_id: '00000000-0000-0000-0000-000000000000', url: 'https://x.test' }).expect(404);
      const { body } = await editor.agent.post('/api/attachments/link').send({ ...target, url: 'https://drive.google.com/file/abc', name: 'Test report' }).expect(201);
      expect(body.attachment).toMatchObject({ kind: 'link', name: 'Test report' });
    });

    it('uploads files, serves safe types inline and forces everything else to download', async () => {
      const pdf = await editor.agent
        .post('/api/attachments/file')
        .field('entity_type', 'certification')
        .field('entity_id', cert.id)
        .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'grant.pdf', contentType: 'application/pdf' })
        .expect(201);
      const res = await viewer.agent.get(`/api/attachments/${pdf.body.attachment.id}/download`).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline; filename="grant.pdf"/);
      expect(res.body.toString()).toBe('%PDF-1.4 test');
      await request(app).get(`/api/attachments/${pdf.body.attachment.id}/download`).expect(401);

      const html = await editor.agent
        .post('/api/attachments/file')
        .field('entity_type', 'certification')
        .field('entity_id', cert.id)
        .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: '../evil.html', contentType: 'text/html' })
        .expect(201);
      expect(html.body.attachment.name).toBe('evil.html'); // path parts stripped
      const dl = await viewer.agent.get(`/api/attachments/${html.body.attachment.id}/download`).expect(200);
      expect(dl.headers['content-type']).toBe('application/octet-stream');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);

      const { body } = await viewer.agent.get(`/api/certifications/${cert.id}`);
      expect(body.certification.attachments.map((a) => a.name)).toEqual(['Test report', 'grant.pdf', 'evil.html']);
      expect(body.activity.some((a) => a.action === 'attachment_added')).toBe(true);
    });

    it('rejects files over the size limit and uploads to missing records, leaving nothing on disk', async () => {
      const before = countFiles(filesDir);
      await editor.agent
        .post('/api/attachments/file')
        .field('entity_type', 'certification')
        .field('entity_id', cert.id)
        .attach('file', Buffer.alloc(1.5 * 1024 * 1024), { filename: 'big.bin' })
        .expect(413);
      await editor.agent
        .post('/api/attachments/file')
        .field('entity_type', 'certification')
        .field('entity_id', '00000000-0000-0000-0000-000000000000')
        .attach('file', Buffer.from('x'), { filename: 'x.txt' })
        .expect(404);
      await viewer.agent.post('/api/attachments/file').field('entity_type', 'certification').field('entity_id', cert.id).attach('file', Buffer.from('x'), 'x.txt').expect(403);
      expect(countFiles(filesDir)).toBe(before);
    });

    it('deletes files from disk with their attachment or their record', async () => {
      const { body } = await viewer.agent.get(`/api/certifications/${cert.id}`);
      const pdf = body.certification.attachments.find((a) => a.name === 'grant.pdf');
      const before = countFiles(filesDir);
      await editor.agent.delete(`/api/attachments/${pdf.id}`).expect(200);
      expect(countFiles(filesDir)).toBe(before - 1);

      await editor.agent.delete(`/api/certifications/${cert.id}`).expect(403);
      await admin.agent.delete(`/api/certifications/${cert.id}`).expect(200);
      expect(countFiles(filesDir)).toBe(before - 2);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM attachments');
      expect(rows[0].n).toBe(0);
    });

    it('refuses uploads when no file storage is configured', async () => {
      const noFiles = makeApp(db);
      const agent = request.agent(noFiles);
      await agent.post('/auth/local').send({ email: 'design@lunahome.com', password: 'correct horse battery' }).expect(200);
      const { body } = await agent.get('/api/attachments/config');
      expect(body.uploads).toBe(false);
      await agent.post('/api/attachments/file').field('entity_type', 'certification').field('entity_id', product.id).attach('file', Buffer.from('x'), 'x.txt').expect(503);
    });
  });

  describe('readiness and dashboard', () => {
    it('shows each product × market with certifications, manual and packaging', async () => {
      let { body } = await viewer.agent.get('/api/readiness').expect(200);
      expect(body.markets.map((m) => m.code)).toEqual(['US']);
      let cell = body.rows.find((r) => r.product.id === product.id).cells[market.US.id];
      // FCC certified (expires in 400 days) and manual approved, but no packaging yet.
      expect(cell).toMatchObject({ sells: true, status: 'in_progress', manual: { state: 'approved', shared: true }, packaging: null });
      expect(cell.certs).toEqual([expect.objectContaining({ mark: 'FCC', state: 'certified' })]);
      expect(body.rows.find((r) => r.product.id === other.id).cells[market.US.id]).toBeNull();

      // Selling somewhere with nothing recorded yet reads as "not tracked", not "not started".
      await editor.agent.patch(`/api/products/${other.id}`).send({ market_ids: [market.CA.id] }).expect(200);
      ({ body } = await viewer.agent.get('/api/readiness'));
      expect(body.rows.find((r) => r.product.id === other.id).cells[market.CA.id].status).toBe('not_tracked');
      await editor.agent.patch(`/api/products/${other.id}`).send({ market_ids: [] }).expect(200);

      await editor.agent
        .post('/api/documents')
        .send({ product_id: product.id, market_id: market.US.id, kind: 'packaging', title: 'Box', first_version: { state: 'sent' } })
        .expect(201);
      ({ body } = await viewer.agent.get(`/api/readiness?productId=${product.id}`));
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].cells[market.US.id].status).toBe('ready');

      const { body: certs } = await viewer.agent.get(`/api/certifications?productId=${product.id}`);
      await editor.agent.patch(`/api/certifications/${certs.certifications[0].id}`).send({ expiry_date: isoDaysFromNow(-5) }).expect(200);
      ({ body } = await viewer.agent.get(`/api/readiness?productId=${product.id}`));
      expect(body.rows[0].cells[market.US.id].status).toBe('attention');
    });

    it('surfaces certification alerts, documents in review and open requests', async () => {
      const { body: doc } = await editor.agent
        .post('/api/documents')
        .send({ product_id: product.id, kind: 'quick_start', title: 'Quick start', first_version: { state: 'in_review' } })
        .expect(201);
      const { body } = await viewer.agent.get('/api/dashboard').expect(200);
      expect(body.counts).toMatchObject({ expiring_certs: 1, open_requests: 1 });
      expect(body.certAlerts[0]).toMatchObject({ mark: 'FCC', expiry_status: 'expired' });
      expect(body.inReview.map((d) => d.id)).toEqual([doc.document.id]);
      expect(body.openRequests[0]).toMatchObject({ title: 'Box renders', state: 'delivered' });
    });
  });
});
