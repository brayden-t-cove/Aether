/** Updates on a checklist item: the dated thread of who said what, and the "why?" prompt for a state change. */
import { useState } from 'react';
import { STATE_LABELS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime, timeAgo } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';
import StateBadge from './StateBadge.jsx';

const PROMPTS = {
  blocked: "What's blocking it? Who or what are we waiting for?",
  done: 'Anything worth noting? (optional)',
  in_review: 'Who is reviewing it, and what are they checking? (optional)',
};

/**
 * Shown when an editor picks a new state: saves the state with an optional note on why.
 * onSave(comment) saves; onCancel puts the state back.
 */
export function StateChangeNote({ item, to, busy, onSave, onCancel }) {
  const [note, setNote] = useState('');
  const submit = (e) => {
    e.preventDefault();
    onSave(note);
  };
  return (
    <form className="state-note" onSubmit={submit} aria-label={`Change ${item.title} to ${STATE_LABELS[to]}`}>
      <div className="row small">
        <StateBadge state={item.state} /> <span aria-hidden="true">→</span> <StateBadge state={to} />
      </div>
      <textarea
        rows={2}
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={PROMPTS[to] || 'Why? Where does it stand? (optional)'}
        aria-label="Why the state changed"
        maxLength={5000}
      />
      <div className="row">
        <button className="btn primary small" disabled={busy}>
          {busy ? 'Saving…' : `Mark ${STATE_LABELS[to]}`}
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The latest update, one line under the checklist row. */
export function LatestUpdate({ item, onOpen }) {
  const c = item.latest_comment;
  if (!c) return null;
  return (
    <button className={`item-latest ${item.state === 'blocked' ? 'is-note' : ''}`} onClick={onOpen} title="Show all updates">
      <span className="item-latest-body">“{c.body}”</span>
      <span className="muted">
        {' '}
        — {c.author_name || 'Someone'}, {timeAgo(c.created_at)}
        {item.comment_count > 1 && ` · ${item.comment_count} updates`}
      </span>
    </button>
  );
}

function Update({ comment, canEdit, canDelete, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/api/comments/${comment.id}`, { method: 'PATCH', body: { body } });
      setEditing(false);
    });
  };
  const remove = () => window.confirm('Delete this update?') && run(() => api(`/api/comments/${comment.id}`, { method: 'DELETE' }));

  return (
    <li className="update">
      <div className="update-head">
        <strong>{comment.author_name || comment.author_email || 'Someone'}</strong>
        <span className="muted small" title={formatDateTime(comment.created_at)}>
          {timeAgo(comment.created_at)}
          {comment.edited_at && ' · edited'}
        </span>
        {comment.state_from ? (
          <span className="update-change small">
            <StateBadge state={comment.state_from} /> <span aria-hidden="true">→</span> <StateBadge state={comment.state} />
          </span>
        ) : null}
        <span className="spacer" />
        {canEdit && !editing && (
          <button className="link-btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {canDelete && !editing && (
          <button className="link-btn small danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>
      <ErrorNote error={error} />
      {editing ? (
        <form className="stack" onSubmit={save}>
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Edit update" maxLength={5000} />
          <div className="row">
            <button className="btn primary small" disabled={busy || !body.trim()}>
              Save
            </button>
            <button type="button" className="btn ghost small" onClick={() => (setEditing(false), setBody(comment.body))}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="pre update-body">{comment.body}</p>
      )}
    </li>
  );
}

/** The full thread, oldest first, with a box to post an update. `onPosted` refreshes the checklist row. */
export default function ItemUpdates({ item, editable, onPosted }) {
  const { user, can } = useAuth();
  const { data, error, reload } = useLoad(`/api/items/${item.id}/comments?n=${item.comment_count}`);
  const [body, setBody] = useState('');
  const [postError, setPostError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function post(e) {
    e.preventDefault();
    setBusy(true);
    setPostError(null);
    try {
      await api(`/api/items/${item.id}/comments`, { method: 'POST', body: { body } });
      setBody('');
      await onPosted();
    } catch (err) {
      setPostError(err);
    } finally {
      setBusy(false);
    }
  }
  const changed = async () => {
    await reload();
    await onPosted();
  };

  return (
    <section className="updates" aria-label={`Updates on ${item.title}`}>
      <h3>Updates</h3>
      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted small">Loading…</p>
      ) : data.comments.length === 0 ? (
        <p className="muted small">No updates yet.{editable && ' Say where this stands and why.'}</p>
      ) : (
        <ul className="update-list">
          {data.comments.map((c) => (
            <Update key={c.id} comment={c} canEdit={editable && c.created_by === user?.id} canDelete={editable && (c.created_by === user?.id || can('admin'))} onChanged={changed} />
          ))}
        </ul>
      )}
      {editable && (
        <form className="stack" onSubmit={post}>
          <ErrorNote error={postError} />
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && post(e)}
            placeholder="Where does this stand? What happened, what's next?"
            aria-label={`New update on ${item.title}`}
            maxLength={5000}
          />
          <div className="row">
            <button className="btn small" disabled={busy || !body.trim()}>
              {busy ? 'Posting…' : 'Post update'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
