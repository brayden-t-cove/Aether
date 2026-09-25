import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { REQUEST_TYPES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, isOverdue } from '../lib/format.js';
import { requestStatus } from '../lib/statuses.js';
import ErrorNote from '../components/ErrorNote.jsx';
import RequestForm from '../components/RequestForm.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export default function DesignRequestsPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.has('new'));
  const show = params.get('show') || 'open';
  const query = new URLSearchParams();
  if (show === 'open') query.set('open', 'true');
  if (show === 'mine') {
    query.set('open', 'true');
    query.set('assigneeId', user.id);
  }
  const { data, error } = useLoad(`/api/design-requests?${query}`);

  async function create(payload) {
    const { request } = await api('/api/design-requests', { method: 'POST', body: payload });
    navigate(`/design-requests/${request.id}`);
  }

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Design requests</h1>
          <p className="muted">Images, renders and graphics the design team is asked for, tied to products and manuals.</p>
        </div>
        {can('editor') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            New request
          </button>
        )}
      </header>

      {adding && (
        <div className="card">
          <h2>New design request</h2>
          <RequestForm
            initial={{ product_id: params.get('productId') || '', document_id: params.get('documentId') || '' }}
            onSubmit={create}
            onCancel={() => setAdding(false)}
            submitLabel="Send request"
          />
        </div>
      )}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {[
            ['open', 'Open'],
            ['mine', 'Assigned to me'],
            ['all', 'All'],
          ].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={show === key} className={`tab ${show === key ? 'active' : ''}`} onClick={() => setParams({ show: key })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : data.requests.length === 0 ? (
          <p className="muted pad">No requests here.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Product</th>
                  <th>State</th>
                  <th>Assigned to</th>
                  <th>Requested by</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => {
                  const late = isOverdue({ state: ['approved', 'cancelled'].includes(r.state) ? 'done' : 'open', due_date: r.due_date });
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/design-requests/${r.id}`}>
                          <strong>{r.title}</strong>
                        </Link>
                        <div className="muted small">
                          {REQUEST_TYPES[r.type]}
                          {r.document_title && ` · for ${r.document_title}`}
                        </div>
                      </td>
                      <td>{r.product_id ? <Link to={`/products/${r.product_id}`}>{r.product_name}</Link> : '—'}</td>
                      <td>
                        <StatusBadge status={requestStatus(r.state)} title={r.state === 'delivered' ? 'Delivered, waiting for approval' : undefined} />
                      </td>
                      <td>{r.assignee_name || <span className="muted">Unassigned</span>}</td>
                      <td className="small">{r.requested_by_name || '—'}</td>
                      <td className={late ? 'overdue-text' : ''}>{formatDate(r.due_date) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
