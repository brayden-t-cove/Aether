import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { MODULES } from './modules.js';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ModulePlaceholder from './pages/ModulePlaceholder.jsx';
import UsersPage from './pages/UsersPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequireRole({ role, children }) {
  const { can } = useAuth();
  return can(role) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { loading, user } = useAuth();
  if (loading) return <div className="boot">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        {MODULES.map((m) => (
          <Route key={m.path} path={m.path} element={<ModulePlaceholder module={m} />} />
        ))}
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/admin/users"
          element={
            <RequireRole role="admin">
              <UsersPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
