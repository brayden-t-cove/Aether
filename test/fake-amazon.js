/**
 * A stand-in for Amazon's Login with Amazon token service and the Selling Partner API Reports endpoints Aether uses,
 * serving a made-up FBA customer returns report. A report is "in progress" on its first check and done on the next;
 * a date range with no returns is cancelled, as Amazon does. Mutate `rows` to change what it serves.
 */
import express from 'express';
import { gzipSync } from 'node:zlib';

const HEADERS = ['return-date', 'order-id', 'sku', 'asin', 'fnsku', 'product-name', 'quantity', 'fulfillment-center-id', 'detailed-disposition', 'reason', 'status', 'license-plate-number', 'customer-comments'];

export function sampleAmazonRows() {
  const row = (date, order, qty, reason, lpn, comment) => ({
    'return-date': `${date}T10:00:00+00:00`,
    'order-id': order,
    sku: 'SD-SKU',
    asin: 'B0SAMPLE1',
    fnsku: 'X00SAMPLE',
    'product-name': 'Sample Doorbell 2K',
    quantity: String(qty),
    'fulfillment-center-id': 'PHX7',
    'detailed-disposition': 'SELLABLE',
    reason,
    status: 'Unit returned to inventory',
    'license-plate-number': lpn,
    'customer-comments': comment,
  });
  return [
    row('2026-10-02', '111-0001-0001', 1, 'DEFECTIVE', 'LPNA0001', 'Keeps going offline’ every night'),
    // One order, two units: one return.
    row('2026-10-05', '111-0002-0002', 1, 'UNWANTED_ITEM', 'LPNA0002', ''),
    row('2026-10-05', '111-0002-0002', 1, 'UNWANTED_ITEM', 'LPNA0003', ''),
  ];
}

export async function startFakeAmazon({ clientId = 'amzn-client', clientSecret = 'amzn-secret', refreshToken = 'Atzr|refresh' } = {}) {
  const rows = sampleAmazonRows();
  const reports = new Map();
  const state = { tokens: 0, created: [] };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.post('/auth/o2/token', (req, res) => {
    const b = req.body;
    if (b.grant_type !== 'refresh_token' || b.client_id !== clientId || b.client_secret !== clientSecret || b.refresh_token !== refreshToken) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Client authentication failed' });
    }
    state.tokens++;
    res.json({ access_token: 'Atza|access', token_type: 'bearer', expires_in: 3600 });
  });

  const authed = (req, res, next) => (req.headers['x-amz-access-token'] === 'Atza|access' ? next() : res.status(403).json({ errors: [{ message: 'Access denied' }] }));

  app.post('/reports/2021-06-30/reports', authed, (req, res) => {
    const { reportType, marketplaceIds, dataStartTime, dataEndTime } = req.body;
    if (reportType !== 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA' || !marketplaceIds?.length) return res.status(400).json({ errors: [{ message: 'Bad request' }] });
    const id = String(reports.size + 1);
    const picked = rows.filter((r) => r['return-date'] >= dataStartTime.slice(0, 10) && r['return-date'].slice(0, 10) <= dataEndTime.slice(0, 10));
    reports.set(id, { checks: 0, rows: picked });
    state.created.push({ dataStartTime, dataEndTime });
    res.status(202).json({ reportId: id });
  });
  app.get('/reports/2021-06-30/reports/:id', authed, (req, res) => {
    const r = reports.get(req.params.id);
    if (!r) return res.status(404).json({ errors: [{ message: 'Not found' }] });
    r.checks++;
    if (r.checks < 2) return res.json({ reportId: req.params.id, processingStatus: 'IN_PROGRESS' });
    if (!r.rows.length) return res.json({ reportId: req.params.id, processingStatus: 'CANCELLED' });
    res.json({ reportId: req.params.id, processingStatus: 'DONE', reportDocumentId: `doc-${req.params.id}` });
  });
  app.get('/reports/2021-06-30/documents/:docId', authed, (req, res) => {
    res.json({ reportDocumentId: req.params.docId, url: `${base}/files/${req.params.docId}`, compressionAlgorithm: 'GZIP' });
  });
  // The pre-signed download: no Amazon token, gzipped, in Windows-1252 like Amazon's US reports.
  app.get('/files/:docId', (req, res) => {
    const r = reports.get(req.params.docId.replace('doc-', ''));
    const text = [HEADERS.join('\t'), ...r.rows.map((row) => HEADERS.map((h) => row[h]).join('\t'))].join('\n') + '\n';
    res.type('application/octet-stream').send(gzipSync(Buffer.from(text.replace(/’/g, '\x92'), 'latin1')));
  });

  let base;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    apiUrl: base,
    lwaUrl: `${base}/auth/o2/token`,
    keys: { clientId, clientSecret, refreshToken },
    rows,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
