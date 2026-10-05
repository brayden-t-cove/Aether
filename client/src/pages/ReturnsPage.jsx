import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CHANNELS, MATCH_VIEWS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { HBars, StackedColumns } from '../components/Charts.jsx';
import { ProductSelect } from '../components/Pickers.jsx';

const PERIODS = { 3: 'Last 3 months', 6: 'Last 6 months', 12: 'Last 12 months', all: 'All time' };
const SERIES = [
  { key: 'amazon', label: 'Amazon', color: '--series-1' },
  { key: 'tiktok', label: 'TikTok', color: '--series-2' },
  { key: 'other', label: 'Other', color: '--series-3' },
];

function monthsBack(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (n - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Every month between two YYYY-MM keys, so empty months still show. */
function monthRange(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out.slice(-24);
}

const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

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
  const [showTable, setShowTable] = useState(false);
  const period = params.get('period') || '12';
  const channel = params.get('channel') || '';
  const productId = params.get('productId') || '';
  const match = params.get('match') || 'strong';
  const query = new URLSearchParams({ match });
  if (period !== 'all') query.set('from', monthsBack(Number(period)));
  if (channel) query.set('channel', channel);
  if (productId) query.set('productId', productId);
  const { data, error, reload } = useLoad(`/api/returns/summary?${query}`);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const months = data?.byMonth.length ? monthRange(data.byMonth[0].month, data.byMonth.at(-1).month) : [];
  const columns = months.map((m) => {
    const values = {};
    for (const row of data.byMonth.filter((r) => r.month === m)) {
      const k = row.channel === 'amazon' || row.channel === 'tiktok' ? row.channel : 'other';
      values[k] = (values[k] || 0) + row.units;
    }
    return { key: m, label: monthLabel(m), values };
  });
  const usedSeries = SERIES.filter((s) => columns.some((c) => c.values[s.key]));
  const t = data?.totals;
  const problemShare = pct(t?.problem_units, t?.share_units);
  const left = t && [
    t.no_comment_units && `${units(t.no_comment_units)} with no comment`,
    t.unsorted_units && `${units(t.unsorted_units)} not sorted yet`,
  ].filter(Boolean);

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

      <div className="toolbar">
        <div className="row">
          <label className="inline">
            Period
            <select value={period} onChange={(e) => setFilter('period', e.target.value === '12' ? '' : e.target.value)}>
              {Object.entries(PERIODS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
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
          <label className="inline">
            Product
            <ProductSelect value={productId} onChange={(id) => setFilter('productId', id)} emptyLabel="All" />
          </label>
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
          Leaving out TikTok returns the customer-match workbook rated Low or couldn't match. Returns it has no rating for, including all of Amazon,
          are still counted.
        </p>
      )}
      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : t.units === 0 ? (
        <div className="card empty">
          <p className="muted">No returns in this period yet.</p>
          {can('editor') && (
            <Link className="btn primary" to="/returns/import">
              Import a returns report
            </Link>
          )}
        </div>
      ) : (
        <>
          <section className="stats" aria-label="Summary">
            <div className="stat">
              <span className="stat-label">Units returned</span>
              <span className="stat-value">{t.units}</span>
              <span className="stat-hint">
                {formatDate(t.first_date)} – {formatDate(t.last_date)}
              </span>
            </div>
            <div className={`stat ${problemShare >= 50 ? 'stat-blocked' : ''}`}>
              <span className="stat-label">Product problems</span>
              <span className="stat-value">{problemShare}%</span>
              <span className="stat-hint">
                {units(t.problem_units)} of {t.share_units} with a reason
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Top category</span>
              <span className="stat-value stat-text">{data.byCategory[0]?.name || '—'}</span>
              <span className="stat-hint">{data.byCategory[0] ? `${units(data.byCategory[0].units)} · ${pct(data.byCategory[0].units, t.share_units)}%` : ''}</span>
            </div>
            <div className={`stat ${t.unmatched_units ? 'stat-overdue' : ''}`}>
              <span className="stat-label">Not matched to a product</span>
              <span className="stat-value">{t.unmatched_units}</span>
              <span className="stat-hint">{t.unmatched_units === 1 ? 'unit' : 'units'}</span>
            </div>
          </section>

          <section className="card">
            <div className="row between">
              <h2>Units returned per month</h2>
              <button className="btn ghost small" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
                {showTable ? 'Show chart' : 'Show table'}
              </button>
            </div>
            {showTable ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      {usedSeries.map((s) => (
                        <th key={s.key} className="num">
                          {s.label}
                        </th>
                      ))}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c.key}>
                        <td>{c.label}</td>
                        {usedSeries.map((s) => (
                          <td key={s.key} className="num">
                            {c.values[s.key] || 0}
                          </td>
                        ))}
                        <td className="num">{usedSeries.reduce((n, s) => n + (c.values[s.key] || 0), 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <StackedColumns data={columns} series={usedSeries} ariaLabel="Units returned per month by channel" />
            )}
          </section>

          <section className="grid-2">
            <div className="card">
              <h2>Why products come back</h2>
              {data.byCategory.length ? (
                <HBars
                  ariaLabel="Units by category"
                  data={data.byCategory.map((c) => ({ label: c.name, value: c.units, hint: `${pct(c.units, t.share_units)}%${c.product_problem ? ' · product problem' : ''}` }))}
                />
              ) : (
                <p className="muted">No returns with a reason yet.</p>
              )}
              <p className="muted small">
                From the buyer's own words. {left.length > 0 && <>Not counted: {left.join(', ')}. </>}
                {t.set_aside_units > 0 && <>{units(t.set_aside_units)} set aside (samples, or never reached a customer). </>}
                <Link to="/returns/review">Review returns</Link>
              </p>
            </div>
            <div className="card">
              <h2>Reason picked on the platform</h2>
              <HBars ariaLabel="Reasons picked on the platform" color="--series-1" data={data.topReasons.map((r) => ({ label: r.reason || r.reason_code || 'No reason given', value: r.units }))} />
              <p className="muted small">The buyer's menu choice, which often differs from what their note says.</p>
            </div>
          </section>

          <section className="card flush">
            <h2 className="pad-h">By product</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Units</th>
                    <th className="num">Product problems</th>
                    <th>Top category</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProduct.map((p) => (
                    <tr key={p.product_id || 'unmatched'}>
                      <td>
                        {p.product_id ? (
                          <button className="link-btn" onClick={() => setFilter('productId', p.product_id)} title="Show only this product">
                            {p.name}
                          </button>
                        ) : (
                          <span className="muted">Unmatched</span>
                        )}
                        {p.model && <div className="muted small">{p.model}</div>}
                      </td>
                      <td className="num">{p.units}</td>
                      <td className="num">
                        {p.problem_units} <span className="muted small">({pct(p.problem_units, p.share_units)}%)</span>
                      </td>
                      <td className="small">{p.top_category || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <Unmatched onAssigned={reload} />
    </div>
  );
}
