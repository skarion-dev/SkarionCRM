import type { DashboardSummary } from '../../api.js';

const labelFor = (key: string) => key.replace(/_/g, ' ');

export function SourceMix({ summary }: { summary: DashboardSummary }) {
  const rows = summary.leadsBySource.filter((r) => r.value > 0);
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  const max = Math.max(1, ...rows.map((r) => r.value || 0));

  if (!rows.length) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="font-semibold mb-4">Lead Sources</h2>
        <div className="text-slate-400 text-sm text-center py-8">No leads yet</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">Lead Sources</h2>
      <div className="space-y-2">
        {[...rows]
          .sort((a, b) => (b.value || 0) - (a.value || 0))
          .map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <div className="w-28 text-sm capitalize truncate">{labelFor(row.label)}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full"
                  style={{ width: `${Math.max(2, ((row.value || 0) / max) * 100)}%` }}
                />
              </div>
              <div className="text-sm text-slate-600 w-16 text-right">
                {row.value || 0}
                <span className="text-slate-400 text-xs">
                  {' '}
                  ({Math.round(((row.value || 0) / total) * 100)}%)
                </span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
