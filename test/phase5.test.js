import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotifier } from '../server/lib/notify.js';
import { maybeSendDigest } from '../server/lib/digest.js';
import { makeApp, setupDb, signedInAgent, testConfig, TEST_DATABASE_URL } from './helpers.js';
import { startFakeSlack } from './fake-slack.js';

describe.skipIf(!TEST_DATABASE_URL)('phase 5: notifications, digest, integrations', () => {
  let db, slack, app, admin, editor, viewer, product, market;
  const config = () => ({ slack: { webhookUrl: slack.url, digestHourUtc: 14 }, publicUrl: 'https://aether.test', appEnv: 'staging' });

  beforeAll(async () => {
    db = await setupDb();
    slack = await startFakeSlack();
    app = makeApp(db, config());
    admin = await signedInAgent(app, db, { email: 'admin@lunahome.com', role: 'admin', name: 'Admin' });
    editor = await signedInAgent(app, db, { email: 'pd@lunahome.com', role: 'editor', name: 'Brayden' });
    viewer = await signedInAgent(app, db, { email: 'boss@lunahome.com', role: 'viewer' });
    ({ body: { product } } = await editor.agent.post('/api/products').send({ name: 'Doorbell V2', model: 'ER05303' }));
    market = (await viewer.agent.get('/api/markets')).body.markets.find((m) => m.code === 'US');
  });
  afterAll(async () => {
    await slack?.close();
    await db?.end();
  });

  it('tells the app which environment it is in', async () => {
    const { body } = await request(app).get('/api/me');
    expect(body.env).toBe('staging');
  });

  it('posts to Slack when work is blocked, certified, ready for review, delivered or imported', async () => {
    const { body: p } = await editor.agent.post('/api/projects').send({ name: 'Doorbell V2 — US launch', product_id: product.id }).expect(201);
    const { body: item } = await editor.agent.post(`/api/projects/${p.project.id}/items`).send({ title: 'MP samples from the factory' }).expect(201);
    await editor.agent.patch(`/api/items/${item.item.id}`).send({ state: 'blocked', notes: 'No reply since Tuesday' }).expect(200);

    const { body: cert } = await editor.agent.post('/api/certifications').send({ product_id: product.id, market_id: market.id, mark: 'FCC' }).expect(201);
    await editor.agent.patch(`/api/certifications/${cert.certification.id}`).send({ state: 'certified' }).expect(200);

    const { body: doc } = await editor.agent.post('/api/documents').send({ product_id: product.id, title: 'User manual', first_version: { state: 'draft' } }).expect(201);
    const { body: v2 } = await editor.agent.post(`/api/documents/${doc.document.id}/versions`).send({ state: 'in_review' }).expect(201);
    await admin.agent.patch(`/api/versions/${v2.version.id}`).send({ state: 'approved' }).expect(200);

    const { body: req } = await editor.agent.post('/api/design-requests').send({ title: 'Box renders', assignee_id: editor.user.id }).expect(201);
    await editor.agent.patch(`/api/design-requests/${req.request.id}`).send({ state: 'delivered' }).expect(200);

    await editor.agent
      .post('/api/returns/import')
      .send({ channel: 'amazon', rows: [{ 'return-date': '2026-09-01', sku: 'X', 'product-name': 'Doorbell V2', quantity: '2', reason: 'DEFECTIVE' }] })
      .expect(200);

    const msgs = await slack.waitFor(7);
    expect(msgs).toHaveLength(7);
    expect(msgs.every((m) => m.startsWith('[staging] '))).toBe(true);
    expect(msgs[0]).toMatch(/<https:\/\/aether\.test\/projects\/.+\|MP samples from the factory> was marked \*Blocked\* in Doorbell V2 — US launch by Brayden\n> No reply since Tuesday/);
    expect(msgs[1]).toMatch(/FCC for Doorbell V2 \(US\).* is \*certified\*/);
    expect(msgs[2]).toMatch(/User manual v2.*ready for review/);
    expect(msgs[3]).toMatch(/User manual v2.*approved by Admin/);
    expect(msgs[4]).toMatch(/New design request: .*Box renders.* for Brayden/);
    expect(msgs[5]).toMatch(/Box renders.* was delivered/);
    expect(msgs[6]).toMatch(/imported 1 Amazon returns \(2 units\)/);
  });

  it('never breaks a request when Slack is down', async () => {
    slack.state.fail = true;
    const before = slack.messages.length;
    const { body: p } = await editor.agent.post('/api/projects').send({ name: 'Still works' }).expect(201);
    await editor.agent.patch(`/api/projects/${p.project.id}`).send({ state: 'done' }).expect(200);
    slack.state.fail = false;
    expect(slack.messages.length).toBe(before);
  });

  it('sends the daily digest once a day, after the configured hour', async () => {
    const notifier = createNotifier(config());
    const start = slack.messages.length;
    expect(await maybeSendDigest(db, notifier, { hourUtc: 14, now: new Date('2026-09-25T13:00:00Z') })).toBe(false);
    expect(await maybeSendDigest(db, notifier, { hourUtc: 14, now: new Date('2026-09-25T15:00:00Z') })).toBe(true);
    expect(await maybeSendDigest(db, notifier, { hourUtc: 14, now: new Date('2026-09-25T18:00:00Z') })).toBe(false);
    const msgs = await slack.waitFor(start + 1);
    expect(msgs.at(-1)).toMatch(/Aether daily digest/);
    expect(msgs.at(-1)).toMatch(/\*Blocked \(1\)\*\n• .*MP samples from the factory/);
    expect(await maybeSendDigest(db, notifier, { hourUtc: 14, now: new Date('2026-09-26T15:00:00Z') })).toBe(true);
  });

  it('shows admins what is connected, without secrets, and has test buttons', async () => {
    await editor.agent.get('/api/admin/integrations').expect(403);
    const { body } = await admin.agent.get('/api/admin/integrations').expect(200);
    expect(body).toMatchObject({
      app: { env: 'staging', googleSignIn: false },
      odyssey: { configured: false },
      slack: { configured: true, digestHourUtc: 14, lastDigestDate: '2026-09-26' },
      uploads: { enabled: false },
    });
    expect(body.database.migrations.length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(body)).not.toContain(slack.url);

    const before = slack.messages.length;
    await admin.agent.post('/api/admin/integrations/slack-test').expect(200);
    await admin.agent.post('/api/admin/integrations/digest').expect(200);
    expect((await slack.waitFor(before + 2)).length).toBe(before + 2);
  });

  it('reports Slack as not set up when there is no webhook', async () => {
    const plain = makeApp(db, { slack: { webhookUrl: '' } });
    const agent = request.agent(plain);
    await agent.post('/auth/local').send({ email: 'admin@lunahome.com', password: 'correct horse battery' }).expect(200);
    await agent.post('/api/admin/integrations/slack-test').expect(503);
    const { body } = await agent.get('/api/me');
    expect(body.env).toBe(testConfig.appEnv);
  });
});
