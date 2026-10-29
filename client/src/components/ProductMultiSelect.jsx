/**
 * Pick any number of products, by Aether's own product names (the same across Amazon, TikTok and other listings,
 * which each belong to one product). Nothing picked means all products.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LIFECYCLES } from '../../../shared/workflow.js';
import { useLoad } from '../lib/useLoad.js';

const ORDER = { active: 0, upcoming: 1, sunset: 2 };

export default function ProductMultiSelect({ value = [], onChange, label = 'Products' }) {
  const { data } = useLoad('/api/products');
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  // Close the list on a click or Escape anywhere else on the page.
  useEffect(() => {
    const close = (e) => {
      if (ref.current?.open && (e.key === 'Escape' || (e.type === 'mousedown' && !ref.current.contains(e.target)))) ref.current.open = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  const products = useMemo(
    () => [...(data?.products || [])].sort((a, b) => (ORDER[a.lifecycle] ?? 3) - (ORDER[b.lifecycle] ?? 3) || a.name.localeCompare(b.name)),
    [data],
  );
  const chosen = products.filter((p) => value.includes(p.id));
  const shown = products.filter((p) => !search || `${p.name} ${p.model || ''}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const summary = !value.length ? 'All' : chosen.length === 1 ? chosen[0].name : `${value.length} products`;

  return (
    <details className="multi-select" ref={ref}>
      <summary aria-label={`${label}: ${summary}`}>
        {label}: <strong>{summary}</strong>
      </summary>
      <div className="multi-pop" role="group" aria-label={label}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" aria-label="Search products" />
        <ul>
          {shown.map((p) => (
            <li key={p.id}>
              <label className="inline">
                <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
                <span>
                  {p.name}
                  {p.model && <span className="muted small"> {p.model}</span>}
                  {p.lifecycle === 'sunset' && <span className="muted small"> · {LIFECYCLES.sunset}</span>}
                </span>
              </label>
            </li>
          ))}
          {!shown.length && <li className="muted small">No products match.</li>}
        </ul>
        {value.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onChange([])}>
            Clear: show all products
          </button>
        )}
      </div>
    </details>
  );
}
