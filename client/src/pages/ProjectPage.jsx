import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ITEM_CATEGORIES, PROJECT_TYPES, STATE_LABELS, STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, today } from '../lib/format.js';
import ActivityList from '../components/ActivityList.jsx';
import ChecklistItem from '../components/ChecklistItem.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import ProgressMeter from '../components/ProgressMeter.jsx';
import StateBadge from '../components/StateBadge.jsx';

function ProjectDetailsForm({ project, users, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: project.name,
    type: project.type,
    owner_id: project.owner_id || '',
    target_date: project.target_date || '',
    description: project.description || '',
  });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { ...form, owner_id: form.owner_id || null } });
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <ErrorNote error={error} />
      <label>
        Name
        <input required value={form.name} onChange={set('name')} />
      </label>
      <div className="form-row">
        <label>
          Type
          <select value={form.type} onChange={set('type')}>
            {Object.entries(PROJECT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select value={form.owner_id} onChange={set('owner_id')}>
            <option value="">Unassigned</option>
            {users.filter((u) => u.active || u.id === project.owner_id).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target date
          <input type="date" value={form.target_date} onChange={set('target_date')} />
        </label>
      </div>
      <label>
        Description
        <textarea rows={3} value={form.description} onChange={set('description')} />
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

function AddItemForm({ projectId, onAdded }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/projects/${projectId}/items`, { method: 'POST', body: { title, category } });
      setTitle('');
      onAdded();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="add-item" onSubmit={handleSubmit}>
      <ErrorNote error={error} />
      <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a checklist item…" aria-label="New item title" />
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="New item category">
        {Object.entries(ITEM_CATEGORIES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <button className="btn">Add</button>
    </form>
  );
}

export default function ProjectPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/projects/${id}`);
  const users = useLoad('/api/users');
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data || !users.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const { project, items, activity } = data;
  const editable = can('editor');
  const late = project.state !== 'done' && project.target_date && project.target_date < today();
  const groups = Object.keys(ITEM_CATEGORIES)
    .map((key) => ({ key, label: ITEM_CATEGORIES[key], items: items.filter((i) => i.category === key) }))
    .filter((g) => g.items.length);

  async function setState(state) {
    setActionError(null);
    try {
      await api(`/api/projects/${id}`, { method: 'PATCH', body: { state } });
      reload();
    } catch (err) {
      setActionError(err);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${project.name}" and its whole checklist? This can't be undone.`)) return;
    try {
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      navigate('/projects');
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/projects">Projects</Link> /
      </nav>

      <header className="page-header row between">
        <div>
          <h1>{project.name}</h1>
          <p className="muted">
            {PROJECT_TYPES[project.type]}
            {project.product_id && (
              <>
                {' · '}
                <Link to={`/products/${project.product_id}`}>{project.product_name}</Link>
              </>
            )}
            {project.market_id && (
              <>
                {' · '}
                <Link to={`/markets/${project.market_id}`}>{project.market_name}</Link>
              </>
            )}
          </p>
        </div>
        {editable && !editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </header>

      <ErrorNote error={actionError} />

      {editing ? (
        <ProjectDetailsForm
          project={project}
          users={users.data.users}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : (
        <section className="summary">
          <div className="summary-cell">
            <span className="summary-label">State</span>
            {editable ? (
              <select value={project.state} onChange={(e) => setState(e.target.value)} className={`state-select state-${project.state}`} aria-label="Project state">
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {STATE_LABELS[s]}
                  </option>
                ))}
              </select>
            ) : (
              <StateBadge state={project.state} />
            )}
          </div>
          <div className="summary-cell">
            <span className="summary-label">Progress</span>
            <ProgressMeter done={project.done_count} total={project.item_count} />
          </div>
          <div className="summary-cell">
            <span className="summary-label">Blocked</span>
            <span className={project.blocked_count ? 'flag flag-blocked' : 'muted'}>{project.blocked_count}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">Waiting</span>
            <span className="muted" title="Items waiting on an earlier step">{project.waiting_count}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">Overdue</span>
            <span className={project.overdue_count ? 'flag flag-overdue' : 'muted'}>{project.overdue_count}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">Owner</span>
            <span>{project.owner_name || <span className="muted">Unassigned</span>}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">Target</span>
            <span className={late ? 'overdue-text' : ''}>{formatDate(project.target_date) || '—'}</span>
          </div>
        </section>
      )}

      {project.description && !editing && <p className="pre">{project.description}</p>}

      <section className="card flush">
        <h2 className="pad-h">Checklist</h2>
        {items.length === 0 && <p className="muted pad">No items yet.{editable && ' Add the first one below.'}</p>}
        {groups.map((g) => (
          <div key={g.key} className="item-group">
            <h3 className="group-title">
              {g.label} <span className="muted small">{g.items.filter((i) => i.state === 'done').length}/{g.items.length}</span>
            </h3>
            <ul className="items">
              {g.items.map((item) => (
                <ChecklistItem
                  key={`${item.id}:${item.updated_at}`}
                  item={item}
                  projectId={project.id}
                  allItems={items}
                  users={users.data.users}
                  editable={editable}
                  onChange={reload}
                />
              ))}
            </ul>
          </div>
        ))}
        {editable && <AddItemForm projectId={project.id} onAdded={reload} />}
      </section>

      <section className="card">
        <h2>History</h2>
        <ActivityList activity={activity} linkRecords={false} />
      </section>

      {can('admin') && (
        <div className="danger-zone">
          <button className="btn ghost danger" onClick={remove}>
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}
