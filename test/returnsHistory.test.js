import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';
import { startFakeAmazon } from './fake-amazon.js';
import { createAmazonSpClient } from '../server/lib/amazonSp.js';
import { historyState, monthWindows, runHistoryImport } from '../server/lib/autoImports.js';

describe('past returns, a month at a time', () => {
  it('cuts a range into month-sized windows, oldest first', () => {
    expect(monthWindows('2026-08-15', '2026-10-29')).toEqual([
      { from: '2026-08-15', to: '2026-08-31' },
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-10-01', to: '2026-10-29' },
    ]);
    expect(monthWindows('2025-12-01', '2026-01-10')).toEqual([
      { from: '2025-12-01', to: '2025-12-31' },
      { from: '2026-01-01', to: '2026-01-10' },
    ]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('bringing in past marketplace returns', () => {
  let db, fake, editor, viewer;
  const amazonConfig = () => ({ ...fake.keys, apiUrl: fake.apiUrl, lwaUrl: fake.lwaUrl, pollMs: 5 });
  const waitForHistory = async () => {
    for (let i = 0; i < 200; i++) {
      const state = await historyState(db, 'amazon');
      if (state && state.status !== 'running') return state;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('history import never finished');
  };

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeAmazon();
    const app = makeApp(db, { amazonSp: amazonConfig() });
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor', name: 'Ed' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
  });
  afterAll(async () => {
    await fake?.close();
    await db?.end();
  });

  it('brings in each month from the chosen date to today in the background, and shows how far it got', async () => {
    await viewer.post('/api/returns/auto-imports/amazon/history').send({ from: '2026-08-01' }).expect(403);
    const before = fake.state.created.length;
    const { body } = await editor.post('/api/returns/auto-imports/amazon/history').send({ from: '2026-08-01' }).expect(202);
    expect(body.message).toMatch(/Bringing in past Amazon returns/);

    const state = await waitForHistory();
    expect(state).toMatchObject({ status: 'done', from: '2026-08-01', created: 2, error: null });
    // One report per month: August, September, then October up to today.
    expect(fake.state.created.slice(before).map((c) => c.dataStartTime.slice(0, 10)).slice(0, 3)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM sync_runs WHERE source = 'amazon_returns' AND trigger = 'history' AND ok");
    expect(rows[0].n).toBe(fake.state.created.length - before);

    const { body: status } = await viewer.get('/api/returns/auto-imports').expect(200);
    expect(status.amazon.history).toMatchObject({ status: 'done', created: 2 });
  });

  it('never counts a return twice when it runs again', async () => {
    await editor.post('/api/returns/auto-imports/amazon/history').send({ from: '2026-09-01' }).expect(202);
    expect(await waitForHistory()).toMatchObject({ status: 'done', created: 0 });
    const { rows } = await db.query('SELECT count(*)::int AS n FROM returns');
    expect(rows[0].n).toBe(2);
  });

  it('picks up after the last month done when a restart cut it off, and stops on an error', async () => {
    const client = createAmazonSpClient(amazonConfig());
    const before = fake.state.created.length;
    const resumed = await runHistoryImport(db, {
      channel: 'amazon',
      client,
      resume: { status: 'interrupted', from: '2026-07-01', to: '2026-10-29', through: '2026-09-30', created: 5, units: 5 },
    });
    expect(resumed).toMatchObject({ status: 'done', created: 5 });
    expect(fake.state.created.slice(before).map((c) => c.dataStartTime.slice(0, 10))[0]).toBe('2026-10-01');

    const wrong = createAmazonSpClient({ ...amazonConfig(), clientSecret: 'nope' });
    const failed = await runHistoryImport(db, { channel: 'amazon', client: wrong, from: '2026-09-01' });
    expect(failed).toMatchObject({ status: 'failed', through: null });
    expect(failed.error).toMatch(/Amazon refused the app's keys/);
  });
});
