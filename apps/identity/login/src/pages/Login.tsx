import { useState } from 'react';
import { Link } from 'react-router-dom';
import { login, loginVerify, me } from '../api.js';
import { redirectAfterLogin } from '../redirect.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.access_token) {
        const meResponse = await me(result.access_token);
        redirectAfterLogin(meResponse.apps, result.access_token, result.refresh_token);
        return;
      }
      if (result.pending_token) {
        setPendingToken(result.pending_token);
        setCode('');
        setStep('code');
        return;
      }
      setError('Unexpected server response.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await loginVerify(pendingToken, code);
      const meResponse = await me(result.access_token);
      redirectAfterLogin(meResponse.apps, result.access_token, result.refresh_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  }

  function handleGoBack() {
    setStep('password');
    setPendingToken('');
    setCode('');
    setError('');
  }

  if (step === 'code') {
    return (
      <div style={styles.page}>
        <form onSubmit={handleStep2} style={styles.form}>
          <h1 style={styles.heading}>Check your email</h1>
          <p style={styles.subtext}>
            A 6-digit sign-in code was sent to <strong>{email}</strong>. It expires in 10 minutes.
          </p>
          <input
            type="text"
            inputMode="numeric"
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
            autoComplete="one-time-code"
            required
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading || code.length < 6}>
            {loading ? 'Verifying...' : 'Verify code'}
          </button>
          <button type="button" onClick={handleGoBack} style={styles.linkBtn}>
            Use a different email
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleStep1} style={styles.form}>
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
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Sending code...' : 'Sign in'}
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
  subtext: { fontSize: 13, color: '#52525b', margin: 0 } as React.CSSProperties,
  error: { color: '#dc2626', fontSize: 13, margin: 0 } as React.CSSProperties,
  link: { fontSize: 13, color: '#3f3f46' } as React.CSSProperties,
  linkBtn: {
    fontSize: 13,
    color: '#3f3f46',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    padding: 0,
  },
};
