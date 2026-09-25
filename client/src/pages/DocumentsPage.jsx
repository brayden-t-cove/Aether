import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DOCUMENT_KINDS, VERSION_STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime, joinList } from '../lib/format.js';
import { versionStatus } from '../lib/statuses.js';
import ErrorNote from '../components/ErrorNote.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { MarketSelect, ProductSelect } from '../components/Pickers.jsx';

function NewDocumentForm({ initial, onCreated, onCancel }) {
  const [form, setForm] = useState({ product_id: '', market_id: '', kind: 'manual', title: '', languages: '', state: 'draft', ...initial });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const { state, ...doc } = form;
      const { document } = await api('/api/documents', {
        method: 'POST',
        body: { ...doc, market_id: doc.market_id || null, first_version: { state } },
      });
      onCreated(document);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h2>New manual or packaging</h2>
      <ErrorNote error={error} />
      <div className="form-row">
        <label>
          Product
          <ProductSelect required value={form.product_id} onChange={(id) => setForm((f) => ({ ...f, product_id: id }))} />
        </label>
        <label>
          Type
          <select value={form.kind} onChange={set('kind')}>
            {Object.entries(DOCUMENT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Market <span className="muted small">(blank = all markets)</span>
          </span>
          <MarketSelect value={form.market_id} onChange={(id) => setForm((f) => ({ ...f, market_id: id }))} emptyLabel="All markets" />
        </label>
      </div>
      <div className="form-row">
        <label>
          Title
          <input required value={form.title} onChange={set('title')} placeholder="User manual" />
        </label>
        <label>
          Languages
          <input value={form.languages} onChange={set('languages')} placeholder="English, Spanish" />
        </label>
        <label>
          First version is
          <select value={form.state} onChange={set('state')}>
            {Object.entries(VERSION_STATES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn primary">Create</button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function DocumentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.has('new'));
  const kind = params.get('kind') || '';
  const state = params.get('state') || '';
  const query = new URLSearchParams(Object.entries({ kind, state }).filter(([, v]) => v));
  const { data, error } = useLoad(`/api/documents?${query}`);

  const setFilter = (key) => (e) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value);
    else next.delete(key);
    next.delete('new');
    setParams(next);
  };

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Manuals &amp; packaging</h1>
          <p className="muted">Each manual, packaging design and label, with its versions from draft to sent to the OEM.</p>
        </div>
        {can('editor') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </header>

      {adding && (
        <NewDocumentForm
          initial={{ product_id: params.get('productId') || '', market_id: params.get('marketId') || '', kind: params.get('newKind') || 'manual' }}
          onCreated={(doc) => navigate(`/manuals/${doc.id}`)}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="toolbar">
        <div className="row">
          <label className="inline">
            Type
            <select value={kind} onChange={setFilter('kind')}>
              <option value="">All</option>
              {Object.entries(DOCUMENT_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            Latest version
            <select value={state} onChange={setFilter('state')}>
              <option value="">Any</option>
              {Object.entries(VERSION_STATES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : data.documents.length === 0 ? (
          <p className="muted pad">Nothing here yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Product</th>
                  <th>Market</th>
                  <th>Languages</th>
                  <th>Latest version</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/manuals/${d.id}`}>
                        <strong>{d.title}</strong>
                      </Link>
                      <div className="muted small">{DOCUMENT_KINDS[d.kind]}</div>
                    </td>
                    <td>
                      <Link to={`/products/${d.product_id}`}>{d.product_name}</Link>
                    </td>
                    <td>{d.market_code || <span className="muted">All</span>}</td>
                    <td className="small">{joinList(d.languages)}</td>
                    <td>
                      <StatusBadge status={versionStatus(d.latest_state)} />
                      {d.latest_version && <span className="muted small"> {d.latest_version}</span>}
                    </td>
                    <td className="small muted">{formatDateTime(d.latest_updated_at || d.updated_at)}</td>
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
