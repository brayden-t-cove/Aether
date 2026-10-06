/** The panel that slides in from the right with one checklist item: its updates, details and what it waits on. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ITEM_CATEGORIES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { formatDate, isOverdue } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';
import StateBadge from './StateBadge.jsx';
import ItemUpdates from './ItemUpdates.jsx';

const toForm = (item) => ({
  title: item.title,
  stage: item.stage || '',
  category: item.category,
  owner_id: item.owner_id || '',
  due_date: item.due_date || '',
  evidence_url: item.evidence_url || '',
});

export function BlockerLink({ blocker, projectId }) {
  const sameProject = blocker.project_id === projectId;
  return (
    <span className={`chip-static ${blocker.state === 'done' ? 'done' : ''}`}>
      {sameProject ? blocker.title : <Link to={`/projects/${blocker.project_id}`}>{`${blocker.project_name}: ${blocker.title}`}</Link>}
      {blocker.state === 'done' && ' ✓'}
    </span>
  );
}

export default function ItemPanel({ item, projectId, allItems, users, stages = [], editable, onChange, onClose }) {
  const [form, setForm] = useState(() => toForm(item));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blockerId, setBlockerId] = useState('');
  const ref = useRef(null);

  // Focus the panel when it opens, so keyboard and screen-reader users land in it; Escape closes it.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [item.id]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const save = (e) => {
    e.preventDefault();
    run(() => api(`/api/items/${item.id}`, { method: 'PATCH', body: { ...form, owner_id: form.owner_id || null } }));
  };
  const addBlocker = () =>
    blockerId &&
    run(async () => {
      await api(`/api/items/${item.id}/dependencies`, { method: 'POST', body: { blocked_by_id: blockerId } });
      setBlockerId('');
    });
  const removeBlocker = (id) => run(() => api(`/api/items/${item.id}/dependencies/${id}`, { method: 'DELETE' }));
  const remove = () => {
    if (window.confirm(`Remove "${item.title}"?`))
      run(async () => {
        await api(`/api/items/${item.id}`, { method: 'DELETE' });
        onClose();
      });
  };
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const candidates = allItems.filter((i) => i.id !== item.id && !item.blocked_by.some((b) => b.id === i.id));
  const overdue = isOverdue(item);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className="item-panel"
      aria-label={`Details of ${item.title}`}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="item-panel-head">
        <StateBadge state={item.state} waiting={item.waiting} />
        <span className="spacer" />
        <button className="btn ghost small icon-btn" onClick={onClose} aria-label="Close details">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <h2 className="item-panel-title">{item.title}</h2>
      <dl className="item-facts">
        <dt>Owner</dt>
        <dd>{item.owner_name || <span className="muted">Unassigned</span>}</dd>
        <dt>Due</dt>
        <dd className={overdue ? 'overdue-text' : ''}>{item.due_date ? `${overdue ? 'Overdue · ' : ''}${formatDate(item.due_date)}` : <span className="muted">No date</span>}</dd>
        {item.stage && (
          <>
            <dt>Stage</dt>
            <dd>{item.stage}</dd>
          </>
        )}
        {item.evidence_url && (
          <>
            <dt>Evidence</dt>
            <dd>
              <a href={item.evidence_url} target="_blank" rel="noreferrer noopener">
                Open link
              </a>
            </dd>
          </>
        )}
      </dl>

      <div className="item-panel-body">
        <ErrorNote error={error} />
        <ItemUpdates item={item} editable={editable} onPosted={onChange} />

        {editable && (
          <form className="stack" onSubmit={save} aria-label={`Edit ${item.title}`}>
            <h3>Details</h3>
            <label>
              Title
              <input required value={form.title} onChange={set('title')} />
            </label>
            <div className="form-row">
              <label>
                Owner
                <select value={form.owner_id} onChange={set('owner_id')}>
                  <option value="">Unassigned</option>
                  {users.filter((u) => u.active || u.id === item.owner_id).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due date
                <input type="date" value={form.due_date} onChange={set('due_date')} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Stage
                <input list={`stages-${item.id}`} value={form.stage} onChange={set('stage')} placeholder="No stage" />
                <datalist id={`stages-${item.id}`}>
                  {stages.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label>
                Category
                <select value={form.category} onChange={set('category')}>
                  {Object.entries(ITEM_CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>
                Evidence link <span className="muted small">(certificate, test report, file in Drive…)</span>
              </span>
              <input type="url" value={form.evidence_url} onChange={set('evidence_url')} placeholder="https://" />
            </label>
            <div className="row">
              <button className="btn primary" disabled={busy}>
                Save
              </button>
              <span className="spacer" />
              <button type="button" className="btn ghost danger small" onClick={remove} disabled={busy}>
                Remove item
              </button>
            </div>
          </form>
        )}

        <div className="deps">
          <div>
            <h3>Waits on</h3>
            {item.blocked_by.length === 0 && <p className="muted small">Nothing. This item can be done any time.</p>}
            <ul className="dep-list">
              {item.blocked_by.map((b) => (
                <li key={b.id}>
                  <StateBadge state={b.state} />
                  <BlockerLink blocker={b} projectId={projectId} />
                  {editable && (
                    <button className="btn ghost small" onClick={() => removeBlocker(b.id)} disabled={busy} aria-label={`Stop waiting on ${b.title}`}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {editable && candidates.length > 0 && (
              <div className="row">
                <select value={blockerId} onChange={(e) => setBlockerId(e.target.value)} aria-label="Add something this item waits on">
                  <option value="">Add an item this waits on…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <button className="btn small" onClick={addBlocker} disabled={!blockerId || busy}>
                  Add
                </button>
              </div>
            )}
          </div>
          <div>
            <h3>Holds up</h3>
            {item.blocks.length === 0 ? (
              <p className="muted small">Nothing waits on this item.</p>
            ) : (
              <ul className="dep-list">
                {item.blocks.map((b) => (
                  <li key={b.id}>
                    <StateBadge state={b.state} />
                    <BlockerLink blocker={b} projectId={projectId} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
