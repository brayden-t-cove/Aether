/**
 * TikTok Shop Open API (version 202309), read-only: the shop's returns, imported like TikTok's returns export.
 *
 * Every request is signed: HMAC-SHA256, keyed with the app secret, over secret + path + the query parameters sorted
 * by name (as name+value, leaving out sign and access_token) + the JSON body + secret. The access token goes in the
 * x-tts-access-token header. Access tokens are short-lived and come from a refresh token, which TikTok may replace on
 * each refresh, so the latest tokens are kept in the database (job_state) rather than only in the environment.
 *
 * The returns search's field names come from TikTok's API reference as known when this was written, but weren't
 * checked against a live response. Each run records the field names TikTok actually sent (names only) so the mapping
 * in toImportRow() can be confirmed; see docs/MARKETPLACE_APIS.md.
 */
import { createHmac } from 'node:crypto';

export const TIKTOK_API_URL = 'https://open-api.tiktokglobalshop.com';
export const TIKTOK_AUTH_URL = 'https://auth.tiktok-shops.com';
const VERSION = '202309';
const TOKENS_KEY = 'tiktok_tokens';
// Where the buyer's own words may be. Unconfirmed: the first live run shows which fields TikTok sends.
const NOTE_FIELDS = ['buyer_remarks', 'buyer_remark', 'return_reason_description', 'description', 'buyer_note', 'remark'];

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The request signature (see above). */
export function signRequest({ secret, path, query, body = '' }) {
  const params = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join('');
  return createHmac('sha256', secret).update(`${secret}${path}${params}${body}${secret}`).digest('hex');
}

/** Tokens kept in job_state, so a refresh token TikTok replaces survives restarts. */
export function tokenStore(db) {
  return {
    async load() {
      const { rows } = await db.query('SELECT value FROM job_state WHERE key = $1', [TOKENS_KEY]);
      try {
        return rows[0] ? JSON.parse(rows[0].value) : null;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      await db.query(
        `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [TOKENS_KEY, JSON.stringify(tokens)],
      );
    },
  };
}

// TikTok gives token expiry as a Unix time; tolerate a lifetime in seconds too.
const expiry = (v) => {
  const n = Number(v) || 0;
  return n > 1e9 ? n * 1000 : Date.now() + n * 1000;
};

export function createTiktokShopClient({ appKey, appSecret, refreshToken = '', shopCipher = '', apiUrl = TIKTOK_API_URL, authUrl = TIKTOK_AUTH_URL, store = null, timeoutMs = 30_000 } = {}) {
  if (!appKey || !appSecret) return null;
  const api = apiUrl.replace(/\/$/, '');
  const auth = authUrl.replace(/\/$/, '');
  let tokens = null;

  async function loadTokens() {
    if (!tokens) tokens = (await store?.load()) || (refreshToken ? { refresh_token: refreshToken } : null);
    return tokens;
  }
  async function saveTokens(data) {
    tokens = {
      ...tokens,
      access_token: data.access_token,
      access_expires: expiry(data.access_token_expire_in),
      refresh_token: data.refresh_token || tokens?.refresh_token,
      refresh_expires: data.refresh_token_expire_in ? expiry(data.refresh_token_expire_in) : tokens?.refresh_expires,
      shop_name: data.seller_name || tokens?.shop_name,
    };
    await store?.save(tokens);
  }

  async function tokenCall(path, params) {
    let res;
    try {
      res = await fetch(`${auth}${path}?${new URLSearchParams({ app_key: appKey, app_secret: appSecret, ...params })}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw fail(`Couldn't reach TikTok to sign in (${err.message})`);
    }
    const body = await res.json().catch(() => ({}));
    if (body.code !== 0 || !body.data?.access_token) throw fail(`TikTok refused the sign-in (${body.message || res.status}). Authorize the shop again from Admin → Integrations.`, 401);
    await saveTokens(body.data);
    return tokens;
  }

  async function accessToken(force = false) {
    const t = await loadTokens();
    if (!t?.refresh_token) throw fail("TikTok isn't authorized for the shop yet. Authorize it from Admin → Integrations.", 401);
    if (!force && t.access_token && t.access_expires > Date.now() + 5 * 60_000) return t.access_token;
    return (await tokenCall('/api/v2/token/refresh', { refresh_token: t.refresh_token, grant_type: 'refresh_token' })).access_token;
  }

  async function request(method, path, { query = {}, body = null, cipher = true } = {}, retried = false) {
    const q = { app_key: appKey, timestamp: String(Math.floor(Date.now() / 1000)), ...query };
    if (cipher) q.shop_cipher = await shop();
    const json = body ? JSON.stringify(body) : '';
    q.sign = signRequest({ secret: appSecret, path, query: q, body: json });
    let res;
    try {
      res = await fetch(`${api}${path}?${new URLSearchParams(q)}`, {
        method,
        headers: { 'x-tts-access-token': await accessToken(), 'Content-Type': 'application/json' },
        body: body ? json : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err.status) throw err;
      throw fail(`Couldn't reach TikTok (${err.message})`);
    }
    const data = await res.json().catch(() => null);
    // An expired or revoked access token: refresh once and try again.
    if ((res.status === 401 || /token/i.test(data?.message || '')) && data?.code !== 0 && !retried) {
      await accessToken(true);
      return request(method, path, { query, body, cipher }, true);
    }
    if (!data || data.code !== 0) throw fail(`TikTok returned an error${data?.message ? `: ${data.message}` : ` (${res.status})`}`, res.status);
    return data.data;
  }

  let cipherCache = shopCipher;
  async function shop() {
    if (cipherCache) return cipherCache;
    const t = await loadTokens();
    if (t?.shop_cipher) return (cipherCache = t.shop_cipher);
    const data = await request('GET', `/authorization/${VERSION}/shops`, { cipher: false });
    const first = data?.shops?.[0];
    if (!first?.cipher) throw fail('TikTok listed no shops for this app. Authorize the shop again.');
    cipherCache = first.cipher;
    await store?.save({ ...tokens, shop_cipher: first.cipher, shop_name: first.name || tokens?.shop_name });
    tokens = { ...tokens, shop_cipher: first.cipher };
    return cipherCache;
  }

  return {
    /** Swap the code from TikTok's shop authorization for tokens, and keep them. */
    async authorize(code) {
      tokens = tokens || {};
      await tokenCall('/api/v2/token/get', { auth_code: code, grant_type: 'authorized_code' });
      return { shop: tokens.shop_name || null };
    },
    async status() {
      const t = await loadTokens();
      return { authorized: Boolean(t?.refresh_token), shop: t?.shop_name || null, refreshExpires: t?.refresh_expires || null };
    },
    /**
     * Returns requested in a date range (YYYY-MM-DD, inclusive, UTC days), as rows shaped like TikTok's returns export,
     * so the same import reads them. `fields` lists the field names TikTok sent, to check the mapping.
     */
    async returnsReport({ from, to }) {
      const ge = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
      const lt = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + 86400;
      const orders = [];
      let pageToken = '';
      for (let page = 0; page < 200; page++) {
        const data = await request('POST', `/return_refund/${VERSION}/returns/search`, {
          query: { page_size: '50', ...(pageToken && { page_token: pageToken }) },
          body: { create_time_ge: ge, create_time_lt: lt },
        });
        if (!Array.isArray(data?.return_orders)) {
          throw fail(`TikTok's returns search didn't return a list of returns (it sent: ${Object.keys(data || {}).join(', ') || 'nothing'})`);
        }
        orders.push(...data.return_orders);
        pageToken = data.next_page_token || '';
        if (!pageToken) break;
      }
      const fields = new Set();
      for (const o of orders) {
        for (const k of Object.keys(o)) fields.add(k);
        for (const li of o.return_line_items || []) for (const k of Object.keys(li)) fields.add(`return_line_items.${k}`);
      }
      const rows = orders.map(toImportRow);
      rows.fields = [...fields].sort();
      return rows;
    },
  };
}

const phoenixTime = (unix) =>
  new Date(Number(unix) * 1000).toLocaleString('sv-SE', { timeZone: 'America/Phoenix', hour12: false }).replace('T', ' ');

/**
 * One TikTok return as a row of TikTok's returns export. A return of several items is one return (one piece of
 * feedback), filed under its first item's product, with every item counted in its quantity.
 */
export function toImportRow(o) {
  const items = o.return_line_items || [];
  const first = items[0] || {};
  const note = NOTE_FIELDS.map((f) => o[f]).find((v) => typeof v === 'string' && v.trim()) || '';
  return {
    'Return Order ID': String(o.return_id ?? ''),
    'Order ID': String(o.order_id ?? ''),
    'Product Name': first.product_name || '',
    'Seller SKU': first.seller_sku || '',
    'SKU ID': first.sku_id ? String(first.sku_id) : '',
    'Product ID': first.product_id ? String(first.product_id) : '',
    Quantity: String(Math.max(items.length, 1)),
    'Return Reason': o.return_reason_text || o.return_reason || '',
    'Buyer Note': note,
    'Time Requested': o.create_time ? phoenixTime(o.create_time) : '',
    'Return Status': o.return_status || '',
  };
}
