import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LIFECYCLES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, joinList } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import ProductForm from '../components/ProductForm.jsx';
import ProjectTable from '../components/ProjectTable.jsx';

export default function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/products/${id}`);
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { product, projects } = data;
  const editable = can('editor') && product.source !== 'odyssey';

  async function save(payload) {
    await api(`/api/products/${id}`, { method: 'PATCH', body: payload });
    setEditing(false);
    reload();
  }

  async function remove() {
    if (!window.confirm(`Delete ${product.name}? This can't be undone.`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      navigate('/products');
    } catch (err) {
      setDeleteError(err);
    }
  }

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/products">Products</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>{product.name}</h1>
          <p className="muted">
            <span className={`tag lifecycle-${product.lifecycle}`}>{LIFECYCLES[product.lifecycle]}</span>
            {product.model && <> · {product.model}</>}
            {product.sku && <> · {product.sku}</>}
            {product.category && <> · {product.category}</>}
          </p>
        </div>
        <div className="row">
          {can('editor') && (
            <Link className="btn primary" to={`/projects/new?product=${product.id}`}>
              Start a project
            </Link>
          )}
          {editable && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </header>

      {editing ? (
        <div className="card">
          <ProductForm product={product} onSubmit={save} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <div className="card">
          <dl className="details">
            <dt>Model</dt>
            <dd>{product.model || '—'}</dd>
            <dt>Manufacturer</dt>
            <dd>{product.manufacturer || '—'}</dd>
            <dt>{product.lifecycle === 'upcoming' ? 'Planned markets' : 'Markets'}</dt>
            <dd>
              {product.market_codes.length
                ? product.market_ids.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ', '}
                      <Link to={`/markets/${id}`}>{product.market_codes[i]}</Link>
                    </span>
                  ))
                : '—'}
            </dd>
            <dt>{product.lifecycle === 'upcoming' ? 'Planned channels' : 'Channels'}</dt>
            <dd>{joinList(product.channels)}</dd>
            <dt>Replaces</dt>
            <dd>{product.replaces_id ? <Link to={`/products/${product.replaces_id}`}>{product.replaces_name}{product.replaces_model ? ` (${product.replaces_model})` : ''}</Link> : '—'}</dd>
            {product.replaced_by?.length > 0 && (
              <>
                <dt>Replaced by</dt>
                <dd>
                  {product.replaced_by.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && ', '}
                      <Link to={`/products/${r.id}`}>{r.name}{r.model ? ` (${r.model})` : ''}</Link>
                    </span>
                  ))}
                </dd>
              </>
            )}
            <dt>Launch date</dt>
            <dd>{formatDate(product.launch_date) || '—'}</dd>
            <dt>Discontinued date</dt>
            <dd>{formatDate(product.sunset_date) || '—'}</dd>
            <dt>Source</dt>
            <dd>{product.source === 'odyssey' ? 'Synced from Odyssey (edit it there)' : 'Aether'}</dd>
            {product.notes && (
              <>
                <dt>Notes</dt>
                <dd className="pre">{product.notes}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      <section className="card flush">
        <h2 className="pad-h">Projects</h2>
        {projects.length ? <ProjectTable projects={projects} hide={['product']} /> : <p className="muted pad">No projects for this product yet.</p>}
      </section>

      {can('admin') && (
        <div className="danger-zone">
          <ErrorNote error={deleteError} />
          <button className="btn ghost danger" onClick={remove}>
            Delete product
          </button>
        </div>
      )}
    </div>
  );
}
