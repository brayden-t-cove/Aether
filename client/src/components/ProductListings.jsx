import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANNELS, LISTING_STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from './ErrorNote.jsx';
import StatusBadge from './StatusBadge.jsx';
import { MarketSelect } from './Pickers.jsx';

const TONES = { planned: 'neutral', draft: 'active', in_review: 'warning', live: 'good', paused: 'serious', removed: 'neutral' };

/** Marketplace listings and a returns summary for one product. */
export default function ProductListings({ productId, editable }) {
  const { data, reload } = useLoad(`/api/products/${productId}/listings`);
  const returns = useLoad(`/api/returns/summary?productId=${productId}`);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(err);
    }
  }

  const t = returns.data?.totals;
  return (
    <section className="card">
      <div className="row between">
        <h2>Listings &amp; returns</h2>
        {editable && !form && (
          <button className="btn small" onClick={() => setForm({ channel: 'amazon', market_id: '', external_id: '', sku: '', url: '', state: 'planned' })}>
            Add listing
          </button>
        )}
      </div>
      <ErrorNote error={error} />
      {t?.units > 0 && (
        <p className="small">
          <Link to={`/returns?productId=${productId}&period=all`}>
            {t.units} {t.units === 1 ? 'unit' : 'units'} returned
          </Link>
          {t.defect_units > 0 && `, ${Math.round((t.defect_units / t.units) * 100)}% for defects or quality`}
          {returns.data.topReasons[0] && ` · top reason: ${returns.data.topReasons[0].reason}`}
        </p>
      )}
      {!data?.listings.length && !form && <p className="muted">No listings yet.</p>}
      {data?.listings.length > 0 && (
        <ul className="dash-items">
          {data.listings.map((l) => (
            <li key={l.id}>
              <div className="dash-item-main">
                <strong>{CHANNELS[l.channel]}</strong>
                {l.market_code && <span className="muted small">{l.market_code}</span>}
                {editable ? (
                  <select
                    className={`state-select tone-${TONES[l.state]}`}
                    value={l.state}
                    aria-label={`State of ${CHANNELS[l.channel]} listing`}
                    onChange={(e) => run(() => api(`/api/listings/${l.id}`, { method: 'PATCH', body: { state: e.target.value } }))}
                  >
                    {Object.entries(LISTING_STATES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <StatusBadge status={{ label: LISTING_STATES[l.state], tone: TONES[l.state] }} />
                )}
                <span className="muted small">{[l.external_id, l.sku].filter(Boolean).join(' · ')}</span>
                {l.url && (
                  <a href={l.url} target="_blank" rel="noreferrer noopener" className="small">
                    View
                  </a>
                )}
                <span className="spacer" />
                {editable && (
                  <button className="btn ghost small danger" onClick={() => window.confirm('Remove this listing?') && run(() => api(`/api/listings/${l.id}`, { method: 'DELETE' }))}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api(`/api/products/${productId}/listings`, { method: 'POST', body: { ...form, market_id: form.market_id || null } });
              setForm(null);
            });
          }}
        >
          <div className="form-row">
            <label>
              Channel
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {Object.entries(CHANNELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Market
              <MarketSelect value={form.market_id} onChange={(id) => setForm({ ...form, market_id: id })} emptyLabel="— Any —" />
            </label>
            <label>
              State
              <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                {Object.entries(LISTING_STATES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              <span>
                Listing ID <span className="muted small">(ASIN, TikTok product ID)</span>
              </span>
              <input value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} />
            </label>
            <label>
              SKU
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </label>
            <label>
              Link
              <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />
            </label>
          </div>
          <div className="row">
            <button className="btn primary">Add listing</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
