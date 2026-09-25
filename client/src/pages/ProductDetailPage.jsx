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
import ProductPhase2 from '../components/ProductPhase2.jsx';
import OdysseyBadge from '../components/OdysseyBadge.jsx';
import TestSessions from '../components/TestSessions.jsx';
import { VENDOR_TYPES } from '../../../shared/workflow.js';

export default function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/products/${id}`);
  const odyssey = useLoad('/api/odyssey/status');
  const [sendError, setSendError] = useState(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { product, projects, vendors } = data;
  const editable = can('editor');

  async function sendToOdyssey() {
    setSending(true);
    setSendError(null);
    try {
      await api(`/api/products/${id}/send-to-odyssey`, { method: 'POST', body: {} });
      reload();
    } catch (err) {
      setSendError(err);
    } finally {
      setSending(false);
    }
  }

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
          <h1>
            {product.name} {product.odyssey_id && <OdysseyBadge linked={product.source !== 'odyssey'} />}
          </h1>
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
          {editable && odyssey.data?.configured && !product.odyssey_id && (
            <button className="btn" onClick={sendToOdyssey} disabled={sending} title="Add this product to Odyssey's catalog">
              {sending ? 'Sending…' : 'Send to Odyssey'}
            </button>
          )}
          {editable && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </header>
      <ErrorNote error={sendError} />

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
            <dd>
              {product.source === 'odyssey'
                ? 'Synced from Odyssey (name, model, manufacturer, category and lifecycle are edited there)'
                : product.odyssey_id
                  ? 'Aether, linked to Odyssey'
                  : 'Aether'}
            </dd>
            {vendors.length > 0 && (
              <>
                <dt>Vendors</dt>
                <dd>
                  {vendors.map((v, i) => (
                    <span key={`${v.id}:${v.role}`}>
                      {i > 0 && ', '}
                      <Link to={`/vendors/${v.id}`}>{v.name}</Link> <span className="muted small">({VENDOR_TYPES[v.role].toLowerCase()})</span>
                    </span>
                  ))}
                </dd>
              </>
            )}
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

      <ProductPhase2 key={product.updated_at} product={product} editable={editable} />
      <TestSessions productId={product.id} />

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
