import { useState } from 'react';
import { Link } from 'react-router-dom';
import { login, me, ApiError } from '../api.js';
import { redirectAfterLogin } from '../redirect.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password, mfaCode || undefined);
      const meResponse = await me(result.access_token);
      redirectAfterLogin(meResponse.apps);
    } catch (err) {
      if (err instanceof ApiError && err.message.toLowerCase().includes('mfa code required')) {
        setNeedsMfa(true);
        setError('Enter your authenticator code.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <h1 style={styles.heading}>Sign in to Skarion</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {needsMfa && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit authenticator code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            autoFocus
          />
        )}
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <Link to="/forgot-password" style={styles.link}>
          Forgot password?
        </Link>
      </form>
    </div>
  );
}

export const styles = {
  page: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif',
  } as React.CSSProperties,
  form: {
    width: 320,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  } as React.CSSProperties,
  heading: { fontSize: 18, marginBottom: 4 } as React.CSSProperties,
  error: { color: '#dc2626', fontSize: 13, margin: 0 } as React.CSSProperties,
  link: { fontSize: 13, color: '#3f3f46' } as React.CSSProperties,
};
