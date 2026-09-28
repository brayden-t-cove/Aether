import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { ProductSelect } from '../components/Pickers.jsx';

export default function ComparisonsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error } = useLoad('/api/comparisons');
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);

  async function create(e) {
    e.preventDefault();
    setFormError(null);
    try {
      const { comparison } = await api('/api/comparisons', { method: 'POST', body: { ...form, product_id: form.product_id || null } });
      navigate(`/comparisons/${comparison.id}`);
    } catch (err) {
      setFormError(err);
    }
  }

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Comparisons</h1>
          <p className="muted">Luna products side by side with what's on the market: price, specs and features.</p>
        </div>
        {can('editor') && !form && (
          <button className="btn primary" onClick={() => setForm({ name: '', product_id: '', starter_attributes: true })}>
            New comparison
          </button>
        )}
      </header>

      {form && (
        <form className="card stack" onSubmit={create}>
          <h2>New comparison</h2>
          <ErrorNote error={formError} />
          <div className="form-row">
            <label>
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Doorbell cameras under $100" />
            </label>
            <label>
              Luna product
              <ProductSelect value={form.product_id} onChange={(id) => setForm({ ...form, product_id: id })} emptyLabel="— None —" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.starter_attributes} onChange={(e) => setForm({ ...form, starter_attributes: e.target.checked })} />
            Start with common rows (price, resolution, field of view, night vision, power, storage, subscription…)
          </label>
          <div className="row">
            <button className="btn primary">Create</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : data.comparisons.length === 0 ? (
          <p className="muted pad">No comparisons yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comparison</th>
                  <th>Luna product</th>
                  <th className="num">Competitors</th>
                  <th className="num">Rows</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.comparisons.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/comparisons/${c.id}`}>
                        <strong>{c.name}</strong>
                      </Link>
                    </td>
                    <td>{c.product_name || '—'}</td>
                    <td className="num">{c.competitor_count}</td>
                    <td className="num">{c.attribute_count}</td>
                    <td className="small muted">{formatDateTime(c.updated_at)}</td>
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
