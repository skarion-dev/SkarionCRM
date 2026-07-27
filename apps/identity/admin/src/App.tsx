import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext.js';
import { Login } from './pages/Login.js';
import { UsersList } from './pages/UsersList.js';
import { UserDetail } from './pages/UserDetail.js';
import { InvitationsList } from './pages/InvitationsList.js';
import { AuditLogPage } from './pages/AuditLog.js';
import { ApiKeysList } from './pages/ApiKeysList.js';
import { Layout } from './Layout.js';

function Gate({ children }: { children: React.ReactElement }) {
  const { user, loading, isSuperadmin } = useAuth();

  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperadmin) {
    return <p style={{ padding: 24 }}>Access denied. This area requires global superadmin.</p>;
  }
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <Gate>
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/users" replace />} />
                  <Route path="/users" element={<UsersList />} />
                  <Route path="/users/:id" element={<UserDetail />} />
                  <Route path="/invitations" element={<InvitationsList />} />
                  <Route path="/api-keys" element={<ApiKeysList />} />
                  <Route path="/audit-log" element={<AuditLogPage />} />
                </Routes>
              </Layout>
            </Gate>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
