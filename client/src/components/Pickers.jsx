import { useLoad } from '../lib/useLoad.js';

/** Dropdowns for picking a product, market or person. `value` is an ID or ''. */

export function ProductSelect({ value, onChange, required = false, emptyLabel = '— Choose a product —', ...rest }) {
  const { data } = useLoad('/api/products');
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required} {...rest}>
      <option value="">{emptyLabel}</option>
      {(data?.products || []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.model ? ` (${p.model})` : ''}
        </option>
      ))}
    </select>
  );
}

export function MarketSelect({ value, onChange, required = false, emptyLabel = '— Choose a market —', ...rest }) {
  const { data } = useLoad('/api/markets');
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value, data?.markets.find((m) => m.id === e.target.value))}
      required={required}
      {...rest}
    >
      <option value="">{emptyLabel}</option>
      {(data?.markets || []).map((m) => (
        <option key={m.id} value={m.id}>
          {m.code} · {m.name}
        </option>
      ))}
    </select>
  );
}

export function UserSelect({ value, onChange, emptyLabel = 'Unassigned', ...rest }) {
  const { data } = useLoad('/api/users');
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{emptyLabel}</option>
      {(data?.users || [])
        .filter((u) => u.active || u.id === value)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.name || u.email}
          </option>
        ))}
    </select>
  );
}
