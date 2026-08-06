import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  listUsers,
  updateMemberships,
  disableUser,
  enableUser,
  forcePasswordReset,
  type AdminUserRow,
} from '../api.js';

const APPS = ['crm', 'hr', 'books'] as const;

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [roleInputs, setRoleInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const { users } = await listUsers();
    const found = users.find((u) => u.id === id) ?? null;
    setUser(found);
    if (found) {
      const inputs: Record<string, string> = {};
      for (const app of APPS) {
        inputs[app] = found.appMemberships.find((m) => m.app === app)?.role ?? '';
      }
      setRoleInputs(inputs);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  if (!user) return <p>Loading...</p>;

  async function saveMembership(app: 'crm' | 'hr' | 'books') {
    if (!id) return;
    setBusy(true);
    setMessage('');
    try {
      const role = roleInputs[app]?.trim();
      await updateMemberships(id, [{ app, role: role || null }]);
      setMessage(`${app} membership updated.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!id) return;
    setBusy(true);
    try {
      await disableUser(id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleEnable() {
    if (!id) return;
    setBusy(true);
    try {
      await enableUser(id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleForceReset() {
    if (!id) return;
    const temporaryPassword = window.prompt(
      'Enter a temporary password (at least 8 characters). The user must replace it at first login.'
    );
    if (!temporaryPassword) return;
    if (temporaryPassword.length < 8) {
      setMessage('Temporary password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await forcePasswordReset(id, temporaryPassword);
      setMessage(`Temporary password set for ${result.email}. They must change it at first login.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to send reset email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2>{user.displayName}</h2>
      <p style={{ color: '#71717a' }}>{user.email}</p>
      <p>Status: {user.disabledAt ? 'Disabled' : 'Active'}</p>

      <h3>App memberships</h3>
      <table style={{ width: '100%', marginBottom: 16 }}>
        <tbody>
          {APPS.map((app) => (
            <tr key={app}>
              <td style={{ padding: '4px 8px', width: 80 }}>{app}</td>
              <td style={{ padding: '4px 8px' }}>
                <select
                  value={roleInputs[app] ?? ''}
                  onChange={(e) => setRoleInputs((p) => ({ ...p, [app]: e.target.value }))}
                  style={{ width: 200 }}
                >
                  <option value="">(no access)</option>
                  <option value="member">member</option>
                  <option value="manager">manager</option>
                </select>
              </td>
              <td style={{ padding: '4px 8px' }}>
                <button disabled={busy} onClick={() => saveMembership(app)}>
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {user.disabledAt ? (
          <button disabled={busy} onClick={handleEnable}>
            Enable account
          </button>
        ) : (
          <button disabled={busy} onClick={handleDisable}>
            Disable account
          </button>
        )}
        <button disabled={busy} onClick={handleForceReset}>
          Force password reset
        </button>
      </div>

      {message && <p style={{ fontSize: 13 }}>{message}</p>}
    </div>
  );
}
