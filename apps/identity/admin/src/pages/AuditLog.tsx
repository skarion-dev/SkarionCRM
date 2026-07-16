import { useEffect, useState } from 'react';
import { listAuditLog, type AuditLogEntry } from '../api.js';

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    // Fetch pageSize + 1 to determine if there is a next page
    listAuditLog(pageSize + 1, offset).then((r) => setEntries(r.entries));
  }, [offset]);

  const hasMore = entries.length > pageSize;
  const displayEntries = entries.slice(0, pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <div>
      <h2>Audit Log</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e4e4e7' }}>
            <th style={{ padding: 8 }}>When</th>
            <th style={{ padding: 8 }}>Action</th>
            <th style={{ padding: 8 }}>Resource</th>
            <th style={{ padding: 8 }}>App</th>
            <th style={{ padding: 8 }}>Actor</th>
          </tr>
        </thead>
        <tbody>
          {displayEntries.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
              <td style={{ padding: 8 }}>{new Date(e.createdAt).toLocaleString()}</td>
              <td style={{ padding: 8 }}>{e.action}</td>
              <td style={{ padding: 8 }}>
                {e.resourceType}:{e.resourceId.slice(0, 8)}
              </td>
              <td style={{ padding: 8 }}>{e.app ?? '-'}</td>
              <td style={{ padding: 8 }}>{e.actorUserId?.slice(0, 8) ?? 'system'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - pageSize))}>
          Previous
        </button>
        <span style={{ fontSize: 13, color: '#71717a' }}>Page {currentPage}</span>
        <button disabled={!hasMore} onClick={() => setOffset((o) => o + pageSize)}>
          Next
        </button>
      </div>
    </div>
  );
}
