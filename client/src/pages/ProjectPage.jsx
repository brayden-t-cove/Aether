import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ITEM_CATEGORIES, PROJECT_TYPES, STATE_LABELS, STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, today } from '../lib/format.js';
import ActivityList from '../components/ActivityList.jsx';
import ChecklistItem from '../components/ChecklistItem.jsx';
import ItemPanel from '../components/ItemPanel.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import ProgressMeter from '../components/ProgressMeter.jsx';
import StateBadge from '../components/StateBadge.jsx';
import TestSessions from '../components/TestSessions.jsx';

/**
 * Group by stage, in the order stages first appear, when items have stages
 * (template checklists do). Otherwise group by category.
 */
function groupItems(items) {
  if (items.some((i) => i.stage)) {
    const order = [...new Set(items.map((i) => i.stage || ''))].sort((a, b) => (a === '') - (b === ''));
    return order.map((stage, n) => ({
      key: `stage:${stage}`,
      label: stage || 'Other items',
      number: stage ? n + 1 : null,
      items: items.filter((i) => (i.stage || '') === stage),
    }));
  }
  return Object.keys(ITEM_CATEGORIES)
    .map((key) => ({ key, label: ITEM_CATEGORIES[key], items: items.filter((i) => i.category === key) }))
    .filter((g) => g.items.length);
}

/** One stage of the checklist: a heading that folds the section away, with its done count. */
function ChecklistSection({ group, children }) {
  const done = group.items.filter((i) => i.state === 'done').length;
  // A stage that's finished starts folded away, so open work is what you see first.
  const [open, setOpen] = useState(done < group.items.length);
  return (
    <div className={`item-group ${open ? '' : 'is-closed'}`}>
      <h3 className="group-title">
        <button className="group-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <svg className="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {group.number && <span className="stage-number">{group.number}</span>}
          <span>{group.label}</span>
          <span className="muted small group-count">
            {done} of {group.items.length} done
          </span>
        </button>
      </h3>
      <div className="drawer" inert={!open}>
        <ul className="items">{children}</ul>
      </div>
    </div>
  );
}

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

function AddItemForm({ projectId, stages, onAdded }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/projects/${projectId}/items`, { method: 'POST', body: { title, category, stage } });
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
      {stages.length > 0 && (
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="New item stage">
          <option value="">No stage</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
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
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useLoad(`/api/projects/${id}`);
  const users = useLoad('/api/users');
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data || !users.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const { project, items, activity } = data;
  const editable = can('editor');
  const late = project.state !== 'done' && project.target_date && project.target_date < today();
  const groups = groupItems(items);
  const stages = [...new Set(items.map((i) => i.stage).filter(Boolean))];
  // ?item=<id> opens that item's panel (the dashboard links here); closing it takes the parameter off.
  const selectedId = params.get('item');
  const selected = items.find((i) => i.id === selectedId) || null;
  const select = (itemId) => {
    const next = new URLSearchParams(params);
    if (itemId) next.set('item', itemId);
    else next.delete('item');
    setParams(next, { replace: Boolean(selectedId && itemId) });
  };

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

      <section className="card flush checklist">
        <div className="checklist-head">
          <h2>Checklist</h2>
          <span className="muted small">
            {project.done_count} of {project.item_count} done
          </span>
        </div>
        {items.length === 0 && <p className="muted pad">No items yet.{editable && ' Add the first one below.'}</p>}
        {items.length > 0 && (
          <div className="list-columns" aria-hidden="true">
            <span />
            <span>Item</span>
            <span>Owner</span>
            <span>Due</span>
            <span>State</span>
            <span />
          </div>
        )}
        {groups.map((g) => (
          <ChecklistSection key={g.key} group={g}>
            {g.items.map((item) => (
              <ChecklistItem
                key={`${item.id}:${item.updated_at}`}
                item={item}
                projectId={project.id}
                editable={editable}
                selected={item.id === selectedId}
                onSelect={select}
                onChange={reload}
              />
            ))}
          </ChecklistSection>
        ))}
        {editable && <AddItemForm projectId={project.id} stages={stages} onAdded={reload} />}
      </section>

      {selected && (
        <ItemPanel
          key={`${selected.id}:${selected.updated_at}`}
          item={selected}
          projectId={project.id}
          allItems={items}
          users={users.data.users}
          stages={stages}
          editable={editable}
          onChange={reload}
          onClose={() => select(null)}
        />
      )}

      {project.product_id && <TestSessions projectId={project.id} />}

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
