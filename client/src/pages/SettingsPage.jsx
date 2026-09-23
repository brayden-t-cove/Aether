import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS, TEAMS } from '../../../shared/roles.js';

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus(null);
    try {
      await api('/api/me/password', { method: 'POST', body: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setStatus({ ok: true, message: 'Password updated.' });
      refresh();
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    }
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <h1>Account</h1>
      </header>

      <div className="card">
        <dl className="details">
          <dt>Name</dt>
          <dd>{user.name || '—'}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
          <dt>Team</dt>
          <dd>{TEAMS[user.team] || '—'}</dd>
          <dt>Google</dt>
          <dd>{user.googleLinked ? 'Linked' : 'Not linked'}</dd>
        </dl>
      </div>

      <form className="card stack" onSubmit={handleSubmit}>
        <h2>{user.hasPassword ? 'Change password' : 'Set a password'}</h2>
        {!user.hasPassword && <p className="muted small">Optional: lets you sign in with email as well as Google.</p>}
        {status && <div className={`alert ${status.ok ? 'success' : 'error'}`}>{status.message}</div>}
        {user.hasPassword && (
          <label>
            Current password
            <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>
        )}
        <label>
          <span>
            New password <span className="muted small">(10+ characters)</span>
          </span>
          <input type="password" autoComplete="new-password" required minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <div>
          <button className="btn primary">Save password</button>
        </div>
      </form>
    </div>
  );
}
