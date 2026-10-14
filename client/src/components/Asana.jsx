/** Asana, read-only: a project's link to its Asana project, and a checklist item's link to an Asana task. */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';

function useBusy(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      await onDone?.();
      return out;
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Under the project header: its Asana project, when comments were last pulled, and Pull / Link / Unlink. */
export function AsanaProjectLink({ project, editable, onChange }) {
  const status = useLoad('/api/asana/status');
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState(null);
  const { busy, error, run } = useBusy(async () => {
    await status.reload();
    await onChange();
  });
  if (!status.data?.configured) return null;
  const linked = Boolean(project.asana_project_gid);

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/api/projects/${project.id}/asana`, { method: 'PUT', body: { link } });
      setAdding(false);
      setLink('');
    });
  };
  const pull = () =>
    run(async () => {
      setMessage(null);
      const res = await api('/api/asana/pull', { method: 'POST', body: { project_id: project.id } });
      setMessage(res.message);
    });
  const unlink = () =>
    window.confirm(`Unlink this project from "${project.asana_project_name}"? Items keep their task links.`) &&
    run(() => api(`/api/projects/${project.id}/asana`, { method: 'DELETE' }));

  return (
    <div className="asana-bar small" aria-label="Asana">
      <span className="asana-mark" aria-hidden="true" />
      {linked ? (
        <>
          <span>
            Asana:{' '}
            <a href={project.asana_project_url} target="_blank" rel="noreferrer noopener">
              {project.asana_project_name || 'Asana project'} ↗
            </a>
          </span>
          {status.data.lastSuccessAt && <span className="muted">Comments pulled {formatDateTime(status.data.lastSuccessAt)}</span>}
          {editable && (
            <>
              <button className="btn ghost small" onClick={pull} disabled={busy}>
                {busy ? 'Pulling…' : 'Pull from Asana'}
              </button>
              <button className="link-btn small" onClick={unlink} disabled={busy}>
                Unlink
              </button>
            </>
          )}
        </>
      ) : adding ? (
        <form className="row" onSubmit={save}>
          <input
            autoFocus
            required
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://app.asana.com/…"
            aria-label="Asana project link"
          />
          <button className="btn small" disabled={busy}>
            {busy ? 'Linking…' : 'Link'}
          </button>
          <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="muted">Not linked to Asana.</span>
          {editable && (
            <button className="btn ghost small" onClick={() => setAdding(true)}>
              Link Asana project
            </button>
          )}
        </>
      )}
      {message && <span className="muted">{message}</span>}
      <ErrorNote error={error} />
    </div>
  );
}

/** In the item panel: the Asana task whose comments feed this item's updates, or a way to pick one. */
export function AsanaTaskLink({ item, project, editable, onChange }) {
  const status = useLoad('/api/asana/status');
  const projectLinked = Boolean(project?.asana_project_gid);
  const tasks = useLoad(status.data?.configured && projectLinked && editable && !item.asana_task_gid ? `/api/projects/${project.id}/asana/tasks` : null);
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState(null);
  const { busy, error, run } = useBusy(onChange);
  if (!status.data?.configured) return null;

  const link = (value) =>
    run(async () => {
      const res = await api(`/api/items/${item.id}/asana`, { method: 'PUT', body: { link: value } });
      setChoice('');
      setMessage(res.error ? `Linked, but its comments couldn't be read yet: ${res.error}` : `Linked. ${res.pulled} comment${res.pulled === 1 ? '' : 's'} pulled from Asana.`);
    });
  const unlink = () =>
    window.confirm('Unlink this task? The comments copied from Asana are removed here; they stay in Asana.') &&
    run(async () => {
      await api(`/api/items/${item.id}/asana`, { method: 'DELETE' });
      setMessage(null);
    });

  const list = tasks.data?.tasks || [];
  const free = list.filter((t) => !t.item);
  return (
    <section className="asana-task" aria-label="Asana task">
      <h3>Asana task</h3>
      {item.asana_task_gid ? (
        <p className="small row">
          <a href={item.asana_task_url} target="_blank" rel="noreferrer noopener">
            {item.asana_task_name || 'Asana task'} ↗
          </a>
          <span className="muted">Its comments show in Updates{item.asana_pulled_at ? `, last pulled ${formatDateTime(item.asana_pulled_at)}` : ''}.</span>
          {editable && (
            <button className="link-btn small" onClick={unlink} disabled={busy}>
              Unlink
            </button>
          )}
        </p>
      ) : !editable ? (
        <p className="muted small">Not linked.</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (choice) link(choice);
          }}
        >
          <p className="muted small">Link the Asana task for this item and its comments will show in Updates.</p>
          <div className="row">
            {projectLinked && list.length > 0 ? (
              <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Asana task to link">
                <option value="">Choose a task from {project.asana_project_name}…</option>
                {free.map((t) => (
                  <option key={t.gid} value={t.gid}>
                    {t.name}
                    {t.completed ? ' (done)' : ''}
                  </option>
                ))}
                {list.length > free.length && (
                  <optgroup label="Already linked">
                    {list
                      .filter((t) => t.item)
                      .map((t) => (
                        <option key={t.gid} value={t.gid} disabled>
                          {t.name} → {t.item.title}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            ) : (
              <input
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                placeholder={projectLinked ? (tasks.data ? 'No tasks found. Paste a task link' : 'Loading tasks…') : 'Paste the Asana task link'}
                aria-label="Asana task link"
              />
            )}
            <button className="btn small" disabled={!choice || busy}>
              {busy ? 'Linking…' : 'Link'}
            </button>
          </div>
          {tasks.error && <p className="error-text small">{tasks.error.message}</p>}
        </form>
      )}
      {message && <p className="muted small">{message}</p>}
      <ErrorNote error={error} />
    </section>
  );
}
