/** 'YYYY-MM-DD' → 'Nov 30, 2026'. Parsed as a local date so it never shifts a day. */
export function formatDate(value) {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** Today's date as 'YYYY-MM-DD' in the viewer's time zone. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const isOverdue = (item) => item.state !== 'done' && item.due_date && item.due_date < today();

export const joinList = (values) => (values?.length ? values.join(', ') : '—');
