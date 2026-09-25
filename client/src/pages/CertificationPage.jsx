import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { certStatus } from '../lib/statuses.js';
import ActivityList from '../components/ActivityList.jsx';
import Attachments from '../components/Attachments.jsx';
import CertificationForm from '../components/CertificationForm.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export default function CertificationPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/certifications/${id}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { certification: c, activity } = data;

  async function save(payload) {
    await api(`/api/certifications/${id}`, { method: 'PATCH', body: payload });
    setEditing(false);
    reload();
  }

  async function remove() {
    if (!window.confirm(`Delete the ${c.mark} certification for ${c.product_name}, and its files?`)) return;
    try {
      await api(`/api/certifications/${id}`, { method: 'DELETE' });
      navigate('/certifications');
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <div className="page narrow-ish">
      <nav className="crumbs">
        <Link to="/certifications">Certifications</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>
            {c.mark} <span className="muted">· {c.market_code}</span>
          </h1>
          <p className="muted">
            <Link to={`/products/${c.product_id}`}>{c.product_name}</Link>
            {c.variant_name && ` · ${c.variant_name}`}
          </p>
        </div>
        {can('editor') && !editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>
      <ErrorNote error={actionError} />

      {editing ? (
        <div className="card">
          <CertificationForm certification={c} onSubmit={save} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <div className="card">
          <dl className="details">
            <dt>State</dt>
            <dd>
              <StatusBadge status={certStatus(c)} />
            </dd>
            <dt>Certificate no.</dt>
            <dd>{c.cert_number || '—'}</dd>
            <dt>Lab</dt>
            <dd>{c.lab || '—'}</dd>
            <dt>Issued</dt>
            <dd>{formatDate(c.issued_date) || '—'}</dd>
            <dt>Expires</dt>
            <dd className={c.expiry_status === 'expired' ? 'overdue-text' : ''}>{formatDate(c.expiry_date) || '—'}</dd>
            {c.notes && (
              <>
                <dt>Notes</dt>
                <dd className="pre">{c.notes}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      <section className="card">
        <h2>Evidence</h2>
        <p className="muted small">Certificates, test reports, grant letters.</p>
        <Attachments entityType="certification" entityId={c.id} attachments={c.attachments} editable={can('editor')} onChange={reload} />
      </section>

      <section className="card">
        <h2>History</h2>
        <ActivityList activity={activity} linkRecords={false} />
      </section>

      {can('admin') && (
        <div className="danger-zone">
          <button className="btn ghost danger" onClick={remove}>
            Delete certification
          </button>
        </div>
      )}
    </div>
  );
}
