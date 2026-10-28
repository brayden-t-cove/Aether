/** The people on a project: everyone it touches, each with their teams. Editors can change who's on it. */
import { useState } from 'react';
import { api } from '../lib/api.js';
import ErrorNote from './ErrorNote.jsx';
import { teamNames } from './TeamPicker.jsx';

export default function ProjectPeople({ projectId, members, users, editable, onChange }) {
  const [editing, setEditing] = useState(null); // null, or the set of user IDs being picked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/members`, { method: 'PUT', body: { user_ids: [...editing] } });
      setEditing(null);
      await onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id) =>
    setEditing((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <section className="card project-people" aria-label="People on this project">
      <div className="row between">
        <h2>People</h2>
        {editable && !editing && (
          <button className="btn ghost small" onClick={() => setEditing(new Set(members.map((m) => m.id)))}>
            Edit people
          </button>
        )}
      </div>
      <ErrorNote error={error} />
      {editing ? (
        <>
          <ul className="people-pick">
            {users
              .filter((u) => u.active || editing.has(u.id))
              .map((u) => (
                <li key={u.id}>
                  <label className="inline">
                    <input type="checkbox" checked={editing.has(u.id)} onChange={() => toggle(u.id)} />
                    <span>
                      {u.name || u.email} <span className="muted small">{teamNames(u.teams)}</span>
                    </span>
                  </label>
                </li>
              ))}
          </ul>
          <div className="row">
            <button className="btn primary small" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save people'}
            </button>
            <button className="btn ghost small" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : members.length ? (
        <ul className="people">
          {members.map((m) => (
            <li key={m.id}>
              <strong>{m.name || m.email}</strong>
              {m.teams.length > 0 && <span className="muted small"> · {teamNames(m.teams)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nobody yet. Add everyone this project touches, so their teams see its work.</p>
      )}
    </section>
  );
}
