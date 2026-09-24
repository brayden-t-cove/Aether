import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { joinList } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import MarketForm from '../components/MarketForm.jsx';
import ProjectTable from '../components/ProjectTable.jsx';

export default function MarketDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/markets/${id}`);
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { market, projects } = data;

  async function save(payload) {
    await api(`/api/markets/${id}`, { method: 'PATCH', body: payload });
    setEditing(false);
    reload();
  }

  async function remove() {
    if (!window.confirm(`Delete ${market.code}? This can't be undone.`)) return;
    try {
      await api(`/api/markets/${id}`, { method: 'DELETE' });
      navigate('/markets');
    } catch (err) {
      setDeleteError(err);
    }
  }

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/markets">Markets</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>
            {market.code} <span className="muted">· {market.name}</span>
          </h1>
        </div>
        <div className="row">
          {can('editor') && (
            <Link className="btn primary" to={`/projects/new?market=${market.id}`}>
              Start a launch
            </Link>
          )}
          {can('editor') && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </header>

      {editing ? (
        <div className="card">
          <MarketForm market={market} onSubmit={save} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <div className="card">
          <dl className="details">
            <dt>Plug types</dt>
            <dd>{joinList(market.plug_types)}</dd>
            <dt>Power</dt>
            <dd>{[market.voltage, market.frequency].filter(Boolean).join(' / ') || '—'}</dd>
            <dt>Required marks</dt>
            <dd>{joinList(market.required_marks)}</dd>
            <dt>Languages</dt>
            <dd>{joinList(market.languages)}</dd>
            {market.notes && (
              <>
                <dt>Notes</dt>
                <dd className="pre">{market.notes}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      <section className="card flush">
        <h2 className="pad-h">Projects in {market.code}</h2>
        {projects.length ? <ProjectTable projects={projects} hide={['market']} /> : <p className="muted pad">No projects in this market yet.</p>}
      </section>

      {can('admin') && (
        <div className="danger-zone">
          <ErrorNote error={deleteError} />
          <button className="btn ghost danger" onClick={remove}>
            Delete market
          </button>
        </div>
      )}
    </div>
  );
}
