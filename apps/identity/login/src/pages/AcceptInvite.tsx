import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { acceptInvitation, me, ApiError } from '../api.js';
import { redirectAfterLogin } from '../redirect.js';
import { styles } from './Login.js';

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const result = await acceptInvitation(token, password, displayName);
      const meResponse = await me(result.access_token);
      redirectAfterLogin(meResponse.apps);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to accept invitation.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={styles.page}>
        <div style={styles.form}>
          <p style={styles.error}>Missing invitation token. Use the link from your email.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <h1 style={styles.heading}>Welcome to Skarion</h1>
        <p style={{ fontSize: 13, color: '#71717a', marginTop: -4 }}>
          Set your name and password to finish setting up your account.
        </p>
        <input
          type="text"
          placeholder="Your name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          required
        />
        <input
          type="password"
          placeholder="Choose a password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Setting up...' : 'Accept invitation'}
        </button>
      </form>
    </div>
  );
}
