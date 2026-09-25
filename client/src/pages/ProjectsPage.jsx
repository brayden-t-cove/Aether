import { Link, useSearchParams } from 'react-router-dom';
import { PROJECT_TYPES, STATE_LABELS, STATES } from '../../../shared/workflow.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from '../components/ErrorNote.jsx';
import ProjectTable from '../components/ProjectTable.jsx';

export default function ProjectsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = {
    state: params.get('state') || '',
    type: params.get('type') || '',
    show: params.get('show') || 'open',
  };
  const query = new URLSearchParams();
  if (filters.state) query.set('state', filters.state);
  if (filters.type) query.set('type', filters.type);
  if (filters.show === 'open' && !filters.state) query.set('open', 'true');
  const { data, error } = useLoad(`/api/projects?${query}`);

  const setFilter = (key) => (e) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Projects</h1>
          <p className="muted">Launches and new products, each with a checklist of what has to happen and what is blocking it.</p>
        </div>
        {can('editor') && (
          <Link className="btn primary" to="/projects/new">
            New project
          </Link>
        )}
      </header>

      <div className="toolbar">
        <label className="inline">
          Show
          <select value={filters.show} onChange={setFilter('show')} disabled={Boolean(filters.state)}>
            <option value="open">Open</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="inline">
          State
          <select value={filters.state} onChange={setFilter('state')}>
            <option value="">Any</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          Type
          <select value={filters.type} onChange={setFilter('type')}>
            <option value="">Any</option>
            {Object.entries(PROJECT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : data.projects.length === 0 ? (
          <div className="empty pad">
            <p className="muted">No projects here yet.</p>
            {can('editor') && (
              <Link className="btn primary" to="/projects/new">
                Start the first one
              </Link>
            )}
          </div>
        ) : (
          <ProjectTable projects={data.projects} />
        )}
      </div>
    </div>
  );
}
