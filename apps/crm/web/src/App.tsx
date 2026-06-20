import { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell.js';
import { useAuthStore } from './stores/auth.js';
import Dashboard from './pages/Dashboard.js';
import LeadsPage from './pages/LeadsPage.js';
import LeadDetail from './pages/LeadDetail.js';
import CompaniesPage from './pages/CompaniesPage.js';
import CompanyDetail from './pages/CompanyDetail.js';
import ContactsPage from './pages/ContactsPage.js';
import ContactDetail from './pages/ContactDetail.js';
import OpportunitiesPage from './pages/OpportunitiesPage.js';
import OpportunityDetail from './pages/OpportunityDetail.js';
import TasksPage from './pages/TasksPage.js';
import PipelinePage from './pages/PipelinePage.js';
import SettingsPage from './pages/SettingsPage.js';
import ChatPage from './pages/ChatPage.js';

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

  if (isLoading) return <Loading />;
  if (!user) {
    const identityUrl = import.meta.env.VITE_IDENTITY_API_URL || 'https://skarion-identity.alsaki1999.workers.dev';
    const returnTo = encodeURIComponent(window.location.href);
    window.location.href = `${identityUrl}/?return_to=${returnTo}`;
    return <Loading />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/leads" element={<RequireAuth><LeadsPage /></RequireAuth>} />
          <Route path="/leads/:id" element={<RequireAuth><LeadDetail /></RequireAuth>} />
          <Route path="/companies" element={<RequireAuth><CompaniesPage /></RequireAuth>} />
          <Route path="/companies/:id" element={<RequireAuth><CompanyDetail /></RequireAuth>} />
          <Route path="/contacts" element={<RequireAuth><ContactsPage /></RequireAuth>} />
          <Route path="/contacts/:id" element={<RequireAuth><ContactDetail /></RequireAuth>} />
          <Route path="/opportunities" element={<RequireAuth><OpportunitiesPage /></RequireAuth>} />
          <Route path="/opportunities/:id" element={<RequireAuth><OpportunityDetail /></RequireAuth>} />
          <Route path="/pipeline" element={<RequireAuth><PipelinePage /></RequireAuth>} />
          <Route path="/tasks" element={<RequireAuth><TasksPage /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
          <Route path="/chat" element={<RequireAuth><ChatPage /></RequireAuth>} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
