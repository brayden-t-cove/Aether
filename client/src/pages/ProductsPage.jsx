import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LIFECYCLES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { joinList } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import ProductForm from '../components/ProductForm.jsx';

const TABS = [['', 'All'], ...Object.entries(LIFECYCLES)];

export default function ProductsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lifecycle = params.get('lifecycle') || '';
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, error, loading } = useLoad(`/api/products${lifecycle ? `?lifecycle=${lifecycle}` : ''}`);

  const needle = q.trim().toLowerCase();
  const products = (data?.products || []).filter(
    (p) => !needle || [p.name, p.sku, p.category].some((v) => v?.toLowerCase().includes(needle)),
  );

  async function create(payload) {
    const { product } = await api('/api/products', { method: 'POST', body: payload });
    navigate(`/products/${product.id}`);
  }

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Products</h1>
          <p className="muted">Luna's catalog: what's selling, what's coming and what's been retired.</p>
        </div>
        {can('editor') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add product
          </button>
        )}
      </header>

      {adding && (
        <div className="card">
          <h2>New product</h2>
          <ProductForm onSubmit={create} onCancel={() => setAdding(false)} submitLabel="Add product" />
        </div>
      )}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={lifecycle === key}
              className={`tab ${lifecycle === key ? 'active' : ''}`}
              onClick={() => setParams(key ? { lifecycle: key } : {})}
            >
              {label}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search name, SKU or category" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {loading && !data ? (
          <p className="muted pad">Loading…</p>
        ) : products.length === 0 ? (
          <p className="muted pad">{data?.products.length ? 'No products match that search.' : 'No products yet.'}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Lifecycle</th>
                  <th>Channels</th>
                  <th className="num">Open projects</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/products/${p.id}`}>
                        <strong>{p.name}</strong>
                      </Link>
                      {p.sku && <div className="muted small">{p.sku}</div>}
                    </td>
                    <td>{p.category || '—'}</td>
                    <td>
                      <span className={`tag lifecycle-${p.lifecycle}`}>{LIFECYCLES[p.lifecycle]}</span>
                    </td>
                    <td className="small">{joinList(p.channels)}</td>
                    <td className="num">{p.open_project_count || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
