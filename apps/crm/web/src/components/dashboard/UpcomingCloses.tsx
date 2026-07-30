import type { DashboardSummary } from '../../api.js';
import { opportunityStageColor, opportunityStageLabel } from '../../lib/opportunityStages.js';

function fmtAmount(value: number | null, currency: string): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(1)}M`;
  return `${currency} ${(value / 1_000).toFixed(0)}k`;
}

export function UpcomingCloses({ summary }: { summary: DashboardSummary }) {
  const rows = summary.upcomingOpportunities;
  if (!rows.length) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="font-semibold mb-4">Upcoming Closes</h2>
        <div className="text-slate-400 text-sm text-center py-8">
          No open opportunities with a close date
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">Upcoming Closes</h2>
      <div className="space-y-2">
        {rows.map((opp, i) => (
          <div key={i} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{opp.name}</div>
              <div className="text-slate-500 text-xs">
                {opp.expectedCloseDate
                  ? new Date(opp.expectedCloseDate).toLocaleDateString()
                  : 'No date'}
                {opp.probability !== null && ` · ${opp.probability}%`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-2 py-0.5 rounded text-xs border ${opportunityStageColor(opp.stage)}`}
              >
                {opportunityStageLabel(opp.stage)}
              </span>
              <span className="text-sm text-slate-700 font-medium">
                {fmtAmount(opp.amount, opp.currency)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
