import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CERT_STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { certStatus } from '../lib/statuses.js';
import CertificationForm from '../components/CertificationForm.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { MarketSelect } from '../components/Pickers.jsx';

export default function CertificationsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.has('new'));
  const filters = { marketId: params.get('marketId') || '', state: params.get('state') || '', expiring: params.get('expiring') === 'true' };
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
  const { data, error } = useLoad(`/api/certifications?${query}`);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('new');
    setParams(next);
  };

  async function create(payload) {
    const { certification } = await api('/api/certifications', { method: 'POST', body: payload });
    navigate(`/certifications/${certification.id}`);
  }

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Certifications</h1>
          <p className="muted">FCC, UKCA, PTCRB and every other mark, per product and market, with certificate numbers, evidence and expiry dates.</p>
        </div>
        {can('editor') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add certification
          </button>
        )}
      </header>

      {adding && (
        <div className="card">
          <h2>New certification</h2>
          <CertificationForm
            initial={{ product_id: params.get('productId') || '', market_id: params.get('marketId') || '' }}
            onSubmit={create}
            onCancel={() => setAdding(false)}
            submitLabel="Add certification"
          />
        </div>
      )}

      <div className="toolbar">
        <div className="row">
          <label className="inline">
            Market
            <MarketSelect value={filters.marketId} onChange={(id) => setFilter('marketId', id)} emptyLabel="All" />
          </label>
          <label className="inline">
            State
            <select value={filters.state} onChange={(e) => setFilter('state', e.target.value)}>
              <option value="">Any</option>
              {Object.entries(CERT_STATES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={filters.expiring} onChange={(e) => setFilter('expiring', e.target.checked ? 'true' : '')} />
            Expired or expiring in 90 days
          </label>
        </div>
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : data.certifications.length === 0 ? (
          <p className="muted pad">No certifications match.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Market</th>
                  <th>Mark</th>
                  <th>State</th>
                  <th>Certificate no.</th>
                  <th>Lab</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {data.certifications.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/products/${c.product_id}`}>{c.product_name}</Link>
                      {c.variant_name && <div className="muted small">{c.variant_name}</div>}
                    </td>
                    <td>{c.market_code}</td>
                    <td>
                      <Link to={`/certifications/${c.id}`}>
                        <strong>{c.mark}</strong>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={certStatus(c)} />
                    </td>
                    <td className="small">{c.cert_number || '—'}</td>
                    <td className="small">{c.lab || '—'}</td>
                    <td className={c.expiry_status === 'expired' ? 'overdue-text' : ''}>{formatDate(c.expiry_date) || '—'}</td>
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
