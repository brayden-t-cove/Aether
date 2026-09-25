import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DOCUMENT_KINDS, VERSION_STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, formatDateTime, joinList } from '../lib/format.js';
import { requestStatus, versionStatus } from '../lib/statuses.js';
import ActivityList from '../components/ActivityList.jsx';
import Attachments from '../components/Attachments.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { MarketSelect } from '../components/Pickers.jsx';

function VersionCard({ version, editable, canDelete, latest, onChange }) {
  const [notes, setNotes] = useState(version.notes);
  const [error, setError] = useState(null);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <li className={`version ${latest ? 'latest' : ''}`}>
      <div className="version-head">
        <strong>{version.version}</strong>
        {latest && <span className="tag">Latest</span>}
        {editable ? (
          <select
            aria-label={`State of ${version.version}`}
            className={`state-select tone-${versionStatus(version.state).tone}`}
            value={version.state}
            onChange={(e) => run(() => api(`/api/versions/${version.id}`, { method: 'PATCH', body: { state: e.target.value } }))}
          >
            {Object.entries(VERSION_STATES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <StatusBadge status={versionStatus(version.state)} />
        )}
        <span className="muted small">
          {version.created_by_name ? `${version.created_by_name} · ` : ''}
          {formatDateTime(version.created_at)}
          {version.approved_at && ` · approved by ${version.approved_by_name || 'someone'} ${formatDate(version.approved_at.slice(0, 10))}`}
        </span>
        <span className="spacer" />
        {canDelete && (
          <button
            className="btn ghost danger small"
            onClick={() => window.confirm(`Delete ${version.version} and its files?`) && run(() => api(`/api/versions/${version.id}`, { method: 'DELETE' }))}
          >
            Delete
          </button>
        )}
      </div>
      <ErrorNote error={error} />
      {editable ? (
        <textarea
          rows={2}
          value={notes}
          placeholder="What changed in this version?"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== version.notes && run(() => api(`/api/versions/${version.id}`, { method: 'PATCH', body: { notes } }))}
          aria-label={`Notes for ${version.version}`}
        />
      ) : (
        version.notes && <p className="pre small">{version.notes}</p>
      )}
      <Attachments entityType="document_version" entityId={version.id} attachments={version.attachments} editable={editable} onChange={onChange} compact />
    </li>
  );
}

function DocumentForm({ document, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: document.title,
    kind: document.kind,
    market_id: document.market_id || '',
    languages: document.languages.join(', '),
    notes: document.notes,
  });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/documents/${document.id}`, { method: 'PATCH', body: { ...form, market_id: form.market_id || null } });
          onSaved();
        } catch (err) {
          setError(err);
        }
      }}
    >
      <ErrorNote error={error} />
      <div className="form-row">
        <label>
          Title
          <input required value={form.title} onChange={set('title')} />
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
          Market
          <MarketSelect value={form.market_id} onChange={(id) => setForm((f) => ({ ...f, market_id: id }))} emptyLabel="All markets" />
        </label>
      </div>
      <label>
        Languages
        <input value={form.languages} onChange={set('languages')} />
      </label>
      <label>
        Notes
        <textarea rows={3} value={form.notes} onChange={set('notes')} />
      </label>
      <div className="row">
        <button className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function DocumentPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/documents/${id}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { document: d, versions, requests, activity } = data;
  const editable = can('editor');

  async function addVersion() {
    setActionError(null);
    try {
      await api(`/api/documents/${id}/versions`, { method: 'POST', body: { state: 'draft' } });
      reload();
    } catch (err) {
      setActionError(err);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${d.title}", all its versions and files?`)) return;
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' });
      navigate('/manuals');
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <div className="page narrow-ish">
      <nav className="crumbs">
        <Link to="/manuals">Manuals &amp; packaging</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>{d.title}</h1>
          <p className="muted">
            {DOCUMENT_KINDS[d.kind]} · <Link to={`/products/${d.product_id}`}>{d.product_name}</Link> · {d.market_name || 'All markets'}
            {d.languages.length > 0 && ` · ${joinList(d.languages)}`}
          </p>
        </div>
        {editable && !editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </header>
      <ErrorNote error={actionError} />
      {editing && (
        <DocumentForm
          document={d}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {!editing && d.notes && <p className="pre">{d.notes}</p>}

      <section className="card">
        <div className="row between">
          <h2>Versions</h2>
          {editable && (
            <button className="btn small" onClick={addVersion}>
              New version
            </button>
          )}
        </div>
        {versions.length === 0 ? (
          <p className="muted">No versions yet.</p>
        ) : (
          <ul className="versions">
            {versions.map((v, i) => (
              <VersionCard key={`${v.id}:${v.updated_at}`} version={v} latest={i === 0} editable={editable} canDelete={can('admin')} onChange={reload} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Design requests</h2>
          {editable && (
            <Link className="btn small" to={`/design-requests?new&productId=${d.product_id}&documentId=${d.id}`}>
              Request design work
            </Link>
          )}
        </div>
        {requests.length === 0 ? (
          <p className="muted">None for this document.</p>
        ) : (
          <ul className="dash-items">
            {requests.map((r) => (
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

      <section className="card">
        <h2>History</h2>
        <ActivityList activity={activity} linkRecords={false} />
      </section>

      {can('admin') && (
        <div className="danger-zone">
          <button className="btn ghost danger" onClick={remove}>
            Delete document
          </button>
        </div>
      )}
    </div>
  );
}
