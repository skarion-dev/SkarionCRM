import { useEffect, useState } from 'react';
import { listApiKeys, createApiKey, revokeApiKey, type ApiKeyRow } from '../api.js';

export function ApiKeysList() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');

  // Shown exactly once, right after creation — the backend never returns
  // the plaintext key again after this response.
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedForExtension, setCopiedForExtension] = useState(false);

  // Production CRM Worker URL the extension talks to — matches the
  // extension's own DEFAULT_CRM_URL (popup.js) so a fresh install and this
  // "copy for extension" blob agree without the teammate having to know it.
  const EXTENSION_CRM_URL = 'https://skarion-crm-platform.skarion-talentos.workers.dev';

  async function load() {
    const { keys: rows } = await listApiKeys();
    setKeys(rows);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      const result = await createApiKey(email, label);
      setNewKey(result.key);
      setCopied(false);
      setEmail('');
      setLabel('');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create key.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Anything using it will stop working immediately.')) return;
    setBusy(true);
    setMessage('');
    try {
      await revokeApiKey(id);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to revoke.');
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(newKey);
    setCopied(true);
  }

  // The extension's Settings panel has a matching "Paste from admin panel"
  // button that reads this back and fills+saves both fields — avoids
  // hand-retyping a 40-char key into a tiny popup input.
  function handleCopyForExtension() {
    void navigator.clipboard.writeText(
      JSON.stringify({ crmUrl: EXTENSION_CRM_URL, apiKey: newKey })
    );
    setCopiedForExtension(true);
  }

  return (
    <div>
      <h2>API Keys</h2>
      <p style={{ fontSize: 13, color: '#71717a', maxWidth: 640 }}>
        Long-lived keys for non-interactive clients that can&apos;t hold a browser session — e.g.
        the LinkedIn profile-capture extension. Each key is tied to one teammate; leads captured
        with it are attributed to that person. Issue one per teammate, never share a key across
        people.
      </p>

      {newKey && (
        <div
          style={{
            background: '#fefce8',
            border: '1px solid #fde047',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            maxWidth: 640,
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Copy this key now — it will never be shown again.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                background: '#fff',
                border: '1px solid #e4e4e7',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                wordBreak: 'break-all',
              }}
            >
              {newKey}
            </code>
            <button type="button" onClick={handleCopy}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button type="button" onClick={handleCopyForExtension}>
              {copiedForExtension ? 'Copied ✓' : 'Copy for extension'}
            </button>
            <button type="button" onClick={() => setNewKey('')}>
              Done
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#71717a', marginTop: 6 }}>
            &quot;Copy for extension&quot; puts both the key and the CRM URL on the clipboard —
            paste it with the extension&apos;s ⚙ Settings → &quot;Paste from admin panel&quot;
            button instead of typing either by hand.
          </p>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}
      >
        <input
          type="email"
          placeholder="Teammate's email (must already have an account)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: 280 }}
          required
        />
        <input
          type="text"
          placeholder="Label (e.g. 'Saki's laptop')"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ width: 200 }}
          required
        />
        <button type="submit" disabled={busy}>
          Generate key
        </button>
      </form>
      {message && <p style={{ fontSize: 13, marginBottom: 12, color: '#b91c1c' }}>{message}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e4e4e7' }}>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Label</th>
            <th style={{ padding: 8 }}>Created</th>
            <th style={{ padding: 8 }}>Last used</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
              <td style={{ padding: 8 }}>{k.email}</td>
              <td style={{ padding: 8 }}>{k.label}</td>
              <td style={{ padding: 8 }}>{new Date(k.createdAt).toLocaleDateString()}</td>
              <td style={{ padding: 8 }}>
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
              </td>
              <td style={{ padding: 8 }}>{k.revokedAt ? 'Revoked' : 'Active'}</td>
              <td style={{ padding: 8 }}>
                {!k.revokedAt && (
                  <button disabled={busy} onClick={() => handleRevoke(k.id)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
