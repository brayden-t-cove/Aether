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
  const ticks = [0, max / 2, max];

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
export function HBars({ data, color = '--series-1', ariaLabel }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="hbars" aria-label={ariaLabel}>
      {data.map((d) => (
        <li key={d.label} title={d.hint ? `${d.label}: ${d.value} (${d.hint})` : `${d.label}: ${d.value}`}>
          <span className="hbar-label">{d.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(d.value / max) * 100}%`, background: `var(${color})` }} />
          </span>
          <span className="hbar-value">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}
