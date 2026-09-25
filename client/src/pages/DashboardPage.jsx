import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import ActivityList from '../components/ActivityList.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import ProjectTable from '../components/ProjectTable.jsx';
import StateBadge from '../components/StateBadge.jsx';

function StatTile({ label, value, tone, hint }) {
  return (
    <div className={`stat ${value && tone ? `stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function ItemList({ items, empty, showDue = true, showImpact = false }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="dash-items">
      {items.map((i) => (
        <li key={i.id}>
          <div className="dash-item-main">
            <StateBadge state={i.state} waiting={i.waiting_on?.length > 0} />
            <Link to={`/projects/${i.project_id}`}>{i.title}</Link>
          </div>
          <div className="muted small">
            {i.project_name}
            {i.owner_name ? ` · ${i.owner_name}` : ' · Unassigned'}
            {showDue && i.due_date && ` · due ${formatDate(i.due_date)}`}
          </div>
          {showImpact && i.holds_up > 0 && (
            <div className="small">
              Holds up {i.holds_up} other {i.holds_up === 1 ? 'item' : 'items'}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const { data, error } = useLoad('/api/dashboard');

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Welcome, {user.name || user.email}. Every open project, what's blocked and what's late.</p>
        </div>
        {can('editor') && (
          <Link className="btn primary" to="/projects/new">
            New project
          </Link>
        )}
      </header>

      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="stats" aria-label="Summary">
            <StatTile label="Open projects" value={data.counts.open_projects} />
            <StatTile label="Blocked items" value={data.counts.blocked_items} tone="blocked" hint="Marked blocked by the team" />
            <StatTile label="Overdue items" value={data.counts.overdue_items} tone="overdue" />
            <StatTile label="Due in the next 7 days" value={data.counts.due_soon_items} />
          </section>

          <section className="card flush">
            <h2 className="pad-h">Open projects</h2>
            {data.projects.length ? (
              <ProjectTable projects={data.projects} />
            ) : (
              <div className="empty pad">
                <p className="muted">No open projects.</p>
                {can('editor') && (
                  <Link className="btn primary" to="/projects/new">
                    Start one
                  </Link>
                )}
              </div>
            )}
          </section>

          <section className="grid-3">
            <div className="card">
              <h2>Blocked</h2>
              <ItemList items={data.blocked} empty="Nothing is blocked." showImpact />
            </div>
            <div className="card">
              <h2>Overdue</h2>
              <ItemList items={data.overdue} empty="Nothing is overdue." />
            </div>
            <div className="card">
              <h2>Due this week</h2>
              <ItemList items={data.dueSoon} empty="Nothing due in the next 7 days." />
            </div>
          </section>

          <section className="card">
            <h2>Recent activity</h2>
            <ActivityList activity={data.activity} />
          </section>
        </>
      )}
    </div>
  );
}
