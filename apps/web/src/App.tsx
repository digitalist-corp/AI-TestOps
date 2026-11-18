import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { HomePage } from '@/pages/HomePage';
import { NoticesPage } from '@/pages/NoticesPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
import { UsersPage } from '@/pages/UsersPage';
import { AiSettingsPage } from '@/pages/AiSettingsPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { RunnerContainersPage } from '@/pages/RunnerContainersPage';
import { getStoredAuth } from '@/api/client';
import { AiEnabledProvider } from '@/lib/aiEnabled';
import { AccessProvider } from '@/lib/access';

function GuideRedirect() {
  useEffect(() => {
    window.location.replace('/guide/index.html');
  }, []);
  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const auth = getStoredAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/guide" element={<GuideRedirect />} />
        <Route path="/guide/*" element={<GuideRedirect />} />
        <Route path="/antigravity-guide" element={<GuideRedirect />} />
        <Route path="/antigravity-guide/*" element={<GuideRedirect />} />
        <Route
          element={
            <ProtectedRoute>
              <AccessProvider>
                <AiEnabledProvider>
                  <Layout />
                </AiEnabledProvider>
              </AccessProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="notices/:noticeId" element={<NoticesPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route
            path="projects/:projectId"
            element={<Navigate to="dashboard" replace />}
          />
          <Route path="projects/:projectId/:tab" element={<ProjectDetailPage />} />
          <Route path="runners" element={<RunnerContainersPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="ai-jobs" element={<Navigate to="/projects" replace />} />
          <Route path="ai-settings" element={<AiSettingsPage />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
