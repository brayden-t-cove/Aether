import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ITEM_CATEGORIES, STATE_LABELS, STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { formatDate, isOverdue } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';
import StateBadge from './StateBadge.jsx';

const toForm = (item) => ({
  title: item.title,
  stage: item.stage || '',
  category: item.category,
  owner_id: item.owner_id || '',
  due_date: item.due_date || '',
  evidence_url: item.evidence_url || '',
  notes: item.notes || '',
});

function BlockerLink({ blocker, projectId }) {
  const sameProject = blocker.project_id === projectId;
  return (
    <span className={`chip-static ${blocker.state === 'done' ? 'done' : ''}`}>
      {sameProject ? blocker.title : <Link to={`/projects/${blocker.project_id}`}>{`${blocker.project_name}: ${blocker.title}`}</Link>}
      {blocker.state === 'done' && ' ✓'}
    </span>
  );
}

/** One checklist row. Expands into an editor for editors. `onChange` reloads the project. */
export default function ChecklistItem({ item, projectId, allItems, users, stages = [], editable, onChange }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => toForm(item));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blockerId, setBlockerId] = useState('');

  const openBlockers = item.blocked_by.filter((b) => b.state !== 'done');
  const overdue = isOverdue(item);

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

  const setState = (state) => run(() => api(`/api/items/${item.id}`, { method: 'PATCH', body: { state } }));
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/api/items/${item.id}`, { method: 'PATCH', body: { ...form, owner_id: form.owner_id || null } });
      setOpen(false);
    });
  };
  const addBlocker = () =>
    blockerId &&
    run(async () => {
      await api(`/api/items/${item.id}/dependencies`, { method: 'POST', body: { blocked_by_id: blockerId } });
      setBlockerId('');
    });
  const removeBlocker = (id) => run(() => api(`/api/items/${item.id}/dependencies/${id}`, { method: 'DELETE' }));
  const remove = () => {
    if (window.confirm(`Remove "${item.title}"?`)) run(() => api(`/api/items/${item.id}`, { method: 'DELETE' }));
  };
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const candidates = allItems.filter((i) => i.id !== item.id && !item.blocked_by.some((b) => b.id === i.id));

  return (
    <li className={`item ${item.state === 'done' ? 'is-done' : ''} ${open ? 'is-open' : ''}`}>
      <div className="item-row">
        <div className="item-state">
          {editable ? (
            <select
              aria-label={`State of ${item.title}`}
              value={item.state}
              disabled={busy}
              onChange={(e) => setState(e.target.value)}
              className={`state-select state-${item.waiting && item.state !== 'blocked' && item.state !== 'done' ? 'waiting' : item.state}`}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </select>
          ) : (
            <StateBadge state={item.state} waiting={item.waiting} />
          )}
        </div>
        <button className="item-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {item.title}
        </button>
        <div className="item-meta">
          <span className={item.owner_name ? '' : 'muted'}>{item.owner_name || 'Unassigned'}</span>
          {item.due_date && <span className={overdue ? 'overdue-text' : 'muted'}>{overdue ? 'Overdue · ' : 'Due '}{formatDate(item.due_date)}</span>}
          {item.evidence_url && (
            <a href={item.evidence_url} target="_blank" rel="noreferrer noopener">
              Evidence
            </a>
          )}
        </div>
      </div>

      {openBlockers.length > 0 && item.state !== 'done' && (
        <div className="item-waiting">
          <span className="muted small">Waiting on</span>
          {openBlockers.slice(0, 2).map((b) => (
            <BlockerLink key={b.id} blocker={b} projectId={projectId} />
          ))}
          {openBlockers.length > 2 && (
            <button className="link-btn small" onClick={() => setOpen(true)}>
              +{openBlockers.length - 2} more
            </button>
          )}
        </div>
      )}
      <ErrorNote error={!open && error} />

      {open && (
        <div className="item-detail">
          <ErrorNote error={error} />
          {editable ? (
            <form className="stack" onSubmit={save}>
              <label>
                Title
                <input required value={form.title} onChange={set('title')} />
              </label>
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
              <label>
                <span>
                  Evidence link <span className="muted small">(certificate, test report, file in Drive…)</span>
                </span>
                <input type="url" value={form.evidence_url} onChange={set('evidence_url')} placeholder="https://" />
              </label>
              <label>
                Notes
                <textarea rows={3} value={form.notes} onChange={set('notes')} />
              </label>
              <div className="row">
                <button className="btn primary" disabled={busy}>
                  Save
                </button>
                <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                  Close
                </button>
                <span className="spacer" />
                <button type="button" className="btn ghost danger small" onClick={remove} disabled={busy}>
                  Remove item
                </button>
              </div>
            </form>
          ) : (
            item.notes && <p className="pre">{item.notes}</p>
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
      )}
    </li>
  );
}
