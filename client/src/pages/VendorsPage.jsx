import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { VENDOR_STATUSES, VENDOR_TYPES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { joinList } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import VendorForm from '../components/VendorForm.jsx';
import OdysseyBadge from '../components/OdysseyBadge.jsx';

export default function VendorsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const type = params.get('type') || '';
  const [q, setQ] = useState('');
  const { data, error } = useLoad(`/api/vendors${type ? `?type=${type}` : ''}`);
  const needle = q.trim().toLowerCase();
  const vendors = (data?.vendors || []).filter((v) => !needle || [v.name, v.country, ...v.product_names].some((x) => x?.toLowerCase().includes(needle)));

  async function create(payload) {
    const { vendor } = await api('/api/vendors', { method: 'POST', body: payload });
    navigate(`/vendors/${vendor.id}`);
  }

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Vendors</h1>
          <p className="muted">Manufacturers, certification labs, packaging and translation partners. Vendors from Odyssey appear automatically.</p>
        </div>
        {can('editor') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add vendor
          </button>
        )}
      </header>

      {adding && (
        <div className="card">
          <h2>New vendor</h2>
          <VendorForm onSubmit={create} onCancel={() => setAdding(false)} submitLabel="Add vendor" />
        </div>
      )}

      <div className="toolbar">
        <label className="inline">
          Type
          <select value={type} onChange={(e) => setParams(e.target.value ? { type: e.target.value } : {})}>
            <option value="">All</option>
            {Object.entries(VENDOR_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <input type="search" placeholder="Search name, country or product" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : vendors.length === 0 ? (
          <p className="muted pad">No vendors yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Products</th>
                  <th className="num">Contacts</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/vendors/${v.id}`}>
                        <strong>{v.name}</strong>
                      </Link>{' '}
                      {v.source === 'odyssey' && <OdysseyBadge />}
                      {v.country && <div className="muted small">{v.country}</div>}
                    </td>
                    <td>{VENDOR_TYPES[v.type]}</td>
                    <td>{VENDOR_STATUSES[v.status]}</td>
                    <td className="small">{joinList(v.product_names)}</td>
                    <td className="num">{v.contact_count || '—'}</td>
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
