/**
 * A stand-in for Odyssey's API, for tests and end-to-end runs. It speaks the
 * contract in docs/ODYSSEY_API.md: Bearer service key, GET /api/catalog,
 * /api/sessions, /api/vendors and POST /api/catalog.
 */
import express from 'express';
import { randomUUID } from 'node:crypto';

export function sampleOdysseyData() {
  return {
    catalog: [
      { id: 'ody-w4', name: 'W4', manufacturer: 'Sample Factory', modelNumber: 'W4', category: 'camera', status: 'active', entity: ['Luna'] },
      { id: 'ody-hub', name: 'Sample Hub', manufacturer: 'Sample Factory', modelNumber: 'HB1', version: 'V2', category: 'hub', status: 'in-development', entity: ['Luna'] },
      { id: 'ody-old', name: 'Old Sensor', modelNumber: 'OS1', category: 'sensor', status: 'discontinued', entity: ['Luna'] },
    ],
    sessions: [
      { id: 'ses-1', productName: 'W4', catalogId: 'ody-w4', status: 'completed', testPlan: 'production', testerName: 'Tester', createdAt: '2026-09-01T10:00:00Z', completedAt: '2026-09-01T12:00:00Z', testCaseCount: 40, passCount: 37, failCount: 2, skipCount: 1, issueCount: 3 },
      { id: 'ses-2', productName: 'Sample Hub', catalogId: 'ody-hub', status: 'in_progress', testPlan: 'regression', createdAt: '2026-09-20T10:00:00Z', testCaseCount: 10, passCount: 4, failCount: 0, skipCount: 0, issueCount: 0 },
    ],
    vendors: [
      { id: 'ven-1', name: 'Sample Factory', relationshipStatus: 'Active', website: 'https://factory.example', notes: 'Main OEM', contacts: [{ name: 'Alex', role: 'Sales', email: 'alex@factory.example', wechat: 'alex_w' }] },
      { id: 'ven-2', name: 'Prospect Labs', relationshipStatus: 'Prospect', contacts: [] },
    ],
  };
}

export async function startFakeOdyssey({ apiKey = 'test-service-key', data = sampleOdysseyData(), port = 0 } = {}) {
  const state = { ...data, created: [], requests: 0, down: false };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    state.requests++;
    if (state.down) return res.status(503).json({ error: 'Odyssey is down' });
    if (req.get('authorization') !== `Bearer ${apiKey}`) return res.status(401).json({ error: 'Not authenticated' });
    next();
  });
  app.get('/api/catalog', (req, res) => res.json(state.catalog));
  app.get('/api/sessions', (req, res) => res.json(state.sessions));
  app.get('/api/vendors', (req, res) => res.json(state.vendors));
  app.post('/api/catalog', (req, res) => {
    if (!req.body?.name || !req.body?.category) return res.status(400).json({ error: 'name and category required' });
    const entry = { ...req.body, id: `ody-${randomUUID().slice(0, 8)}`, status: 'pending_review' };
    state.catalog.push(entry);
    state.created.push(entry);
    res.status(201).json(entry);
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    apiKey,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
