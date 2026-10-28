/**
 * A stand-in for TikTok Shop's token service and the Open API calls Aether makes: it checks each request's signature
 * and access token, rotates the refresh token on every refresh (so Aether must keep the newest), lists one shop, and
 * pages through made-up returns. Set `state.expireAccess` to make the next API call fail with an expired token.
 */
import express from 'express';
import { signRequest } from '../server/lib/tiktokShop.js';

const at = (iso) => Math.floor(Date.parse(iso) / 1000);

export function sampleTiktokReturns() {
  const item = (name, sku) => ({ return_line_item_id: `li-${sku}`, product_name: name, seller_sku: sku, sku_id: `9${sku.length}00`, product_id: '1729000001' });
  return [
    {
      return_id: '5770001',
      order_id: '5760001',
      return_status: 'AWAITING_BUYER_SHIP',
      return_reason: 'ecom_order_delivered_refund_and_return_reason_not_as_described',
      return_reason_text: 'Not as described',
      buyer_remarks: 'Too big for my porch light and keeps going offline',
      create_time: at('2026-10-03T16:00:00Z'),
      return_line_items: [item('Sample Bulb Cam', 'SBC-1')],
    },
    {
      return_id: '5770002',
      order_id: '5760002',
      return_status: 'REQUEST_SUCCESS',
      return_reason_text: 'No longer needed',
      create_time: at('2026-10-06T16:00:00Z'),
      // One request covering two items: one return, two units.
      return_line_items: [item('Sample Bulb Cam', 'SBC-1'), item('Sample Bulb Cam', 'SBC-1')],
    },
    {
      return_id: '5770003',
      order_id: '5760003',
      return_status: 'RETURN_OR_REFUND_CANCEL',
      return_reason_text: 'Defective',
      buyer_remarks: 'Stopped working after a week',
      create_time: at('2026-10-08T16:00:00Z'),
      return_line_items: [item('Sample Bulb Cam', 'SBC-1')],
    },
  ];
}

export async function startFakeTiktok({ appKey = 'tt-app', appSecret = 'tt-secret', pageSize = 2 } = {}) {
  const returns = sampleTiktokReturns();
  const state = { refreshes: 0, refreshToken: '', accessToken: '', expireAccess: false, badSign: 0 };
  const app = express();
  app.use(express.json());

  const issue = (res) => {
    state.refreshes++;
    state.accessToken = `tt-access-${state.refreshes}`;
    state.refreshToken = `tt-refresh-${state.refreshes}`;
    const now = Math.floor(Date.now() / 1000);
    res.json({
      code: 0,
      message: 'success',
      data: { access_token: state.accessToken, access_token_expire_in: now + 3600, refresh_token: state.refreshToken, refresh_token_expire_in: now + 30 * 86400, seller_name: 'Sample Shop' },
    });
  };
  const appOk = (q) => q.app_key === appKey && q.app_secret === appSecret;
  app.get('/api/v2/token/get', (req, res) => {
    if (!appOk(req.query) || req.query.grant_type !== 'authorized_code' || req.query.auth_code !== 'auth-code-1') return res.json({ code: 36004004, message: 'invalid auth code' });
    issue(res);
  });
  app.get('/api/v2/token/refresh', (req, res) => {
    if (!appOk(req.query) || req.query.grant_type !== 'refresh_token' || req.query.refresh_token !== state.refreshToken) return res.json({ code: 36004005, message: 'invalid refresh token' });
    issue(res);
  });

  // Every API call: the right app, a valid signature, a live access token.
  app.use((req, res, next) => {
    const { sign, ...query } = req.query;
    const body = req.method === 'POST' ? JSON.stringify(req.body) : '';
    if (query.app_key !== appKey || sign !== signRequest({ secret: appSecret, path: req.path, query, body })) {
      state.badSign++;
      return res.json({ code: 106001, message: 'Invalid signature' });
    }
    if (state.expireAccess) {
      state.expireAccess = false;
      state.accessToken = 'expired';
      return res.status(401).json({ code: 105002, message: 'Expired access token' });
    }
    if (req.headers['x-tts-access-token'] !== state.accessToken) return res.status(401).json({ code: 105001, message: 'Invalid access token' });
    next();
  });
  app.get('/authorization/202309/shops', (req, res) => res.json({ code: 0, data: { shops: [{ id: '7000001', name: 'Sample Shop', region: 'US', cipher: 'ROW_sample_cipher' }] } }));
  app.post('/return_refund/202309/returns/search', (req, res) => {
    if (req.query.shop_cipher !== 'ROW_sample_cipher') return res.json({ code: 106011, message: 'Invalid shop_cipher' });
    const { create_time_ge: ge, create_time_lt: lt } = req.body;
    const picked = returns.filter((r) => r.create_time >= ge && r.create_time < lt);
    const size = Math.min(Number(req.query.page_size) || 50, pageSize);
    const start = Number(req.query.page_token || 0);
    const next = start + size < picked.length ? String(start + size) : '';
    res.json({ code: 0, data: { return_orders: picked.slice(start, start + size), next_page_token: next, total_count: picked.length } });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { apiUrl: url, authUrl: url, keys: { appKey, appSecret }, returns, state, close: () => new Promise((resolve) => server.close(resolve)) };
}
