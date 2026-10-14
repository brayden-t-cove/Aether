/** Comments on a design request: questions, updates and revision notes between the requester and the designer. */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { requestStatus } from '../lib/statuses.js';
import ErrorNote from './ErrorNote.jsx';
import StatusBadge from './StatusBadge.jsx';
import { Update } from './ItemUpdates.jsx';

export default function RequestComments({ request, editable, onPosted }) {
  const { user, can } = useAuth();
  const { data, error, reload } = useLoad(`/api/design-requests/${request.id}/comments`);
  const [body, setBody] = useState('');
  const [postError, setPostError] = useState(null);
  const [busy, setBusy] = useState(false);

  const changed = async () => {
    await reload();
    await onPosted?.();
  };

  async function post(e) {
    e.preventDefault();
    setBusy(true);
    setPostError(null);
    try {
      await api(`/api/design-requests/${request.id}/comments`, { method: 'POST', body: { body } });
      setBody('');
      await changed();
    } catch (err) {
      setPostError(err);
    } finally {
      setBusy(false);
    }
  }

  const comments = data?.comments || [];
  return (
    <section className="card updates request-comments" aria-label="Comments">
      <h2>Comments</h2>
      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted small">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="muted small">No comments yet.{editable && ' Ask a question, share an update or give feedback on a revision.'}</p>
      ) : (
        <ul className="update-list">
          {comments.map((c, i) => (
            <Update
              key={c.id}
              comment={c}
              endpoint="/api/request-comments"
              noun="comment"
              // Show the request's state when it moved on since the comment before (or since it was requested), e.g. feedback once Delivered.
              tag={(i > 0 ? comments[i - 1].state : 'requested') !== c.state ? <span className="small">while <StatusBadge status={requestStatus(c.state)} /></span> : null}
              canEdit={editable && c.created_by === user?.id}
              canDelete={editable && (c.created_by === user?.id || can('admin'))}
              onChanged={changed}
            />
          ))}
        </ul>
      )}
      {editable && (
        <form className="stack" onSubmit={post}>
          <ErrorNote error={postError} />
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && post(e)}
            placeholder="Ask a question, share an update, or give feedback on a revision…"
            aria-label="New comment"
            maxLength={5000}
          />
          <div className="row">
            <button className="btn small" disabled={busy || !body.trim()}>
              {busy ? 'Posting…' : 'Post comment'}
            </button>
            <span className="muted small">Ctrl/⌘ + Enter to post</span>
          </div>
        </form>
      )}
    </section>
  );
}
