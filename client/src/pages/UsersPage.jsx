import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLES, ROLE_LABELS, TEAMS } from '../../../shared/roles.js';

const EMPTY_INVITE = { email: '', name: '', role: 'editor', team: '', password: '' };

function InviteForm({ onInvited }) {
  const [form, setForm] = useState(EMPTY_INVITE);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/admin/users', { method: 'POST', body: { ...form, team: form.team || null } });
      setForm(EMPTY_INVITE);
      onInvited();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h2>Invite a user</h2>
      <p className="muted small">They can sign in with Google using this email. Set a password too if they need email sign-in.</p>
      {error && <div className="alert error">{error}</div>}
      <div className="form-row">
        <label>
          Email
          <input type="email" required value={form.email} onChange={set('email')} />
        </label>
        <label>
          Name
          <input value={form.name} onChange={set('name')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Role
          <select value={form.role} onChange={set('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select value={form.team} onChange={set('team')}>
            <option value="">—</option>
            {Object.entries(TEAMS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Password <span className="muted small">(optional)</span>
          </span>
          <input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} />
        </label>
      </div>
      <div>
        <button className="btn primary" disabled={saving}>
          {saving ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api('/api/users')
      .then((d) => setUsers(d.users))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id, fields) {
    setError('');
    try {
      const { user } = await api(`/api/admin/users/${id}`, { method: 'PATCH', body: fields });
      setUsers((list) => list.map((u) => (u.id === id ? user : u)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(u) {
    const password = window.prompt(`New password for ${u.email} (10+ characters):`);
    if (!password) return;
    setError('');
    try {
      await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { password } });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Users</h1>
        <p className="muted">Everyone can see everything. Roles control what each person can edit.</p>
      </header>

      <InviteForm onInvited={load} />

      <div className="card">
        {error && <div className="alert error">{error}</div>}
        {users === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Team</th>
                  <th>Sign-in</th>
                  <th>Last login</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const self = u.id === me.id;
                  return (
                    <tr key={u.id} className={u.active ? '' : 'inactive'}>
                      <td>
                        <strong>{u.name || '—'}</strong>
                        <div className="muted small">{u.email}</div>
                      </td>
                      <td>
                        <select value={u.role} disabled={self} onChange={(e) => patch(u.id, { role: e.target.value })}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={u.team || ''} onChange={(e) => patch(u.id, { team: e.target.value || null })}>
                          <option value="">—</option>
                          {Object.entries(TEAMS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="small">
                        {[u.googleLinked && 'Google', u.hasPassword && 'Password'].filter(Boolean).join(', ') || <span className="muted">Invited</span>}
                      </td>
                      <td className="small muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</td>
                      <td className="actions">
                        <button className="btn ghost small" onClick={() => resetPassword(u)}>
                          Set password
                        </button>
                        {!self && (
                          <button className="btn ghost small" onClick={() => patch(u.id, { active: !u.active })}>
                            {u.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
