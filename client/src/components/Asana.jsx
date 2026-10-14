/** Asana, read-only: a project's link to its Asana project, and a checklist item's link to an Asana task. */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { STATE_LABELS } from '../../../shared/workflow.js';
import { formatDate, formatDateTime } from '../lib/format.js';
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

/**
 * The linked Asana project's tasks, to bring into the checklist: each is matched to an existing item (suggested when
 * the names line up), added as a new item, or left out. Tasks already linked show the item they feed.
 */
export function AsanaTasks({ project, items, editable, onChange }) {
  const status = useLoad('/api/asana/status');
  const linked = Boolean(status.data?.configured && project.asana_project_gid);
  const tasks = useLoad(linked ? `/api/projects/${project.id}/asana/tasks?v=${project.updated_at}` : null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState({});
  const [message, setMessage] = useState(null);
  const { busy, error, run } = useBusy(async () => {
    await tasks.reload();
    await onChange();
  });
  if (!linked) return null;

  const list = tasks.data?.tasks || [];
  const waiting = list.filter((t) => !t.item);
  const freeItems = items.filter((i) => !i.asana_task_gid);
  const choiceOf = (t) => choices[t.gid] ?? (t.suggested ? t.suggested.id : 'new');
  // An item can be matched to one task; a later row choosing the same item is left out.
  const picked = [];
  const plan = [];
  for (const t of waiting) {
    const c = choiceOf(t);
    if (c === 'skip' || picked.includes(c)) continue;
    if (c !== 'new') picked.push(c);
    plan.push({ task: t.gid, item_id: c === 'new' ? null : c });
  }
  const adds = plan.filter((p) => !p.item_id).length;
  const matches = plan.length - adds;

  const apply = () => {
    const parts = [matches && `match ${matches} to existing items`, adds && `add ${adds} as new checklist items`].filter(Boolean).join(' and ');
    if (!window.confirm(`Bring in ${plan.length} Asana task${plan.length === 1 ? '' : 's'}: ${parts}? Their comments will show in Updates.`)) return;
    run(async () => {
      const res = await api(`/api/projects/${project.id}/asana/apply`, { method: 'POST', body: { links: plan } });
      setChoices({});
      setMessage(
        `Matched ${res.linked}, added ${res.added}, and pulled ${res.pulled} comment${res.pulled === 1 ? '' : 's'}.` +
          (res.skipped.length ? ` Skipped ${res.skipped.length}: ${res.skipped[0].reason}.` : ''),
      );
    });
  };

  return (
    <section className="card flush asana-tasks" aria-label="Asana tasks">
      <div className="row between pad-h asana-tasks-head">
        <div>
          <h2>Asana tasks</h2>
          <p className="muted small">
            {!tasks.data
              ? tasks.error
                ? ''
                : 'Loading tasks from Asana…'
              : `${list.length} task${list.length === 1 ? '' : 's'} in ${project.asana_project_name}: ${list.length - waiting.length} in the checklist, ${waiting.length} not yet.`}
          </p>
        </div>
        {list.length > 0 && (
          <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide tasks' : editable && waiting.length ? 'Review and bring in' : 'Show tasks'}
          </button>
        )}
      </div>
      <div className="pad-h">
        {tasks.error && <p className="error-text small">{tasks.error.message}</p>}
        <ErrorNote error={error} />
        {message && <p className="muted small">{message}</p>}
      </div>
      {open && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asana task</th>
                  <th>Column</th>
                  <th>In Aether</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.gid}>
                    <td>
                      <a href={t.url} target="_blank" rel="noreferrer noopener">
                        {t.name}
                      </a>
                      <div className="muted small">{[t.assignee, t.due_on && `due ${formatDate(t.due_on)}`].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="small">
                      {t.section || '—'}
                      {t.completed && !/done|complete/i.test(t.section) && ' · done'}
                    </td>
                    <td className="small">
                      {t.item ? (
                        <span>
                          ✓ Feeds <strong>{t.item.title}</strong>
                        </span>
                      ) : editable ? (
                        <select value={choiceOf(t)} onChange={(e) => setChoices((c) => ({ ...c, [t.gid]: e.target.value }))} aria-label={`What to do with ${t.name}`}>
                          <option value="new">Add as a new item ({STATE_LABELS[t.state]})</option>
                          <option value="skip">Leave out</option>
                          {freeItems.length > 0 && (
                            <optgroup label="Match to an existing item">
                              {freeItems.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.title}
                                  {t.suggested?.id === i.id ? ' (suggested)' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      ) : (
                        <span className="muted">Not in the checklist</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && plan.length > 0 && (
            <div className="row pad asana-tasks-apply">
              <button className="btn primary" onClick={apply} disabled={busy}>
                {busy ? 'Bringing in…' : `Bring in ${plan.length} task${plan.length === 1 ? '' : 's'}`}
              </button>
              <span className="muted small">
                {[matches && `${matches} matched to existing items`, adds && `${adds} added as new items`].filter(Boolean).join(', ')}. New items start in the state
                their Asana column suggests.
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
