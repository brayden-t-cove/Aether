import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { MODULES } from '../modules.js';

const PHASES = [
  { n: 1, title: 'Products, markets and launch tracking', done: 'A UK launch project shows every item, its owner, state and what blocks it.' },
  { n: 2, title: 'Certifications and manuals', done: 'Cert and manual status for any product × market is visible in one view.' },
  { n: 3, title: 'Odyssey two-way sync and vendors', done: 'A product created in Aether appears in Odyssey without re-entry.' },
  { n: 4, title: 'Returns and comparisons', done: 'Top return reasons per product are visible for any month.' },
];

function describe(a) {
  const who = a.user_name || 'Someone';
  if (a.entity_type === 'user') {
    if (a.action === 'invited') return `${who} invited ${a.changes.email} as ${a.changes.role}`;
    if (a.action === 'updated') return `${who} updated a user (${Object.keys(a.changes).join(', ')})`;
    if (a.action === 'password_reset') return `${who} reset a user's password`;
    if (a.action === 'password_changed') return `${who} changed their password`;
  }
  return `${who} ${a.action} ${a.entity_type}`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    api('/api/activity?limit=10')
      .then((d) => setActivity(d.activity))
      .catch(() => setActivity([]));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">Welcome, {user.name || user.email}. Every project's state, overdue items and open blockers will appear here.</p>
      </header>

      <section className="grid-2">
        <div className="card">
          <h2>What's coming</h2>
          <ol className="phase-list">
            {PHASES.map((p) => (
              <li key={p.n}>
                <span className="phase-badge">Phase {p.n}</span>
                <div>
                  <strong>{p.title}</strong>
                  <p className="muted small">{p.done}</p>
                  <div className="chips">
                    {MODULES.filter((m) => m.phase === p.n).map((m) => (
                      <Link key={m.path} to={m.path} className="chip">
                        {m.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="card">
          <h2>Recent activity</h2>
          {activity === null ? (
            <p className="muted">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="muted">No activity yet. Changes to any record will show up here.</p>
          ) : (
            <ul className="activity">
              {activity.map((a) => (
                <li key={a.id}>
                  <span>{describe(a)}</span>
                  <time className="muted small" dateTime={a.created_at}>
                    {new Date(a.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
