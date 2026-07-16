import { useEffect, useState } from 'react';
import {
  listInvitations,
  createInvitation,
  revokeInvitation,
  resendInvitation,
  fetchAllowedDomains,
  type InvitationRow,
} from '../api.js';

export function InvitationsList() {
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [email, setEmail] = useState('');
  const [app, setApp] = useState<'crm' | 'hr' | 'books'>('crm');
  const [role, setRole] = useState('');
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);

  async function load() {
    const { invitations: rows } = await listInvitations(filter || undefined);
    setInvitations(rows);
  }

  useEffect(() => {
    fetchAllowedDomains()
      .then(setAllowedDomains)
      .catch(() => setAllowedDomains([]));
  }, []);

  useEffect(() => {
    void load();
  }, [filter]);

  function isEmailAllowed(input: string): boolean {
    if (allowedDomains.length === 0) return true; // no allowlist = open
    const domain = input.split('@')[1]?.toLowerCase();
    return !!domain && allowedDomains.includes(domain);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    if (!isEmailAllowed(email)) {
      setMessage(
        `${
          allowedDomains.length > 0
            ? `Only ${allowedDomains.join(', ')} email addresses are allowed.`
            : ''
        }`
      );
      return;
    }
    setBusy(true);
    try {
      await createInvitation(email, app, role);
      setMessage(`Invitation sent to ${email}.`);
      setEmail('');
      setRole('');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    setBusy(true);
    setMessage('');
    try {
      await revokeInvitation(id);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to revoke.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(id: string) {
    setBusy(true);
    setMessage('');
    try {
      await resendInvitation(id);
      setMessage('Invitation resent.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to resend.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Invitations</h2>

      <form
        onSubmit={handleInvite}
        style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}
      >
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select value={app} onChange={(e) => setApp(e.target.value as 'crm' | 'hr' | 'books')}>
          <option value="crm">crm</option>
          <option value="hr">hr</option>
          <option value="books">books</option>
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} required>
          <option value="" disabled>
            Select role...
          </option>
          <option value="member">member</option>
          <option value="manager">manager</option>
        </select>
        <button type="submit" disabled={busy}>
          Invite
        </button>
      </form>
      {message && <p style={{ fontSize: 13, marginBottom: 12 }}>{message}</p>}

      <div style={{ marginBottom: 12 }}>
        {['', 'pending', 'accepted', 'revoked', 'expired'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{ fontWeight: filter === s ? 'bold' : 'normal', marginRight: 8 }}
          >
            {s || 'all'}
          </button>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e4e4e7' }}>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>App</th>
            <th style={{ padding: 8 }}>Role</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Expires</th>
            <th style={{ padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => (
            <tr key={inv.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
              <td style={{ padding: 8 }}>{inv.email}</td>
              <td style={{ padding: 8 }}>{inv.app}</td>
              <td style={{ padding: 8 }}>{inv.role}</td>
              <td style={{ padding: 8 }}>{inv.status}</td>
              <td style={{ padding: 8 }}>{new Date(inv.expiresAt).toLocaleDateString()}</td>
              <td style={{ padding: 8 }}>
                {inv.status === 'pending' && (
                  <>
                    <button disabled={busy} onClick={() => handleResend(inv.id)}>
                      Resend
                    </button>{' '}
                    <button disabled={busy} onClick={() => handleRevoke(inv.id)}>
                      Revoke
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
