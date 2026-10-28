/**
 * One person's work across every project: theirs, what's waiting on their teams with nobody on it yet (take it), and
 * what their teammates have. People wear several hats, so "their teams" is all of them; anyone can look at anyone's.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TEAMS } from '../../../shared/roles.js';
import { REQUEST_TYPES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, isOverdue, timeAgo } from '../lib/format.js';
import { requestStatus } from '../lib/statuses.js';
import ErrorNote from '../components/ErrorNote.jsx';
import StateBadge from '../components/StateBadge.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { teamNames } from '../components/TeamPicker.jsx';

function WorkItem({ item, showOwner, onTake, busy }) {
  const overdue = isOverdue(item);
  return (
    <li>
      <div className="dash-item-main">
        <StateBadge state={item.state} waiting={item.waiting_on?.length > 0} />
        <Link to={`/projects/${item.project_id}?item=${item.id}`}>{item.title}</Link>
        {item.team && <span className="team-tag">{TEAMS[item.team]}</span>}
        <span className="spacer" />
        {onTake && (
          <button className="btn small" onClick={() => onTake(item)} disabled={busy}>
            Take it
          </button>
        )}
      </div>
      <div className="muted small">
        {item.project_name}
        {showOwner && item.owner_name && ` · ${item.owner_name}`}
        {item.due_date && <span className={overdue ? 'overdue-text' : ''}>{` · ${overdue ? 'overdue, ' : ''}due ${formatDate(item.due_date)}`}</span>}
        {item.waiting_on?.length > 0 && ` · waiting on ${item.waiting_on.join(', ')}`}
      </div>
      {item.latest_comment && (
        <div className="small dash-latest">
          “{item.latest_comment.body.length > 140 ? `${item.latest_comment.body.slice(0, 140)}…` : item.latest_comment.body}”{' '}
          <span className="muted">
            — {item.latest_comment.author_name || 'Someone'}, {timeAgo(item.latest_comment.created_at)}
          </span>
        </div>
      )}
    </li>
  );
}

function RequestItem({ request, onTake, busy }) {
  return (
    <li>
      <div className="dash-item-main">
        <StatusBadge status={requestStatus(request.state)} />
        <Link to={`/design-requests/${request.id}`}>{request.title}</Link>
        <span className="team-tag">Design request</span>
        <span className="spacer" />
        {onTake && (
          <button className="btn small" onClick={() => onTake(request)} disabled={busy}>
            Take it
          </button>
        )}
      </div>
      <div className="muted small">
        {[REQUEST_TYPES[request.type], request.product_name, request.due_date && `due ${formatDate(request.due_date)}`].filter(Boolean).join(' · ')}
      </div>
    </li>
  );
}

export default function MyWorkPage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const who = params.get('user') || user.id;
  const team = params.get('team') || '';
  const query = new URLSearchParams({ ...(who !== user.id && { user: who }), ...(team && { team }) }).toString();
  const { data, error, reload } = useLoad(`/api/my-work${query ? `?${query}` : ''}`);
  const users = useLoad('/api/users');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const self = who === user.id;
  const canTake = self && can('editor');
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const take = async (path, body) => {
    setBusy(true);
    setActionError(null);
    try {
      await api(path, { method: 'PATCH', body });
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const person = data?.person;
  const name = self ? 'You' : person?.name || person?.email || '…';
  const scope = data ? teamNames(data.teams) : '';
  const mineRequests = data?.requests.filter((r) => r.assignee_id === who) || [];
  const openRequests = data?.requests.filter((r) => !r.assignee_id) || [];

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>{self ? 'My work' : `${name}'s work`}</h1>
          <p className="muted">Across every project: what's {self ? 'yours' : 'theirs'}, what your teams need someone for, and what teammates have.</p>
        </div>
        <div className="row">
          <select value={who} onChange={(e) => setParam('user', e.target.value === user.id ? '' : e.target.value)} aria-label="Whose work">
            {(users.data?.users || [])
              .filter((u) => u.active || u.id === who)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === user.id ? 'Me' : u.name || u.email}
                </option>
              ))}
          </select>
          <select value={team} onChange={(e) => setParam('team', e.target.value)} aria-label="Which team">
            <option value="">{self ? 'My teams' : 'Their teams'}</option>
            {Object.entries(TEAMS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </header>
      <ErrorNote error={error || actionError} />

      {data && (
        <>
          {!data.teams.length && (
            <p className="alert">
              {self ? "You're not on a team yet" : 'Not on a team yet'}, so no team work shows here.{' '}
              {can('admin') ? <Link to="/admin/users">Set teams</Link> : 'Ask an admin to set your teams.'}
            </p>
          )}
          <div className="grid-2">
            <section className="card">
              <h2>
                {self ? 'Yours' : 'Theirs'} <span className="muted small">{data.mine.length + mineRequests.length}</span>
              </h2>
              {data.mine.length + mineRequests.length === 0 ? (
                <p className="muted">Nothing open is assigned to {self ? 'you' : 'them'}.</p>
              ) : (
                <ul className="dash-items">
                  {mineRequests.map((r) => (
                    <RequestItem key={r.id} request={r} />
                  ))}
                  {data.mine.map((i) => (
                    <WorkItem key={i.id} item={i} />
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>
                Up for grabs <span className="muted small">{data.unclaimed.length + openRequests.length}</span>
              </h2>
              <p className="muted small">Open work for {scope || 'no team'} that nobody has taken yet.</p>
              {data.unclaimed.length + openRequests.length === 0 ? (
                <p className="muted">Nothing waiting. Every open item has someone on it.</p>
              ) : (
                <ul className="dash-items">
                  {openRequests.map((r) => (
                    <RequestItem key={r.id} request={r} busy={busy} onTake={canTake ? (x) => take(`/api/design-requests/${x.id}`, { assignee_id: user.id }) : null} />
                  ))}
                  {data.unclaimed.map((i) => (
                    <WorkItem key={i.id} item={i} busy={busy} onTake={canTake ? (x) => take(`/api/items/${x.id}`, { owner_id: user.id }) : null} />
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>
                Teammates have <span className="muted small">{data.teammates.length}</span>
              </h2>
              <p className="muted small">Open {scope || 'team'} work that someone else is on.</p>
              {data.teammates.length === 0 ? (
                <p className="muted">Nothing.</p>
              ) : (
                <ul className="dash-items">
                  {data.teammates.map((i) => (
                    <WorkItem key={i.id} item={i} showOwner />
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Projects {self ? "you're" : "they're"} on</h2>
              {data.projects.length === 0 ? (
                <p className="muted">Not on any open project. Add people from a project's People section.</p>
              ) : (
                <ul className="dash-items">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <div className="dash-item-main">
                        <Link to={`/projects/${p.id}`}>{p.name}</Link>
                      </div>
                      <div className="muted small">
                        {p.open_items} open item{p.open_items === 1 ? '' : 's'}, {p.my_items} {self ? 'yours' : 'theirs'}
                        {p.target_date && ` · target ${formatDate(p.target_date)}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
