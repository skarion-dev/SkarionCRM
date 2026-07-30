import type { DashboardSummary } from '../../api.js';
import { journeyLabel } from '../../lib/leadJourney.js';

export function JourneyFunnel({ summary }: { summary: DashboardSummary }) {
  const rows = summary.leadsByStatus;
  const max = Math.max(1, ...rows.map((r) => r.value || 0));

  if (!rows.length || rows.every((r) => !r.value)) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="font-semibold mb-4">Lead Journey</h2>
        <div className="text-slate-400 text-sm text-center py-8">No accepted leads yet</div>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 10);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">Lead Journey</h2>
      <div className="space-y-2">
        {sorted.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-36 text-sm truncate" title={journeyLabel(row.label)}>
              {journeyLabel(row.label)}
            </div>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${Math.max(2, ((row.value || 0) / max) * 100)}%` }}
              />
            </div>
            <div className="text-sm text-slate-600 w-10 text-right">{row.value || 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
