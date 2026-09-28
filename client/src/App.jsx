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
import IntegrationsPage from './pages/IntegrationsPage.jsx';
import ReadinessPage from './pages/ReadinessPage.jsx';
import CertificationsPage from './pages/CertificationsPage.jsx';
import CertificationPage from './pages/CertificationPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import DocumentPage from './pages/DocumentPage.jsx';
import DesignRequestsPage from './pages/DesignRequestsPage.jsx';
import DesignRequestPage from './pages/DesignRequestPage.jsx';
import VendorsPage from './pages/VendorsPage.jsx';
import VendorPage from './pages/VendorPage.jsx';
import ReturnsPage from './pages/ReturnsPage.jsx';
import ReturnsImportPage from './pages/ReturnsImportPage.jsx';
import ComparisonsPage from './pages/ComparisonsPage.jsx';
import ComparisonPage from './pages/ComparisonPage.jsx';
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
        <Route path="/readiness" element={<ReadinessPage />} />
        <Route path="/certifications" element={<CertificationsPage />} />
        <Route path="/certifications/:id" element={<CertificationPage />} />
        <Route path="/manuals" element={<DocumentsPage />} />
        <Route path="/manuals/:id" element={<DocumentPage />} />
        <Route path="/design-requests" element={<DesignRequestsPage />} />
        <Route path="/design-requests/:id" element={<DesignRequestPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/vendors/:id" element={<VendorPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route
          path="/returns/import"
          element={
            <RequireRole role="editor">
              <ReturnsImportPage />
            </RequireRole>
          }
        />
        <Route path="/comparisons" element={<ComparisonsPage />} />
        <Route path="/comparisons/:id" element={<ComparisonPage />} />
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
        <Route
          path="/admin/integrations"
          element={
            <RequireRole role="admin">
              <IntegrationsPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
