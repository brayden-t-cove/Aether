/** The Returns page's weekly views: week over week, Amazon vs TikTok, and blank notes. */
import { useState } from 'react';
import { CHANNELS } from '../../../shared/workflow.js';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { change, channelFigures, lastTwoComplete, productBreakdown, weeklyGroups, weekLabel, weekTotals } from '../lib/returnTrends.js';
import { StackedColumns } from '../components/Charts.jsx';

// Same channels, colors and order as the overview's monthly chart.
const SERIES = [
  { key: 'amazon', label: 'Amazon', color: '--series-1' },
  { key: 'tiktok', label: 'TikTok', color: '--series-2' },
  { key: 'other', label: 'Other', color: '--series-3' },
];
const seriesKey = (channel) => (channel === 'amazon' || channel === 'tiktok' ? channel : 'other');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const shortWeek = (w) => new Date(`${w.week}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Weekly columns by channel. value(week) → { channel: count }. */
function WeeklyColumns({ weeks, value, ariaLabel }) {
  const columns = weeks.map((w) => {
    const values = {};
    for (const [channel, n] of Object.entries(value(w))) values[seriesKey(channel)] = (values[seriesKey(channel)] || 0) + n;
    return { key: w.week, label: shortWeek(w), values };
  });
  const used = SERIES.filter((s) => columns.some((c) => c.values[s.key]));
  return <StackedColumns data={columns} series={used.length ? used : SERIES.slice(0, 1)} ariaLabel={ariaLabel} />;
}

function Change({ c }) {
  if (c.delta === 0) return <span className="muted">no change</span>;
  const text = `${c.delta > 0 ? '+' : '−'}${Math.abs(c.delta)}${c.pct !== null ? ` (${c.pct > 0 ? '+' : '−'}${Math.abs(c.pct)}%)` : ''}`;
  return c.rising ? (
    <span className="warning-text">
      ▲ {text} <span className="small">rising</span>
    </span>
  ) : (
    <span>{text}</span>
  );
}

/** Says which weeks are compared, and warns when the data stops before them. */
function Coverage({ data }) {
  const [prev, last] = lastTwoComplete(data.weeks);
  const current = data.weeks.at(-1);
  const stale = last && (!data.latestReturn || data.latestReturn < last.week);
  return (
    <>
      {last && prev && (
        <p className="muted small">
          Comparing the week of {weekLabel(last)} with {weekLabel(prev)}. Weeks run Monday to Sunday (MST).
          {current.partial && ` This week (${weekLabel(current)}) is still in progress and isn't compared.`}
        </p>
      )}
      {stale && (
        <p className="warning-text small">
          {data.latestReturn ? `The latest return imported is from ${formatDate(data.latestReturn)}` : 'No returns imported yet'}, so the week of{' '}
          {weekLabel(last)} may be incomplete. Import this week's reports for an up-to-date comparison.
        </p>
      )}
    </>
  );
}

export function WeekOverWeek({ data }) {
  const [by, setBy] = useState('category');
  const [showAll, setShowAll] = useState(false);
  const groups = weeklyGroups(data, by);
  const [prev, last] = lastTwoComplete(data.weeks);
  const totals = weekTotals(data);
  const sumWeek = (w) => groups.reduce((n, g) => n + (w ? g.perWeek[w.week] || 0 : 0), 0);

  return (
    <>
      <section className="card">
        <div className="row between">
          <h2>Week over week</h2>
          <div className="tabs" role="tablist" aria-label="Compare by">
            {[
              ['category', 'Categories'],
              ['cause', 'Causes'],
            ].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={by === k} className={`tab ${by === k ? 'active' : ''}`} onClick={() => setBy(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Coverage data={data} />
        {!groups.length ? (
          <p className="muted">No returns with a reason in these weeks.</p>
        ) : (
          <div className="table-wrap">
            <table aria-label={`Units by ${by} per week`}>
              <thead>
                <tr>
                  <th>{by === 'cause' ? 'Cause' : 'Category'}</th>
                  <th className="num">{prev ? weekLabel(prev) : '—'}</th>
                  <th className="num">{last ? weekLabel(last) : '—'}</th>
                  <th className="num">Change</th>
                  {showAll &&
                    data.weeks.map((w) => (
                      <th key={w.week} className="num">
                        {shortWeek(w)}
                        {w.partial && '*'}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key}>
                    <td>{g.label}</td>
                    <td className="num">{g.prev}</td>
                    <td className="num">{g.last}</td>
                    <td className="num">
                      <Change c={g} />
                    </td>
                    {showAll &&
                      data.weeks.map((w) => (
                        <td key={w.week} className="num muted">
                          {g.perWeek[w.week] || 0}
                        </td>
                      ))}
                  </tr>
                ))}
                <tr className="total-row">
                  <td>All with a reason</td>
                  <td className="num">{sumWeek(prev)}</td>
                  <td className="num">{sumWeek(last)}</td>
                  <td className="num">
                    <Change c={{ ...change(sumWeek(prev), sumWeek(last)), rising: false }} />
                  </td>
                  {showAll &&
                    data.weeks.map((w) => (
                      <td key={w.week} className="num muted">
                        {sumWeek(w)}
                      </td>
                    ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Units. ▲ marks a rise of at least 3 units and 50%. Returns with no note or not yet sorted aren't in this table; see Blank notes.{' '}
          <button className="link-btn" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll}>
            {showAll ? 'Hide earlier weeks' : `Show all ${data.weeks.length} weeks`}
          </button>
          {showAll && data.weeks.at(-1).partial && ' (* this week so far)'}
        </p>
      </section>

      <section className="card">
        <h2>Units returned per week</h2>
        <WeeklyColumns weeks={totals} value={(w) => w.byChannel} ariaLabel="Units returned per week by channel" />
        {data.weeks.at(-1).partial && <p className="muted small">The last column is this week so far.</p>}
      </section>
    </>
  );
}

export function ChannelsView({ data }) {
  const amazon = channelFigures(data.rows.filter((r) => r.channel === 'amazon'));
  const tiktok = channelFigures(data.rows.filter((r) => r.channel === 'tiktok'));
  const both = [
    ['amazon', amazon],
    ['tiktok', tiktok],
  ];
  const categories = [...new Set([...Object.keys(amazon.categories), ...Object.keys(tiktok.categories)])]
    .map((key) => ({ key, label: (amazon.categories[key] || tiktok.categories[key]).label, amazon: amazon.categories[key]?.units || 0, tiktok: tiktok.categories[key]?.units || 0 }))
    .sort((a, b) => b.amazon + b.tiktok - (a.amazon + a.tiktok));
  const products = productBreakdown(data.rows.filter((r) => r.channel === 'amazon' || r.channel === 'tiktok'));
  const rows = [
    ['Units returned', (f) => f.units],
    ['Returns', (f) => f.returns],
    ['Product fault', (f) => `${pct(f.causes.fault, f.shareUnits)}%`],
    ['Conditions & compatibility', (f) => `${pct(f.causes.conditions, f.shareUnits)}%`],
    ['Connectivity, cause unclear', (f) => `${pct(f.causes.unclear, f.shareUnits)}%`],
    ['Other reasons', (f) => `${pct(f.causes.other, f.shareUnits)}%`],
    ['Returns with no note', (f) => `${pct(f.blank, f.returns)}%`],
  ];

  return (
    <>
      <section className="card flush">
        <h2 className="pad-h">Amazon vs TikTok</h2>
        <p className="muted small pad-h">
          {weekLabel(data.weeks[0])} to {weekLabel(data.weeks.at(-1))}. Causes are shares of units with a reason; the last row is a share of returns.
        </p>
        <div className="table-wrap">
          <table aria-label="Amazon and TikTok compared">
            <thead>
              <tr>
                <th />
                <th className="num">Amazon</th>
                <th className="num">TikTok</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {both.map(([k, f]) => (
                    <td key={k} className="num">
                      {value(f)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Units returned per week</h2>
        <WeeklyColumns
          weeks={weekTotals(data)}
          value={(w) => Object.fromEntries(Object.entries(w.byChannel).filter(([k]) => k === 'amazon' || k === 'tiktok'))}
          ariaLabel="Amazon and TikTok units returned per week"
        />
      </section>

      <section className="grid-2">
        <div className="card flush">
          <h2 className="pad-h">Why products come back</h2>
          {!categories.length ? (
            <p className="muted pad-h">No returns with a reason in these weeks.</p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Categories by channel">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Amazon</th>
                    <th className="num">TikTok</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td className="num">
                        {c.amazon} <span className="muted small">({pct(c.amazon, amazon.shareUnits)}%)</span>
                      </td>
                      <td className="num">
                        {c.tiktok} <span className="muted small">({pct(c.tiktok, tiktok.shareUnits)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card flush">
          <h2 className="pad-h">By product</h2>
          <div className="table-wrap">
            <table aria-label="Products by channel">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Amazon</th>
                  <th className="num">TikTok</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.key}>
                    <td>{p.productId ? p.name : <span className="muted">Not matched to a product</span>}</td>
                    <td className="num">{p.byChannel.amazon || 0}</td>
                    <td className="num">{p.byChannel.tiktok || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

export function BlankNotesView({ data, query }) {
  const totals = weekTotals(data);
  const [prev, last] = lastTwoComplete(totals);
  const returns = totals.reduce((n, w) => n + w.returns, 0);
  const blank = totals.reduce((n, w) => n + w.blank, 0);
  const products = productBreakdown(data.rows).filter((p) => p.returns > 0);
  const latest = useLoad(`/api/returns?${new URLSearchParams({ ...query, blank: '1', from: data.weeks[0].week, to: data.weeks.at(-1).end, limit: '20' })}`);
  const [showTable, setShowTable] = useState(false);

  return (
    <>
      <section className="stats" aria-label="Blank notes">
        <div className="stat">
          <span className="stat-label">No note</span>
          <span className="stat-value">{blank}</span>
          <span className="stat-hint">
            of {returns} returns ({pct(blank, returns)}%)
          </span>
        </div>
        {last && (
          <div className="stat">
            <span className="stat-label">Week of {weekLabel(last)}</span>
            <span className="stat-value">{last.blank}</span>
            <span className="stat-hint">
              {pct(last.blank, last.returns)}% of {last.returns} returns
            </span>
          </div>
        )}
        {prev && last && (
          <div className="stat">
            <span className="stat-label">Change from {weekLabel(prev)}</span>
            <span className="stat-value">{last.blank - prev.blank > 0 ? `+${last.blank - prev.blank}` : last.blank - prev.blank}</span>
            <span className="stat-hint">
              was {prev.blank} ({pct(prev.blank, prev.returns)}%)
            </span>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Returns with no note, per week</h2>
          <button className="btn ghost small" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
        <Coverage data={data} />
        {showTable ? (
          <div className="table-wrap">
            <table aria-label="Returns with no note per week">
              <thead>
                <tr>
                  <th>Week</th>
                  <th className="num">Amazon</th>
                  <th className="num">TikTok</th>
                  <th className="num">No note</th>
                  <th className="num">Returns</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((w) => (
                  <tr key={w.week}>
                    <td>
                      {weekLabel(w)}
                      {w.partial && <span className="muted small"> (so far)</span>}
                    </td>
                    <td className="num">{w.blankByChannel.amazon || 0}</td>
                    <td className="num">{w.blankByChannel.tiktok || 0}</td>
                    <td className="num">{w.blank}</td>
                    <td className="num">{w.returns}</td>
                    <td className="num">{pct(w.blank, w.returns)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <WeeklyColumns weeks={totals} value={(w) => w.blankByChannel} ariaLabel="Returns with no note per week by channel" />
        )}
        <p className="muted small">
          A note counts as blank when the buyer wrote nothing of their own: empty, "N/A", or only the platform's menu choice.
        </p>
      </section>

      <section className="grid-2">
        <div className="card flush">
          <h2 className="pad-h">By product</h2>
          <div className="table-wrap">
            <table aria-label="Returns with no note by product">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">No note</th>
                  <th className="num">Returns</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.key}>
                    <td>{p.productId ? p.name : <span className="muted">Not matched to a product</span>}</td>
                    <td className="num">
                      {p.blank} <span className="muted small">({pct(p.blank, p.returns)}%)</span>
                    </td>
                    <td className="num">{p.returns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card flush">
          <h2 className="pad-h">Latest returns with no note</h2>
          {!latest.data ? (
            <p className="muted pad-h">Loading…</p>
          ) : !latest.data.returns.length ? (
            <p className="muted pad-h">None in these weeks.</p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Latest returns with no note">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Picked on the platform</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.data.returns.map((r) => (
                    <tr key={r.id}>
                      <td className="small">
                        {formatDate(r.return_date)}
                        <div className="muted">{CHANNELS[r.channel]}</div>
                      </td>
                      <td className="small">{r.product_name || r.product_label || '—'}</td>
                      <td className="small">{r.reason || r.reason_code || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
