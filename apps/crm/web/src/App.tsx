import { useEffect, useState } from 'react';
import { listCompanies, type Company } from './api.js';

function App() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCompanies()
      .then((result) => setCompanies(result.companies))
      .catch((err) => {
        // crmFetch already redirected to login on a real 401; anything
        // else here is a genuine error worth surfacing.
        if (err?.status !== 401) setError(err?.message ?? 'Failed to load.');
      });
  }, []);

  if (error) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Error: {error}</div>;
  }

  if (!companies) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading CRM...</div>;
  }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>Skarion CRM</h1>
      <p>{companies.length} companies. Full dashboard coming in Chunk 3.</p>
      <ul>
        {companies.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;
