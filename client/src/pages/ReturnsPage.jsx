import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CHANNELS, MATCH_VIEWS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { ProductSelect } from '../components/Pickers.jsx';
import { BlankNotesView, ChannelsView, WeekOverWeek } from './ReturnsTrends.jsx';
import ReturnsOverview from './ReturnsOverview.jsx';

const VIEWS = { overview: 'Overview', weekly: 'Week over week', channels: 'Amazon vs TikTok', blank: 'Blank notes' };
const WEEKS = { 8: 'Last 8 weeks', 12: 'Last 12 weeks', 26: 'Last 26 weeks', 52: 'Last 52 weeks' };
const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;

// Months as YYYY-MM. The overview shows one whole calendar month at a time.
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
};
const lastDay = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const monthName = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function Unmatched({ onAssigned }) {
  const { can } = useAuth();
  const { data, reload } = useLoad('/api/returns/unmatched');
  const [choice, setChoice] = useState({});
  const [error, setError] = useState(null);
  if (!data?.unmatched.length) return null;

  async function assign(u, i) {
    setError(null);
    try {
      await api('/api/returns/assign', { method: 'POST', body: { ...u, product_id: choice[i] } });
      reload();
      onAssigned();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="card">
      <h2>Returns not matched to a product</h2>
      <p className="muted small">Pick the product for each one. Aether remembers the ASIN or SKU as a listing, so future imports match automatically.</p>
      <ErrorNote error={error} />
      <ul className="dash-items">
        {data.unmatched.map((u, i) => (
          <li key={i}>
            <div className="dash-item-main">
              <strong>{u.product_label || u.sku || u.external_id}</strong>
              <span className="muted small">
                {CHANNELS[u.channel]} · {[u.external_id, u.sku].filter(Boolean).join(' · ')} · {units(u.units)}
              </span>
            </div>
            {can('editor') && (
              <div className="row">
                <ProductSelect value={choice[i] || ''} onChange={(id) => setChoice({ ...choice, [i]: id })} aria-label="Product" />
                <button className="btn small" disabled={!choice[i]} onClick={() => assign(u, i)}>
                  Assign
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ReturnsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = Object.hasOwn(VIEWS, params.get('view') ?? '') ? params.get('view') : 'overview';
  const thisMonth = monthKey(new Date());
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') && params.get('month') <= thisMonth ? params.get('month') : thisMonth;
  const weeks = Object.hasOwn(WEEKS, params.get('weeks') ?? '') ? params.get('weeks') : '12';
  // Amazon vs TikTok compares the two channels, so it ignores the channel filter.
  const channel = view === 'channels' ? '' : params.get('channel') || '';
  // The overview opens each product in place instead of filtering the page by one.
  const productId = view === 'overview' ? '' : params.get('productId') || '';
  const match = params.get('match') || 'strong';
  const filters = { match, ...(channel && { channel }), ...(productId && { productId }) };
  const monthQuery = { ...filters, from: `${month}-01`, to: lastDay(month) };
  const { data, error, reload } = useLoad(
    view === 'overview' ? `/api/returns/summary?${new URLSearchParams({ ...monthQuery, trendFrom: `${shiftMonth(month, -11)}-01` })}` : null,
  );
  const codebook = useLoad(view === 'overview' ? '/api/returns/codebook' : null);
  // ?end=YYYY-MM-DD shows the weeks up to that date instead of up to today.
  const weekly = useLoad(
    view === 'overview' ? null : `/api/returns/weekly?${new URLSearchParams({ ...filters, weeks, ...(params.get('end') && { end: params.get('end') }) })}`,
  );

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const t = data?.totals;
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(thisMonth, -i));

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Returns</h1>
          <p className="muted">Amazon and TikTok returns by product, reason and month, to spot defects and trends.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/returns/review">
            Review returns
          </Link>
          {can('editor') && (
            <Link className="btn primary" to="/returns/import">
              Import returns
            </Link>
          )}
        </div>
      </header>

      <div className="tabs page-tabs" role="tablist" aria-label="Returns views">
        {Object.entries(VIEWS).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={`tab ${view === k ? 'active' : ''}`} onClick={() => setFilter('view', k === 'overview' ? '' : k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="row">
          {view === 'overview' ? (
            <div className="month-picker" role="group" aria-label="Month">
              <button className="btn ghost small icon-btn" onClick={() => setFilter('month', shiftMonth(month, -1))} aria-label="Previous month">
                ‹
              </button>
              <select value={month} onChange={(e) => setFilter('month', e.target.value === thisMonth ? '' : e.target.value)} aria-label="Month to show">
                {(months.includes(month) ? months : [month, ...months]).map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                    {m === thisMonth ? ' (so far)' : ''}
                  </option>
                ))}
              </select>
              <button
                className="btn ghost small icon-btn"
                onClick={() => setFilter('month', shiftMonth(month, 1) === thisMonth ? '' : shiftMonth(month, 1))}
                disabled={month >= thisMonth}
                aria-label="Next month"
              >
                ›
              </button>
            </div>          ) : (
            <label className="inline">
              Weeks
              <select value={weeks} onChange={(e) => setFilter('weeks', e.target.value === '12' ? '' : e.target.value)}>
                {Object.entries(WEEKS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view !== 'channels' && (
            <label className="inline">
              Channel
              <select value={channel} onChange={(e) => setFilter('channel', e.target.value)}>
                <option value="">All</option>
                {Object.entries(CHANNELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view !== 'overview' && (
            <label className="inline">
              Product
              <ProductSelect value={productId} onChange={(id) => setFilter('productId', id)} emptyLabel="All" />
            </label>
          )}
          <label className="inline">
            Customer match
            <select value={match} onChange={(e) => setFilter('match', e.target.value === 'strong' ? '' : e.target.value)}>
              {Object.entries(MATCH_VIEWS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {match === 'strong' && (
        <p className="muted small">
          Leaving out TikTok returns the customer-match workbook rated Low, or couldn't match because the order wasn't found. Returns where no
          camera went online in the buyer's zip are kept, as are returns it has no rating for, including all of Amazon.
        </p>
      )}
      {view !== 'overview' && (
        <>
          <ErrorNote error={weekly.error} />
          {!weekly.data ? (
            !weekly.error && <p className="muted">Loading…</p>
          ) : view === 'weekly' ? (
            <WeekOverWeek data={weekly.data} />
          ) : view === 'channels' ? (
            <ChannelsView data={weekly.data} />
          ) : (
            <BlankNotesView data={weekly.data} query={filters} />
          )}
        </>
      )}
      {view === 'overview' && <ErrorNote error={error} />}
      {view !== 'overview' ? null : !data || !codebook.data ? (
        !error && <p className="muted">Loading…</p>
      ) : t.units === 0 ? (
        <div className="card empty">
          <p className="muted">No returns in {monthName(month)} yet.</p>
          {data.latestReturn && data.latestReturn.slice(0, 7) !== month && (
            <p>
              <button className="link-btn" onClick={() => setFilter('month', data.latestReturn.slice(0, 7))}>
                Show {monthName(data.latestReturn.slice(0, 7))}, the latest month with returns
              </button>
            </p>
          )}
          {can('editor') && (
            <Link className="btn primary" to="/returns/import">
              Import a returns report
            </Link>
          )}
        </div>
      ) : (
        <>
          <ReturnsOverview data={data} codebook={codebook.data.categories} query={monthQuery} monthName={monthName(month)} onCodebookChanged={codebook.reload} />
        </>
      )}

      {view === 'overview' && <Unmatched onAssigned={reload} />}
    </div>
  );
}
