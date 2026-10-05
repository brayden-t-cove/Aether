/**
 * Adding up /api/returns/weekly rows for the Returns page's dashboard views. Each row is one week × channel ×
 * product × category × cause × blank note, with `returns` (count) and `units` (quantity).
 * Kept free of React so it can be unit-tested.
 */
import { RETURN_CAUSES } from '../../../shared/workflow.js';

const sum = (rows, key = 'units') => rows.reduce((n, r) => n + r[key], 0);

/** The last two weeks that have finished, oldest first: [previous, last]. Either may be undefined. */
export function lastTwoComplete(weeks) {
  const done = weeks.filter((w) => !w.partial);
  return [done.at(-2), done.at(-1)];
}

/** A change between two counts. Rising means up by at least 3 and by half or more (or from nothing). */
export function change(prev, last) {
  const delta = last - prev;
  const pct = prev ? Math.round((delta / prev) * 100) : null;
  const rising = delta >= 3 && (prev === 0 || pct >= 50);
  return { prev, last, delta, pct, rising };
}

/**
 * Units per week for each group with a reason (category or cause), with last week compared to the one before.
 * by: 'category' | 'cause'. → [{ key, label, perWeek: { week: units }, total, ...change }] busiest last week first.
 */
export function weeklyGroups(data, by = 'category') {
  const [prev, last] = lastTwoComplete(data.weeks);
  const groups = new Map();
  for (const r of data.rows) {
    if (!r.cause) continue; // No Comment and unsorted returns have no reason to compare
    const key = by === 'cause' ? r.cause : r.category_key;
    const label = by === 'cause' ? RETURN_CAUSES[r.cause] : r.category_name;
    if (!groups.has(key)) groups.set(key, { key, label, perWeek: {}, total: 0 });
    const g = groups.get(key);
    g.perWeek[r.week] = (g.perWeek[r.week] || 0) + r.units;
    g.total += r.units;
  }
  const order = by === 'cause' ? Object.keys(RETURN_CAUSES) : null;
  return [...groups.values()]
    .map((g) => ({ ...g, ...change(prev ? g.perWeek[prev.week] || 0 : 0, last ? g.perWeek[last.week] || 0 : 0) }))
    .sort((a, b) => (order ? order.indexOf(a.key) - order.indexOf(b.key) : b.last - a.last || b.total - a.total || a.label.localeCompare(b.label)));
}

/** Per week: { week, units, returns, blank (returns with no note), byChannel: { channel: units }, blankByChannel }. */
export function weekTotals(data) {
  return data.weeks.map((w) => {
    const rows = data.rows.filter((r) => r.week === w.week);
    const byChannel = {};
    const blankByChannel = {};
    for (const r of rows) {
      byChannel[r.channel] = (byChannel[r.channel] || 0) + r.units;
      if (r.blank) blankByChannel[r.channel] = (blankByChannel[r.channel] || 0) + r.returns;
    }
    return { ...w, units: sum(rows), returns: sum(rows, 'returns'), blank: sum(rows.filter((r) => r.blank), 'returns'), byChannel, blankByChannel };
  });
}

/**
 * One channel's figures over the whole period: units, returns, units with a reason, each cause's units,
 * returns with no note, and units per category.
 */
export function channelFigures(rows) {
  const reasoned = rows.filter((r) => r.cause);
  const causes = Object.fromEntries(Object.keys(RETURN_CAUSES).map((k) => [k, sum(reasoned.filter((r) => r.cause === k))]));
  const categories = {};
  for (const r of reasoned) categories[r.category_key] = { label: r.category_name, units: (categories[r.category_key]?.units || 0) + r.units };
  return { units: sum(rows), returns: sum(rows, 'returns'), shareUnits: sum(reasoned), causes, blank: sum(rows.filter((r) => r.blank), 'returns'), categories };
}

/** Per product: units per channel, returns, and returns with no note. Busiest first. */
export function productBreakdown(rows) {
  const products = new Map();
  for (const r of rows) {
    const key = r.product_id || 'unmatched';
    if (!products.has(key)) products.set(key, { key, productId: r.product_id, name: r.product_name || 'Unmatched', units: 0, returns: 0, blank: 0, byChannel: {} });
    const p = products.get(key);
    p.units += r.units;
    p.returns += r.returns;
    if (r.blank) p.blank += r.returns;
    p.byChannel[r.channel] = (p.byChannel[r.channel] || 0) + r.units;
  }
  return [...products.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/** "Sep 21–27" or "Sep 28 – Oct 4". */
export function weekLabel(w) {
  const d = (iso) => new Date(`${iso}T00:00:00Z`);
  const start = d(w.week);
  const end = d(w.end);
  const month = (x) => x.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${month(start)} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${month(start)} ${start.getUTCDate()} – ${month(end)} ${end.getUTCDate()}`;
}
