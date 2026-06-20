import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword, ApiError } from '../api.js';
import { styles } from './Login.js';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
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
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={styles.page}>
        <div style={styles.form}>
          <p style={styles.error}>Missing reset token. Use the link from your email.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.form}>
          <h1 style={styles.heading}>Password updated</h1>
          <p>You can now sign in with your new password.</p>
          <Link to="/" style={styles.link}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <h1 style={styles.heading}>Choose a new password</h1>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}
