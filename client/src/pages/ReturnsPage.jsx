import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CHANNELS, MATCH_VIEWS, RETURN_CAUSES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { HBars, StackedColumns } from '../components/Charts.jsx';
import { ProductSelect } from '../components/Pickers.jsx';
import { BlankNotesView, ChannelsView, WeekOverWeek } from './ReturnsTrends.jsx';

const PERIODS = { 3: 'Last 3 months', 6: 'Last 6 months', 12: 'Last 12 months', all: 'All time' };
const VIEWS = { overview: 'Overview', weekly: 'Week over week', channels: 'Amazon vs TikTok', blank: 'Blank notes' };
const WEEKS = { 8: 'Last 8 weeks', 12: 'Last 12 weeks', 26: 'Last 26 weeks', 52: 'Last 52 weeks' };
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

/**
 * The cause bars. Once the customer-match workbook says whether cameras went online, the unclear group is split:
 * went online then failed, never went online, and no activation data (Low matches, Amazon, no workbook).
 */
/** Why some unclear returns have no activation data: the workbook only covers TikTok, and only returns it lists. */
function unknownWhy(t, unknown) {
  const notTiktok = t.unclear_not_tiktok_units || 0;
  const notListed = t.unclear_not_in_workbook_units || 0;
  const weak = Math.max(0, unknown - notTiktok - notListed);
  const parts = [
    notTiktok && `${notTiktok} units from Amazon or other channels (the workbook covers TikTok only)`,
    notListed && `${notListed} TikTok units not in the match workbook yet`,
    weak && `${weak} units with a weak match or order not found`,
  ].filter(Boolean);
  return parts.join(' · ');
}

function causeRows(t) {
  const row = (key, label, value, note) => ({ key, label, value, note });
  const rows = [row('fault', RETURN_CAUSES.fault, t.fault_units, CAUSE_HINTS.fault), row('conditions', RETURN_CAUSES.conditions, t.conditions_units, CAUSE_HINTS.conditions)];
  const unknown = t.unclear_units - t.unclear_online_units - t.unclear_never_units;
  if (t.unclear_online_units || t.unclear_never_units) {
    rows.push(
      row('online', 'Unclear: went online, then failed', t.unclear_online_units, 'The buyer’s camera was activated, so it worked at least once'),
      row('never', 'Unclear: never went online', t.unclear_never_units, 'No camera was activated in the buyer’s zip, so it likely never got past setup'),
    );
    if (unknown) rows.push(row('unknown', 'Unclear: no activation data', unknown, unknownWhy(t, unknown)));
  } else {
    rows.push(row('unclear', RETURN_CAUSES.unclear, t.unclear_units, CAUSE_HINTS.unclear));
  }
  rows.push(row('other', RETURN_CAUSES.other, t.other_cause_units, CAUSE_HINTS.other));
  return rows;
}

const CAUSE_HINTS = {
  fault: 'Hardware, performance, app or firmware, missing manual, or connectivity the note blames on the camera',
  conditions: 'Router or 5 GHz, weak signal outdoors or through a window, fit, smart-home setup',
  unclear: "Won't connect, drops offline or Bluetooth, and the note doesn't say why",
  other: 'Shipping, subscription, changed mind, vague notes',
};

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
  const view = Object.hasOwn(VIEWS, params.get('view') ?? '') ? params.get('view') : 'overview';
  const period = params.get('period') || '12';
  const weeks = Object.hasOwn(WEEKS, params.get('weeks') ?? '') ? params.get('weeks') : '12';
  // Amazon vs TikTok compares the two channels, so it ignores the channel filter.
  const channel = view === 'channels' ? '' : params.get('channel') || '';
  const productId = params.get('productId') || '';
  const match = params.get('match') || 'strong';
  const filters = { match, ...(channel && { channel }), ...(productId && { productId }) };
  const query = new URLSearchParams(filters);
  if (period !== 'all') query.set('from', monthsBack(Number(period)));
  const { data, error, reload } = useLoad(view === 'overview' ? `/api/returns/summary?${query}` : null);
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
  const faultShare = pct(t?.fault_units, t?.share_units);
  const unclearShare = pct(t?.unclear_units, t?.share_units);
  const allUnits = t ? t.units + t.set_aside_units : 0;
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
          ) : (
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
      {view !== 'overview' ? null : !data ? (
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
            <div className="stat">
              <span className="stat-label">Product fault</span>
              <span className="stat-value">{faultShare}%</span>
              <span className="stat-hint">{unclearShare > 0 ? `up to ${faultShare + unclearShare}% with unclear connectivity` : `${units(t.fault_units)} of ${t.share_units} with a reason`}</span>
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

          <section className="card">
            <h2>What's behind the returns</h2>
            {t.share_units ? (
              <HBars
                ariaLabel="Units by cause"
                data={causeRows(t).map((row) => ({ ...row, share: pct(row.value, t.share_units) }))}
              />
            ) : (
              <p className="muted">No returns with a reason yet.</p>
            )}
            <p className="muted small">
              Out of {units(t.share_units)} with a reason.{' '}
              {data.setAside.length > 0 ? (
                <>
                  Set aside and not counted: {units(t.set_aside_units)}, {pct(t.set_aside_units, allUnits)}% of all returns in this period (
                  {data.setAside.map((x) => `${x.units} ${x.name.toLowerCase()}`).join(', ')}).
                </>
              ) : (
                'No returns set aside (samples, or returns that never reached a customer).'
              )}
            </p>
          </section>

          <section className="grid-2">
            <div className="card">
              <h2>Why products come back</h2>
              {data.byCategory.length ? (
                <HBars
                  ariaLabel="Units by category"
                  data={data.byCategory.map((c) => ({ label: c.name, value: c.units, share: pct(c.units, t.share_units) }))}
                />
              ) : (
                <p className="muted">No returns with a reason yet.</p>
              )}
              <p className="muted small">
                From the buyer's own words. {left.length > 0 && <>Not counted: {left.join(', ')}. </>}
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
                    <th className="num">Product fault</th>
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
                        {p.fault_units} <span className="muted small">({pct(p.fault_units, p.share_units)}%)</span>
                        {p.unclear_units > 0 && <div className="muted small">+{p.unclear_units} unclear</div>}
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

      {view === 'overview' && <Unmatched onAssigned={reload} />}
    </div>
  );
}
