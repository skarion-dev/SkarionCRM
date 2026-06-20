import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api.js';
import { styles } from './Login.js';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email);
    } finally {
      // Always show the same generic confirmation, regardless of outcome -
      // the server already never leaks whether the email exists; doing the
      // same here too.
      setSent(true);
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div style={styles.page}>
        <div style={styles.form}>
          <h1 style={styles.heading}>Check your email</h1>
          <p>If that email exists, a reset link has been sent.</p>
          <Link to="/" style={styles.link}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <h1 style={styles.heading}>Reset your password</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
        <Link to="/" style={styles.link}>
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
