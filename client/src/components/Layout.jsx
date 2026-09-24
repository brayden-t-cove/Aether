import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { applyTheme, getStoredTheme } from '../lib/theme.js';
import { MODULES } from '../modules.js';
import { ROLE_LABELS } from '../../../shared/roles.js';

const THEMES = ['system', 'light', 'dark'];
const THEME_LABELS = { system: 'Auto', light: 'Light', dark: 'Dark' };

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(getStoredTheme);
  const [navOpen, setNavOpen] = useState(false);

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(next);
    setTheme(next);
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const closeNav = () => setNavOpen(false);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>Aether</span>
        </div>
        <nav className="nav" onClick={closeNav}>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <div className="nav-section">Work</div>
          {MODULES.map((m) => (
            <NavLink key={m.path} to={m.path}>
              {m.label}
              {!m.built && <span className="nav-phase" title={`Coming in phase ${m.phase}`}>P{m.phase}</span>}
            </NavLink>
          ))}
          {can('admin') && (
            <>
              <div className="nav-section">Admin</div>
              <NavLink to="/admin/users">Users</NavLink>
            </>
          )}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn ghost nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation">
            ☰
          </button>
          <div className="topbar-spacer" />
          <button className="btn ghost" onClick={cycleTheme} title="Change theme">
            Theme: {THEME_LABELS[theme]}
          </button>
          <NavLink to="/settings" className="user-chip" title="Account settings">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(user.name || user.email)[0].toUpperCase()}</span>}
            <span className="user-chip-text">
              <strong>{user.name || user.email}</strong>
              <small>{ROLE_LABELS[user.role]}</small>
            </span>
          </NavLink>
          <button className="btn ghost" onClick={handleLogout}>
            Sign out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <div className="scrim" onClick={closeNav} />
    </div>
  );
}
