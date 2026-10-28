import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CHANNELS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { ProductSelect } from '../components/Pickers.jsx';
import ProductMultiSelect from '../components/ProductMultiSelect.jsx';
import { PERIODS, monthKey as monthOf, resolvePeriod, shiftMonth, todayKey, weeksForRange } from '../lib/returnPeriods.js';
import { BlankNotesView, ChannelsView, WeekOverWeek } from './ReturnsTrends.jsx';
import ReturnsOverview from './ReturnsOverview.jsx';

const VIEWS = { overview: 'Overview', weekly: 'Week over week', channels: 'Amazon vs TikTok', blank: 'Blank notes' };
const WEEKS = { 8: 'Last 8 weeks', 12: 'Last 12 weeks', 26: 'Last 26 weeks', 52: 'Last 52 weeks', custom: 'Custom range' };
const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;

// Months as YYYY-MM.
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
  const today = todayKey();
  const thisMonth = monthOf(today);
  // The overview's period: month to date by default, a preset, one month, or a custom range (see returnPeriods.js).
  const period = resolvePeriod(params, today);
  const month = period.month;
  const weeks = Object.hasOwn(WEEKS, params.get('weeks') ?? '') ? params.get('weeks') : '12';
  // Amazon vs TikTok compares the two channels, so it ignores the channel filter.
  const channel = view === 'channels' ? '' : params.get('channel') || '';
  // Products: any number, by Aether's names (?products=<id>,<id>; an old ?productId= link still works).
  const productIds = [...new Set([...(params.get('products') || '').split(','), params.get('productId') || ''].filter(Boolean))];
  const filters = { ...(channel && { channel }), ...(productIds.length && { products: productIds.join(',') }) };
  const periodQuery = { ...filters, from: period.from, to: period.to };
  const trendFrom = `${[shiftMonth(monthOf(period.to), -11), monthOf(period.from)].sort()[0]}-01`;
  const { data, error, reload } = useLoad(view === 'overview' ? `/api/returns/summary?${new URLSearchParams({ ...periodQuery, trendFrom })}` : null);
  const codebook = useLoad(view === 'overview' ? '/api/returns/codebook' : null);
  // The weekly views: the last N weeks, or the weeks a custom range covers. ?end=YYYY-MM-DD shows the weeks up to that
  // date instead of up to today.
  const range = weeks === 'custom' && period.key === 'custom' ? weeksForRange(period.from, period.to) : null;
  const weekly = useLoad(
    view === 'overview'
      ? null
      : `/api/returns/weekly?${new URLSearchParams({
          ...filters,
          weeks: range ? range.weeks : weeks === 'custom' ? '12' : weeks,
          ...(range ? { end: range.end } : params.get('end') && { end: params.get('end') }),
        })}`,
  );

  const setFilter = (key, value) => setFilters({ [key]: value });
  // Several URL parameters at once; an empty value removes one.
  const setFilters = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  const pickPeriod = (key) => {
    if (key === 'custom') setFilters({ period: 'custom', from: period.from, to: period.to, month: '' });
    else if (key === 'month') setFilters({ period: '', from: '', to: '', month: month || thisMonth });
    else setFilters({ period: key === 'mtd' ? '' : key, from: '', to: '', month: '' });
  };
  const pickMonth = (m) => setFilters({ period: '', from: '', to: '', month: m === thisMonth ? '' : m });
  const pickWeeks = (w) => {
    if (w === 'custom') setFilters({ weeks: 'custom', period: 'custom', from: period.from, to: period.to });
    else setFilters({ weeks: w === '12' ? '' : w });
  };
  const customRange = (
    <span className="row date-range" role="group" aria-label="Custom range">
      <input type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && setFilters({ period: 'custom', from: e.target.value })} aria-label="From" />
      <span aria-hidden="true">–</span>
      <input type="date" value={period.to} min={period.from} max={today} onChange={(e) => e.target.value && setFilters({ period: 'custom', to: e.target.value })} aria-label="To" />
    </span>
  );

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
            <>
              <label className="inline">
                Period
                <select value={period.key} onChange={(e) => pickPeriod(e.target.value)} aria-label="Period">
                  {Object.entries(PERIODS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {month && (
                <div className="month-picker" role="group" aria-label="Month">
                  <button className="btn ghost small icon-btn" onClick={() => pickMonth(shiftMonth(month, -1))} aria-label="Previous month">
                    ‹
                  </button>
                  <select value={month} onChange={(e) => pickMonth(e.target.value)} aria-label="Month to show">
                    {(months.includes(month) ? months : [month, ...months]).map((m) => (
                      <option key={m} value={m}>
                        {monthName(m)}
                        {m === thisMonth ? ' (so far)' : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn ghost small icon-btn" onClick={() => pickMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month">
                    ›
                  </button>
                </div>
              )}
              {period.key === 'custom' && customRange}
              {!month && period.key !== 'custom' && <span className="muted small">{period.label}</span>}
            </>
          ) : (
            <>
              <label className="inline">
                Weeks
                <select value={weeks} onChange={(e) => pickWeeks(e.target.value)}>
                  {Object.entries(WEEKS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {weeks === 'custom' && customRange}
            </>
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
          <ProductMultiSelect value={productIds} onChange={(ids) => setFilters({ products: ids.join(','), productId: '' })} />
        </div>
      </div>

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
          <p className="muted">No returns in {period.label} yet.</p>
          {data.latestReturn && data.latestReturn.slice(0, 7) !== month && (
            <p>
              <button className="link-btn" onClick={() => pickMonth(data.latestReturn.slice(0, 7))}>
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
          <ReturnsOverview
            data={data}
            codebook={codebook.data.categories}
            query={periodQuery}
            monthName={period.label}
            trendEnd={monthName(monthOf(period.to))} onCodebookChanged={codebook.reload} onReturnsChanged={reload} />
        </>
      )}

      {view === 'overview' && <Unmatched onAssigned={reload} />}
    </div>
  );
}
