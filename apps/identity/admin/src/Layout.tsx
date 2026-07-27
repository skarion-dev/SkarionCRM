import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext.js';
import { logout } from './api.js';

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid #e4e4e7',
        }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          <strong>Skarion Identity Admin</strong>
          <Link to="/users">Users</Link>
          <Link to="/invitations">Invitations</Link>
          <Link to="/api-keys">API Keys</Link>
          <Link to="/audit-log">Audit Log</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
          <span>{user?.displayName}</span>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </nav>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
