import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

const countFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length : 0);

// Test results added by hand: a title and result, with the report as an uploaded PDF or a link.
describe.skipIf(!TEST_DATABASE_URL)('test reports', () => {
  let db, filesDir, editor, viewer, product, project;

  beforeAll(async () => {
    db = await setupDb();
    filesDir = mkdtempSync(join(tmpdir(), 'aether-files-'));
    const app = makeApp(db, { filesDir });
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
    ({ body: { product } } = await editor.post('/api/products').send({ name: 'Porch Cam', model: 'PC1' }).expect(201));
    ({ rows: [project] } = await db.query("INSERT INTO projects (name, product_id) VALUES ('Porch Cam launch', $1) RETURNING id", [product.id]));
  });
  afterAll(async () => {
    rmSync(filesDir, { recursive: true, force: true });
    await db?.end();
  });

  it('adds a result from a project, filed under its product, with an uploaded PDF', async () => {
    await viewer.post('/api/test-reports').send({ project_id: project.id, title: 'Drop test' }).expect(403);
    const { body } = await editor
      .post('/api/test-reports')
      .send({ project_id: project.id, title: 'Drop test', result: 'passed', tested_on: '2026-10-01', tested_by: 'Sample Lab' })
      .expect(201);
    expect(body.report).toMatchObject({ product_id: product.id, project_id: project.id, title: 'Drop test', result: 'passed', tested_on: '2026-10-01' });
    await editor
      .post('/api/attachments/file')
      .field('entity_type', 'test_report')
      .field('entity_id', body.report.id)
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'drop-test.pdf', contentType: 'application/pdf' })
      .expect(201);

    // The product and every project for it see it.
    const byProduct = await viewer.get(`/api/test-reports?productId=${product.id}`).expect(200);
    const byProject = await viewer.get(`/api/test-reports?projectId=${project.id}`).expect(200);
    expect(byProject.body).toEqual(byProduct.body);
    expect(byProduct.body.reports).toHaveLength(1);
    expect(byProduct.body.reports[0]).toMatchObject({ project_name: 'Porch Cam launch', created_by_name: 'Ed' });
    expect(byProduct.body.reports[0].attachments.map((a) => a.name)).toEqual(['drop-test.pdf']);

    const { body: log } = await viewer.get('/api/activity').expect(200);
    expect(log.activity.map((a) => [a.entity_type, a.action])).toEqual(
      expect.arrayContaining([
        ['product', 'test_report_added'],
        ['product', 'attachment_added'],
      ]),
    );
    expect(log.activity.find((a) => a.action === 'attachment_added').changes).toMatchObject({ label: 'drop-test.pdf', report: 'Drop test' });
  });

  it('takes a link to the report instead, and checks what it is given', async () => {
    const { body } = await editor.post('/api/test-reports').send({ product_id: product.id, title: 'FCC pre-scan', result: 'partial' }).expect(201);
    await editor.post('/api/attachments/link').send({ entity_type: 'test_report', entity_id: body.report.id, url: 'https://example.com/prescan.pdf', name: 'FCC pre-scan' }).expect(201);
    const { body: list } = await viewer.get(`/api/test-reports?productId=${product.id}`).expect(200);
    expect(list.reports.find((r) => r.id === body.report.id).attachments[0]).toMatchObject({ kind: 'link', url: 'https://example.com/prescan.pdf' });

    await editor.post('/api/test-reports').send({ product_id: product.id }).expect(400);
    await editor.post('/api/test-reports').send({ product_id: product.id, title: 'x', result: 'great' }).expect(400);
    await editor.post('/api/test-reports').send({ title: 'x' }).expect(400);
    const { rows: [bare] } = await db.query("INSERT INTO projects (name) VALUES ('No product') RETURNING id");
    await editor.post('/api/test-reports').send({ project_id: bare.id, title: 'x' }).expect(400);
  });

  it('edits a result, logging what changed', async () => {
    const { body: list } = await viewer.get(`/api/test-reports?productId=${product.id}`).expect(200);
    const prescan = list.reports.find((r) => r.title === 'FCC pre-scan');
    await viewer.patch(`/api/test-reports/${prescan.id}`).send({ result: 'passed' }).expect(403);
    const { body } = await editor.patch(`/api/test-reports/${prescan.id}`).send({ result: 'passed', notes: 'Retest after shield fix' }).expect(200);
    expect(body.report).toMatchObject({ result: 'passed', notes: 'Retest after shield fix' });
    expect(body.report.attachments).toHaveLength(1);
    const { body: log } = await viewer.get('/api/activity').expect(200);
    expect(log.activity.find((a) => a.action === 'test_report_updated').changes.result).toEqual({ from: 'partial', to: 'passed' });
  });

  it('removes a result with its files', async () => {
    const { body: list } = await viewer.get(`/api/test-reports?productId=${product.id}`).expect(200);
    const drop = list.reports.find((r) => r.title === 'Drop test');
    expect(countFiles(filesDir)).toBe(1);
    await viewer.delete(`/api/test-reports/${drop.id}`).expect(403);
    await editor.delete(`/api/test-reports/${drop.id}`).expect(200);
    await editor.delete(`/api/test-reports/${drop.id}`).expect(404);
    expect(countFiles(filesDir)).toBe(0);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM attachments WHERE entity_type = 'test_report' AND entity_id = $1", [drop.id]);
    expect(rows[0].n).toBe(0);
  });
});
