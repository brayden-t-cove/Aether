import { useEffect, useRef, useState } from 'react';
import { STATE_LABELS, STATES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { formatDate, isOverdue } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';
import StateBadge from './StateBadge.jsx';
import { BlockerLink } from './ItemPanel.jsx';
import { LatestUpdate, StateChangeNote } from './ItemUpdates.jsx';

const initials = (name) =>
  (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** A person's initials in a colored circle; the color stays the same for the same name. */
export function Avatar({ name }) {
  let h = 0;
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) % 6;
  return (
    <span className={`avatar-sm tone-${h}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * One checklist row: tick, title, owner, due date, state and update count. Clicking the title opens the item's
 * panel (`onSelect`); `onChange` reloads the project.
 */
export default function ChecklistItem({ item, projectId, editable, selected, onSelect, onChange }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // A state picked in the dropdown, waiting for its note (the "why") before it's saved.
  const [pending, setPending] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const done = item.state === 'done';
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
  const setState = (state, comment) =>
    run(async () => {
      await api(`/api/items/${item.id}`, { method: 'PATCH', body: { state, comment } });
      setPending(null);
    });
  // The tick is the quick way: done, or back to in progress.
  const tick = () => setState(done ? 'in_progress' : 'done');

  return (
    <li ref={ref} id={`item-${item.id}`} className={`item ${done ? 'is-done' : ''} ${selected ? 'is-selected' : ''} state-row-${item.state}`}>
      <div className="item-row">
        {editable ? (
          <button className={`tick ${done ? 'on' : ''}`} onClick={tick} disabled={busy} aria-pressed={done} aria-label={done ? `Reopen: ${item.title}` : `Tick off: ${item.title}`}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className={`tick static ${done ? 'on' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
        <button className="item-title" onClick={() => onSelect(selected ? null : item.id)} aria-expanded={selected} title={selected ? 'Close details' : 'Show details and updates'}>
          <span className="item-title-text">{item.title}</span>
          <svg className="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="item-owner">
          {item.owner_name ? (
            <>
              <Avatar name={item.owner_name} />
              <span className="item-owner-name">{item.owner_name}</span>
            </>
          ) : (
            <span className="muted">Unassigned</span>
          )}
        </span>
        <span className={`item-due ${overdue ? 'overdue-text' : 'muted'}`}>{item.due_date ? `${overdue ? 'Overdue · ' : ''}${formatDate(item.due_date)}` : ''}</span>
        <span className="item-state">
          {editable ? (
            <select
              aria-label={`State of ${item.title}`}
              value={pending ?? item.state}
              disabled={busy}
              onChange={(e) => setPending(e.target.value === item.state ? null : e.target.value)}
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
        </span>
        <span className="item-count" title={`${item.comment_count} ${item.comment_count === 1 ? 'update' : 'updates'}`}>
          {item.comment_count > 0 && (
            <>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M2.5 3.5h11v7H6l-3.5 3v-3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span className="visually-hidden">Updates: </span>
              {item.comment_count}
            </>
          )}
        </span>
      </div>

      {pending && <StateChangeNote key={pending} item={item} to={pending} busy={busy} onSave={(note) => setState(pending, note)} onCancel={() => setPending(null)} />}
      {!pending && <LatestUpdate item={item} onOpen={() => onSelect(item.id)} />}

      {openBlockers.length > 0 && !done && (
        <div className="item-waiting">
          <span className="muted small">Waiting on</span>
          {openBlockers.slice(0, 2).map((b) => (
            <BlockerLink key={b.id} blocker={b} projectId={projectId} />
          ))}
          {openBlockers.length > 2 && (
            <button className="link-btn small" onClick={() => onSelect(item.id)}>
              +{openBlockers.length - 2} more
            </button>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </li>
  );
}
