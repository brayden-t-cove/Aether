/**
 * The periods the Returns pages can show: presets (month to date, last month, quarter to date…), one chosen month,
 * or any custom range. Dates are YYYY-MM-DD strings; `today` is passed in so this is easy to test.
 */

export const PERIODS = {
  mtd: 'Month to date',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  qtd: 'Quarter to date',
  ytd: 'Year to date',
  last_12_months: 'Last 12 months',
  month: 'Pick a month',
  custom: 'Custom range',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const monthKey = (s) => s.slice(0, 7);
export const shiftMonth = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const firstDay = (key) => `${key}-01`;
const lastDay = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${pad(new Date(y, m, 0).getDate())}`;
};

const monthLong = (key) => parse(firstDay(key)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const short = (s, year) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }) });

/** "October 2026", "October 2026 (so far)", "Jul – Sep 2026", or "Sep 3 – Oct 14, 2026". */
export function periodLabel(from, to, today) {
  const sameMonth = monthKey(from) === monthKey(to);
  if (sameMonth && from === firstDay(monthKey(from)) && (to === lastDay(monthKey(to)) || to === today)) {
    return `${monthLong(monthKey(from))}${to === today && to !== lastDay(monthKey(to)) ? ' (so far)' : ''}`;
  }
  const wholeMonths = from === firstDay(monthKey(from)) && (to === lastDay(monthKey(to)) || to === today);
  if (wholeMonths) {
    const a = parse(from).toLocaleDateString('en-US', { month: 'short', ...(from.slice(0, 4) !== to.slice(0, 4) && { year: 'numeric' }) });
    const b = parse(to).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${a} – ${b}${to === today && to !== lastDay(monthKey(to)) ? ' (so far)' : ''}`;
  }
  return `${short(from, from.slice(0, 4) !== to.slice(0, 4))} – ${short(to, true)}`;
}

/**
 * The period from the page's URL: ?period=<preset>, or ?month=YYYY-MM, or ?period=custom&from=…&to=…. With none, month
 * to date. → { key, from, to, label, month } (month: the one month shown, for the month picker, else null).
 */
export function resolvePeriod(params, today) {
  const thisMonth = monthKey(today);
  const get = (k) => params.get(k) ?? '';
  let key = Object.hasOwn(PERIODS, get('period')) ? get('period') : /^\d{4}-\d{2}$/.test(get('month')) ? 'month' : 'mtd';
  let from;
  let to;
  let month = null;
  const quarterStart = shiftMonth(thisMonth, -((Number(thisMonth.slice(5)) - 1) % 3));
  switch (key) {
    case 'last_month':
      month = shiftMonth(thisMonth, -1);
      [from, to] = [firstDay(month), lastDay(month)];
      break;
    case 'last_3_months':
      [from, to] = [firstDay(shiftMonth(thisMonth, -3)), lastDay(shiftMonth(thisMonth, -1))];
      break;
    case 'qtd':
      [from, to] = [firstDay(quarterStart), today];
      break;
    case 'ytd':
      [from, to] = [`${today.slice(0, 4)}-01-01`, today];
      break;
    case 'last_12_months':
      [from, to] = [firstDay(shiftMonth(thisMonth, -11)), today];
      break;
    case 'custom':
      if (DATE.test(get('from')) && DATE.test(get('to')) && get('from') <= get('to')) {
        [from, to] = [get('from'), get('to') > today ? today : get('to')];
        break;
      }
      key = 'mtd';
    // falls through: a custom range without valid dates is month to date
    case 'mtd':
      month = thisMonth;
      [from, to] = [firstDay(thisMonth), today];
      break;
    case 'month': {
      month = get('month') <= thisMonth ? get('month') : thisMonth;
      [from, to] = [firstDay(month), month === thisMonth ? today : lastDay(month)];
      break;
    }
  }
  return { key, from, to, month, label: periodLabel(from, to, today) };
}

/** Monday of a date's week. */
export function mondayOf(s) {
  const d = parse(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

/** The Monday-to-Sunday weeks a custom range covers, for the weekly views: { weeks, end }. */
export function weeksForRange(from, to) {
  const days = (parse(mondayOf(to)) - parse(mondayOf(from))) / 86400000;
  return { weeks: Math.min(Math.max(Math.round(days / 7) + 1, 2), 104), end: to };
}

/** Today in the browser, as YYYY-MM-DD. */
export const todayKey = () => ymd(new Date());
