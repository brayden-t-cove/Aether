/**
 * Amazon Selling Partner API, read-only: the FBA customer returns report (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA),
 * the same report people download from Seller Central and upload by hand, so it imports the same way.
 *
 * Auth is Login with Amazon: a refresh token from self-authorizing a private app, swapped for an hour-long access
 * token sent as x-amz-access-token. Returns null when Amazon isn't set up.
 */
import { gunzipSync } from 'node:zlib';
import { decodeText, parseTable } from '../../shared/table.js';

export const AMAZON_REGIONS = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};
export const US_MARKETPLACE = 'ATVPDKIKX0DER';
const LWA_URL = 'https://api.amazon.com/auth/o2/token';
const REPORT_TYPE = 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA';

const fail = (message, status) => Object.assign(new Error(message), { status });

export function createAmazonSpClient({
  clientId,
  clientSecret,
  refreshToken,
  region = 'na',
  marketplaceId = US_MARKETPLACE,
  apiUrl,
  lwaUrl = LWA_URL,
  pollMs = 15_000,
  maxWaitMs = 15 * 60_000,
  timeoutMs = 30_000,
} = {}) {
  if (!clientId || !clientSecret || !refreshToken) return null;
  const base = (apiUrl || AMAZON_REGIONS[region] || AMAZON_REGIONS.na).replace(/\/$/, '');
  let cached = null;

  async function accessToken() {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    let res;
    try {
      res = await fetch(lwaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw fail(`Couldn't reach Amazon to sign in (${err.message})`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw fail(`Amazon refused the app's keys (${body.error_description || body.error || res.status}). Check AMAZON_SP_CLIENT_ID, _CLIENT_SECRET and _REFRESH_TOKEN.`, 401);
    }
    cached = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return cached.token;
  }

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { 'x-amz-access-token': await accessToken(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err.status) throw err;
      throw fail(`Couldn't reach Amazon (${err.message})`);
    }
    const data = await res.json().catch(() => null);
    const why = data?.errors?.[0]?.message;
    if (res.status === 403) throw fail(`Amazon refused the request${why ? `: ${why}` : ''}. The app needs the Amazon Fulfillment role.`, 403);
    if (res.status === 429) throw fail('Amazon is limiting requests. The next scheduled import will try again.', 429);
    if (!res.ok) throw fail(`Amazon returned ${res.status}${why ? `: ${why}` : ''}`, res.status);
    return data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    marketplaceId,
    /**
     * The returns report for a date range (YYYY-MM-DD, inclusive), as row objects keyed by the report's headers:
     * request it, wait until Amazon has built it, then download it. A range with no returns gives [].
     */
    async returnsReport({ from, to }) {
      const { reportId } = await request('POST', '/reports/2021-06-30/reports', {
        reportType: REPORT_TYPE,
        marketplaceIds: [marketplaceId],
        dataStartTime: `${from}T00:00:00Z`,
        dataEndTime: `${to}T23:59:59Z`,
      });
      const started = Date.now();
      let report;
      for (;;) {
        report = await request('GET', `/reports/2021-06-30/reports/${reportId}`);
        if (['DONE', 'CANCELLED', 'FATAL'].includes(report.processingStatus)) break;
        if (Date.now() - started > maxWaitMs) throw fail('Amazon took too long to build the returns report. The next import will try again.');
        await sleep(pollMs);
      }
      // Amazon cancels a report that would have no rows.
      if (report.processingStatus === 'CANCELLED') return [];
      if (report.processingStatus === 'FATAL') throw fail('Amazon could not build the returns report');
      const doc = await request('GET', `/reports/2021-06-30/documents/${report.reportDocumentId}`);
      const file = await fetch(doc.url, { signal: AbortSignal.timeout(timeoutMs * 4) });
      if (!file.ok) throw fail(`Couldn't download the report from Amazon (${file.status})`);
      let bytes = Buffer.from(await file.arrayBuffer());
      if (doc.compressionAlgorithm === 'GZIP') bytes = gunzipSync(bytes);
      return parseTable(decodeText(bytes));
    },
  };
}
