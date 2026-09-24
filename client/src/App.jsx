import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { MODULES } from './modules.js';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ModulePlaceholder from './pages/ModulePlaceholder.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';
import MarketsPage from './pages/MarketsPage.jsx';
import MarketDetailPage from './pages/MarketDetailPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import NewProjectPage from './pages/NewProjectPage.jsx';
import ProjectPage from './pages/ProjectPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ImportPage from './pages/ImportPage.jsx';
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
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/markets" element={<MarketsPage />} />
        <Route path="/markets/:id" element={<MarketDetailPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route
          path="/projects/new"
          element={
            <RequireRole role="editor">
              <NewProjectPage />
            </RequireRole>
          }
        />
        <Route path="/projects/:id" element={<ProjectPage />} />
        {MODULES.filter((m) => !m.built).map((m) => (
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
        <Route
          path="/admin/import"
          element={
            <RequireRole role="admin">
              <ImportPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
