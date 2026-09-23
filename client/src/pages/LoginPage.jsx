import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const ERRORS = {
  not_invited: 'That Google account has not been invited to Aether. Ask an admin to add your email.',
  no_email: 'Google did not share an email address for that account.',
  google_not_configured: 'Google sign-in is not set up yet. Use your email and password.',
  google_failed: 'Google sign-in did not complete. Please try again.',
};

export default function LoginPage() {
  const { providers, refresh } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(ERRORS[params.get('error')] || '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api('/auth/local', { method: 'POST', body: { email, password } });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <div className="card login-card">
        <div className="brand brand-lg">
          <img src="/favicon.svg" alt="" width="36" height="36" />
          <span>Aether</span>
        </div>
        <p className="muted">Luna's product-readiness hub. Sign in to continue.</p>

        {error && <div className="alert error">{error}</div>}

        {providers.google && (
          <>
            <a className="btn primary block" href="/auth/google">
              Continue with Google
            </a>
            <div className="divider">or</div>
          </>
        )}

        <form onSubmit={handleSubmit} className="stack">
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className={`btn block ${providers.google ? '' : 'primary'}`} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in with email'}
          </button>
        </form>
        <p className="muted small">Aether is invite-only. Ask an admin if you need access.</p>
      </div>
    </div>
  );
}
