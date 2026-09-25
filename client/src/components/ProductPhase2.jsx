import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DOCUMENT_KINDS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { certStatus, requestStatus, versionStatus } from '../lib/statuses.js';
import ErrorNote from './ErrorNote.jsx';
import ReadinessCell from './ReadinessCell.jsx';
import StatusBadge from './StatusBadge.jsx';
import { MarketSelect } from './Pickers.jsx';

function Variants({ productId, editable }) {
  const { data, reload } = useLoad(`/api/products/${productId}/variants`);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...form, market_id: form.market_id || null };
      if (form.id) await api(`/api/variants/${form.id}`, { method: 'PATCH', body });
      else await api(`/api/products/${productId}/variants`, { method: 'POST', body });
      setForm(null);
      reload();
    } catch (err) {
      setError(err);
    }
  }

  async function remove(v) {
    if (!window.confirm(`Remove the ${v.name} variant?`)) return;
    await api(`/api/variants/${v.id}`, { method: 'DELETE' });
    reload();
  }

  const variants = data?.variants || [];
  return (
    <section className="card">
      <div className="row between">
        <h2>Regional variants</h2>
        {editable && !form && (
          <button className="btn small" onClick={() => setForm({ name: '', market_id: '', sku: '', differences: '' })}>
            Add variant
          </button>
        )}
      </div>
      {variants.length === 0 && !form && <p className="muted">No regional variants. Add one when a market needs a different plug, packaging or language.</p>}
      {variants.length > 0 && (
        <ul className="dash-items">
          {variants.map((v) => (
            <li key={v.id}>
              <div className="dash-item-main">
                <strong>{v.name}</strong>
                <span className="muted small">{[v.market_code, v.sku, v.model].filter(Boolean).join(' · ')}</span>
                {editable && (
                  <>
                    <span className="spacer" />
                    <button className="btn ghost small" onClick={() => setForm({ ...v, sku: v.sku || '', market_id: v.market_id || '' })}>
                      Edit
                    </button>
                    <button className="btn ghost small danger" onClick={() => remove(v)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
              {v.differences && <div className="small pre">{v.differences}</div>}
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form className="stack" onSubmit={save}>
          <ErrorNote error={error} />
          <div className="form-row">
            <label>
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="UK variant" />
            </label>
            <label>
              Market
              <MarketSelect value={form.market_id} onChange={(id) => setForm({ ...form, market_id: id })} emptyLabel="— Any —" />
            </label>
            <label>
              SKU
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </label>
          </div>
          <label>
            What's different
            <textarea rows={2} value={form.differences} onChange={(e) => setForm({ ...form, differences: e.target.value })} placeholder="Type G plug, UKCA label, English/Welsh manual" />
          </label>
          <div className="row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Readiness, variants, certifications, manuals and design requests for one product. */
export default function ProductPhase2({ product, editable }) {
  const readiness = useLoad(`/api/readiness?productId=${product.id}&includeSunset=true`);
  const certs = useLoad(`/api/certifications?productId=${product.id}`);
  const docs = useLoad(`/api/documents?productId=${product.id}`);
  const requests = useLoad(`/api/design-requests?productId=${product.id}`);
  const row = readiness.data?.rows[0];
  const markets = readiness.data?.markets || [];

  return (
    <>
      <section className="card">
        <h2>Readiness by market</h2>
        {!row || markets.length === 0 ? (
          <p className="muted">No markets yet. Edit the product to add the markets it sells in or is planned for.</p>
        ) : (
          <div className="readiness-cards">
            {markets.map((m) => (
              <div key={m.id} className="readiness-card">
                <h3>
                  <Link to={`/markets/${m.id}`}>{m.code}</Link> <span className="muted small">{m.name}</span>
                </h3>
                <ReadinessCell cell={row.cells[m.id]} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card flush">
        <div className="row between pad-h">
          <h2>Certifications</h2>
          {editable && (
            <Link className="btn small" to={`/certifications?new&productId=${product.id}`}>
              Add certification
            </Link>
          )}
        </div>
        {!certs.data?.certifications.length ? (
          <p className="muted pad">No certifications on record.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mark</th>
                  <th>Market</th>
                  <th>State</th>
                  <th>Certificate no.</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {certs.data.certifications.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/certifications/${c.id}`}>
                        <strong>{c.mark}</strong>
                      </Link>
                    </td>
                    <td>{c.market_code}</td>
                    <td>
                      <StatusBadge status={certStatus(c)} />
                    </td>
                    <td className="small">{c.cert_number || '—'}</td>
                    <td>{formatDate(c.expiry_date) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card flush">
        <div className="row between pad-h">
          <h2>Manuals &amp; packaging</h2>
          {editable && (
            <Link className="btn small" to={`/manuals?new&productId=${product.id}`}>
              Add
            </Link>
          )}
        </div>
        {!docs.data?.documents.length ? (
          <p className="muted pad">No manuals or packaging yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Market</th>
                  <th>Latest version</th>
                </tr>
              </thead>
              <tbody>
                {docs.data.documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/manuals/${d.id}`}>
                        <strong>{d.title}</strong>
                      </Link>
                      <div className="muted small">{DOCUMENT_KINDS[d.kind]}</div>
                    </td>
                    <td>{d.market_code || <span className="muted">All</span>}</td>
                    <td>
                      <StatusBadge status={versionStatus(d.latest_state)} /> <span className="muted small">{d.latest_version}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Design requests</h2>
          {editable && (
            <Link className="btn small" to={`/design-requests?new&productId=${product.id}`}>
              New request
            </Link>
          )}
        </div>
        {!requests.data?.requests.length ? (
          <p className="muted">No design requests for this product.</p>
        ) : (
          <ul className="dash-items">
            {requests.data.requests.map((r) => (
              <li key={r.id}>
                <div className="dash-item-main">
                  <StatusBadge status={requestStatus(r.state)} />
                  <Link to={`/design-requests/${r.id}`}>{r.title}</Link>
                </div>
                <div className="muted small">
                  {r.assignee_name || 'Unassigned'}
                  {r.due_date && ` · due ${formatDate(r.due_date)}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Variants productId={product.id} editable={editable} />
    </>
  );
}
