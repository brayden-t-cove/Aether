import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { REQUEST_STATES, REQUEST_TYPES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { requestStatus } from '../lib/statuses.js';
import ActivityList from '../components/ActivityList.jsx';
import Attachments from '../components/Attachments.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import RequestForm from '../components/RequestForm.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export default function DesignRequestPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/design-requests/${id}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { request: r, activity } = data;
  const editable = can('editor');

  async function patch(body) {
    setActionError(null);
    try {
      await api(`/api/design-requests/${id}`, { method: 'PATCH', body });
      setEditing(false);
      reload();
    } catch (err) {
      setActionError(err);
      throw err;
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${r.title}" and its files?`)) return;
    try {
      await api(`/api/design-requests/${id}`, { method: 'DELETE' });
      navigate('/design-requests');
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <div className="page narrow-ish">
      <nav className="crumbs">
        <Link to="/design-requests">Design requests</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>{r.title}</h1>
          <p className="muted">
            {REQUEST_TYPES[r.type]}
            {r.product_id && (
              <>
                {' · '}
                <Link to={`/products/${r.product_id}`}>{r.product_name}</Link>
              </>
            )}
            {r.document_id && (
              <>
                {' · for '}
                <Link to={`/manuals/${r.document_id}`}>{r.document_title}</Link>
              </>
            )}
          </p>
        </div>
        {editable && !editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>
      <ErrorNote error={actionError} />

      {editing ? (
        <div className="card">
          <RequestForm request={r} onSubmit={patch} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <section className="summary">
          <div className="summary-cell">
            <span className="summary-label">State</span>
            {editable ? (
              <select
                aria-label="Request state"
                className={`state-select tone-${requestStatus(r.state).tone}`}
                value={r.state}
                onChange={(e) => patch({ state: e.target.value }).catch(() => {})}
              >
                {Object.entries(REQUEST_STATES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <StatusBadge status={requestStatus(r.state)} />
            )}
          </div>
          <div className="summary-cell">
            <span className="summary-label">Assigned to</span>
            <span>{r.assignee_name || <span className="muted">Unassigned</span>}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">Requested by</span>
            <span>{r.requested_by_name || '—'}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">Due</span>
            <span>{formatDate(r.due_date) || '—'}</span>
          </div>
        </section>
      )}

      {!editing && r.description && (
        <section className="card">
          <h2>Details</h2>
          <p className="pre">{r.description}</p>
        </section>
      )}

      <section className="card">
        <h2>Deliverables</h2>
        <p className="muted small">Upload the finished images or renders, or link to them. Then set the state to Delivered for review.</p>
        <Attachments entityType="design_request" entityId={r.id} attachments={r.attachments} editable={editable} onChange={reload} />
      </section>

      <section className="card">
        <h2>History</h2>
        <ActivityList activity={activity} linkRecords={false} />
      </section>

      {editable && (
        <div className="danger-zone">
          <button className="btn ghost danger" onClick={remove}>
            Delete request
          </button>
        </div>
      )}
    </div>
  );
}
