import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ActivityList from '../components/ActivityList.jsx';
import ErrorNote from '../components/ErrorNote.jsx';

/** A cell that saves when you leave it. */
function Cell({ value, editable, onSave, label }) {
  const [text, setText] = useState(value);
  const [state, setState] = useState('idle');
  useEffect(() => setText(value), [value]);
  if (!editable) return <span className="pre">{value || <span className="muted">—</span>}</span>;
  return (
    <input
      className={`cell-input ${state}`}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        if (text === value) return;
        setState('saving');
        try {
          await onSave(text);
          setState('saved');
        } catch {
          setState('failed');
        }
      }}
    />
  );
}

export default function ComparisonPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/comparisons/${id}`);
  const competitors = useLoad('/api/competitors');
  const [adding, setAdding] = useState(null); // null | { mode: 'existing' | 'new', ... }
  const [newRow, setNewRow] = useState('');
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { comparison: c, attributes, values, activity } = data;
  const cols = data.competitors;
  const editable = can('editor');
  const cell = (attrId, compId) => values.find((v) => v.attribute_id === attrId && (v.competitor_id || null) === (compId || null))?.value || '';

  async function run(fn) {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err);
    }
  }

  const saveCell = (attributeId, competitorId) => (value) =>
    api(`/api/comparisons/${id}/values`, { method: 'PUT', body: { attribute_id: attributeId, competitor_id: competitorId, value } });

  const available = (competitors.data?.competitors || []).filter((k) => !cols.some((col) => col.id === k.id));

  return (
    <div className="page wide">
      <nav className="crumbs">
        <Link to="/comparisons">Comparisons</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>{c.name}</h1>
          {c.product_id && (
            <p className="muted">
              Luna product: <Link to={`/products/${c.product_id}`}>{c.product_name}</Link>
            </p>
          )}
        </div>
        {editable && !adding && (
          <button className="btn primary" onClick={() => setAdding({ mode: available.length ? 'existing' : 'new', competitor_id: '', brand: '', name: '', price: '', url: '' })}>
            Add competitor
          </button>
        )}
      </header>
      <ErrorNote error={actionError} />

      {adding && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const body = adding.mode === 'existing' ? { competitor_id: adding.competitor_id } : { brand: adding.brand, name: adding.name, price: adding.price, url: adding.url };
              await api(`/api/comparisons/${id}/competitors`, { method: 'POST', body });
              setAdding(null);
              competitors.reload();
            });
          }}
        >
          <div className="tabs" role="tablist">
            <button type="button" className={`tab ${adding.mode === 'existing' ? 'active' : ''}`} onClick={() => setAdding({ ...adding, mode: 'existing' })} disabled={!available.length}>
              Pick an existing one
            </button>
            <button type="button" className={`tab ${adding.mode === 'new' ? 'active' : ''}`} onClick={() => setAdding({ ...adding, mode: 'new' })}>
              New competitor
            </button>
          </div>
          {adding.mode === 'existing' ? (
            <select required value={adding.competitor_id} onChange={(e) => setAdding({ ...adding, competitor_id: e.target.value })} aria-label="Competitor">
              <option value="">— Choose —</option>
              {available.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.brand} {k.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="form-row">
              <label>
                Brand
                <input required value={adding.brand} onChange={(e) => setAdding({ ...adding, brand: e.target.value })} placeholder="Ring" />
              </label>
              <label>
                Product
                <input required value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Battery Doorbell Plus" />
              </label>
              <label>
                Price
                <input value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} placeholder="$149.99" />
              </label>
              <label>
                Link
                <input type="url" value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} placeholder="https://" />
              </label>
            </div>
          )}
          <div className="row">
            <button className="btn primary">Add</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card flush">
        <div className="table-wrap">
          <table className="matrix comparison">
            <thead>
              <tr>
                <th />
                <th className="luna-col">
                  {c.product_name || 'Luna'}
                  <div className="muted small">Luna</div>
                </th>
                {cols.map((k) => (
                  <th key={k.id}>
                    {k.url ? (
                      <a href={k.url} target="_blank" rel="noreferrer noopener">
                        {k.brand} {k.name}
                      </a>
                    ) : (
                      `${k.brand} ${k.name}`
                    )}
                    <div className="muted small">
                      {k.price !== null && `$${Number(k.price).toFixed(2)}`}
                      {editable && (
                        <button
                          className="link-btn small remove-col"
                          onClick={() => window.confirm(`Remove ${k.brand} ${k.name} from this comparison?`) && run(() => api(`/api/comparisons/${id}/competitors/${k.id}`, { method: 'DELETE' }))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attributes.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    {a.name}
                    {editable && (
                      <button
                        className="link-btn small remove-row"
                        aria-label={`Remove row ${a.name}`}
                        onClick={() => window.confirm(`Remove the "${a.name}" row?`) && run(() => api(`/api/comparison-attributes/${a.id}`, { method: 'DELETE' }))}
                      >
                        ×
                      </button>
                    )}
                  </th>
                  <td className="luna-col">
                    <Cell value={cell(a.id, null)} editable={editable} onSave={saveCell(a.id, null)} label={`${a.name} for ${c.product_name || 'Luna'}`} />
                  </td>
                  {cols.map((k) => (
                    <td key={k.id}>
                      <Cell value={cell(a.id, k.id)} editable={editable} onSave={saveCell(a.id, k.id)} label={`${a.name} for ${k.brand} ${k.name}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <form
            className="add-item"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/api/comparisons/${id}/attributes`, { method: 'POST', body: { name: newRow } });
                setNewRow('');
              });
            }}
          >
            <input required value={newRow} onChange={(e) => setNewRow(e.target.value)} placeholder="Add a row, e.g. Works with Alexa" aria-label="New row" />
            <button className="btn">Add row</button>
          </form>
        )}
      </div>

      <section className="card">
        <h2>History</h2>
        <ActivityList activity={activity} linkRecords={false} />
      </section>

      {editable && (
        <div className="danger-zone">
          <button
            className="btn ghost danger"
            onClick={() => window.confirm(`Delete "${c.name}"?`) && api(`/api/comparisons/${id}`, { method: 'DELETE' }).then(() => navigate('/comparisons')).catch(setActionError)}
          >
            Delete comparison
          </button>
        </div>
      )}
    </div>
  );
}
