import { useState } from 'react';

/**
 * Small SVG charts for the returns page. Colors come from CSS variables
 * (--series-1…3, validated for light and dark), text stays in text colors,
 * every chart has a legend or direct labels, and a table view of the same
 * numbers sits beside it for exact values and accessibility.
 */

const niceMax = (v) => {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow / (v / pow > 5 ? 2 : 1)) * pow * (v / pow > 5 ? 2 : 1);
};

/** Columns per period, stacked by series. data: [{ label, values: { [seriesKey]: number } }] */
export function StackedColumns({ data, series, height = 220, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const totals = data.map((d) => series.reduce((n, s) => n + (d.values[s.key] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const W = 640;
  const pad = { top: 22, right: 8, bottom: 28, left: 36 };
  const innerW = W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(44, band * 0.6);
  const y = (v) => pad.top + innerH - (v / max) * innerH;
  // Whole-number ticks only: these are counts.
  const ticks = max % 2 === 0 ? [0, max / 2, max] : [0, max];

  return (
    <div className="chart">
      <div className="legend chart-legend">
        {series.map((s) => (
          <span key={s.key} className="legend-item">
            <span className="legend-swatch" style={{ background: `var(${s.color})` }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-axis' : 'chart-grid'} />
            <text x={pad.left - 6} y={y(t) + 4} className="chart-tick" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + band * i + (band - barW) / 2;
          let base = 0;
          const segs = series
            .map((s) => ({ s, v: d.values[s.key] || 0 }))
            .filter((x) => x.v > 0)
            .map((seg) => {
              const y0 = y(base);
              base += seg.v;
              return { ...seg, y1: y(base), y0 };
            });
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} className="chart-hit" />
              {segs.map((seg, j) => {
                const top = j === segs.length - 1;
                const h = Math.max(0, seg.y0 - seg.y1 - (j > 0 ? 2 : 0)); // 2px surface gap between stacked segments
                return top ? (
                  <path
                    key={seg.s.key}
                    d={roundedTop(x, seg.y1, barW, h, Math.min(4, h))}
                    fill={`var(${seg.s.color})`}
                  />
                ) : (
                  <rect key={seg.s.key} x={x} y={seg.y1 + (j > 0 ? 2 : 0)} width={barW} height={h} fill={`var(${seg.s.color})`} />
                );
              })}
              {totals[i] > 0 && (
                <text x={x + barW / 2} y={y(totals[i]) - 6} textAnchor="middle" className="chart-value">
                  {totals[i]}
                </text>
              )}
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="chart-tick">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" role="status">
          <strong>{data[hover].label}</strong>
          {series.map((s) => (
            <span key={s.key}>
              <span className="legend-swatch" style={{ background: `var(${s.color})` }} aria-hidden="true" /> {s.label}: {data[hover].values[s.key] || 0}
            </span>
          ))}
          <span className="muted">Total: {totals[hover]}</span>
        </div>
      )}
    </div>
  );
}

function roundedTop(x, y, w, h, r) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Horizontal bars with a value label on each. data: [{ label, value, hint? }] */
/** Horizontal bars. Each item: { label, value, hint? (tooltip), note? (shown under the label), share? (a % shown after the value), color? }. */
export function HBars({ data, color = '--series-1', ariaLabel }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const withShare = data.some((d) => d.share != null);
  return (
    <ul className={`hbars ${withShare ? 'hbars-share' : ''}`} aria-label={ariaLabel}>
      {data.map((d) => (
        <li key={d.label} title={d.hint ? `${d.label}: ${d.value} (${d.hint})` : `${d.label}: ${d.value}`}>
          <span className="hbar-label">
            {d.label}
            {d.note && <span className="hbar-note">{d.note}</span>}
          </span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(d.value / max) * 100}%`, background: `var(${d.color || color})` }} />
          </span>
          <span className="hbar-value">
            {d.value}
            {d.share != null && <span className="hbar-share"> · {d.share}%</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A donut: parts of one whole. data: [{ key, label, value, color }] with color a CSS variable name. Slices are
 * separated by a 2px surface gap; the legend beside it names every slice with its value and share, so nothing
 * relies on color alone. `center` is the big number in the middle, `centerLabel` the word under it.
 */
export function Donut({ data, ariaLabel, center, centerLabel, size = 180 }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((n, d) => n + d.value, 0);
  const shown = data.filter((d) => d.value > 0);
  const r = 70;
  const stroke = 26;
  const c = size / 2;
  let angle = -Math.PI / 2;
  const arcs = shown.map((d) => {
    const sweep = total ? (d.value / total) * Math.PI * 2 : 0;
    const start = angle;
    angle += sweep;
    return { ...d, start, end: angle, sweep };
  });
  const point = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const path = (a) => {
    // A whole circle can't be one arc: draw it as two halves.
    if (a.sweep >= Math.PI * 2 - 1e-6) {
      const [x1, y1] = point(a.start);
      const [x2, y2] = point(a.start + Math.PI);
      return `M${x1},${y1} A${r},${r} 0 1 1 ${x2},${y2} A${r},${r} 0 1 1 ${x1},${y1}`;
    }
    const [x1, y1] = point(a.start);
    const [x2, y2] = point(a.end);
    return `M${x1},${y1} A${r},${r} 0 ${a.sweep > Math.PI ? 1 : 0} 1 ${x2},${y2}`;
  };
  const share = (v) => (total ? Math.round((v / total) * 100) : 0);
  const active = hover !== null ? arcs[hover] : null;

  return (
    <div className="donut">
      <div className="donut-figure">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="donut-svg">
          {arcs.length === 0 && <circle cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} className="donut-empty" />}
          {arcs.map((a, i) => (
            <path
              key={a.key}
              d={path(a)}
              fill="none"
              stroke={`var(${a.color})`}
              strokeWidth={hover === i ? stroke + 6 : stroke}
              className="donut-slice"
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <title>{`${a.label}: ${a.value} (${share(a.value)}%)`}</title>
            </path>
          ))}
          {/* The 2px gaps: surface-colored spokes at each slice boundary. */}
          {arcs.length > 1 &&
            arcs.map((a) => {
              const [x1, y1] = [c + (r - stroke / 2 - 4) * Math.cos(a.start), c + (r - stroke / 2 - 4) * Math.sin(a.start)];
              const [x2, y2] = [c + (r + stroke / 2 + 4) * Math.cos(a.start), c + (r + stroke / 2 + 4) * Math.sin(a.start)];
              return <line key={`gap-${a.key}`} x1={x1} y1={y1} x2={x2} y2={y2} className="donut-gap" />;
            })}
          <text x={c} y={c - 2} textAnchor="middle" className="donut-center">
            {active ? `${share(active.value)}%` : center}
          </text>
          <text x={c} y={c + 18} textAnchor="middle" className="donut-center-label">
            {active ? active.label : centerLabel}
          </text>
        </svg>
      </div>
      <ul className="donut-legend">
        {data.map((d) => {
          const i = arcs.findIndex((a) => a.key === d.key);
          return (
            <li key={d.key} className={i >= 0 && hover === i ? 'is-active' : ''} onMouseEnter={() => i >= 0 && setHover(i)} onMouseLeave={() => setHover(null)}>
              <span className="legend-swatch" style={{ background: `var(${d.color})` }} aria-hidden="true" />
              <span className="donut-legend-label">{d.label}</span>
              <span className="donut-legend-value">
                {d.value} <span className="muted">· {share(d.value)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
