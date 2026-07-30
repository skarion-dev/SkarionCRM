import { useMemo } from 'react';
import type { ReportingSeriesItem, DashboardSummary } from '../../api.js';
import { OPPORTUNITY_STAGES, opportunityStageLabel } from '../../lib/opportunityStages.js';

const STAGE_ACCENT: Record<string, string> = {
  prospecting: 'bg-slate-400',
  qualification: 'bg-blue-500',
  proposal: 'bg-amber-500',
  negotiation: 'bg-purple-500',
  closed_won: 'bg-green-500',
  closed_lost: 'bg-red-500',
};

export function PipelineFunnel({ summary }: { summary: DashboardSummary }) {
  // Group opportunity rows by currency so we never add across currencies.
  const currencies = useMemo(() => {
    const map = new Map<string, ReportingSeriesItem[]>();
    for (const row of summary.opportunitiesByStage) {
      const cur = row.currency ?? 'USD';
      if (!map.has(cur)) map.set(cur, []);
      map.get(cur)!.push(row);
    }
    return [...map.entries()];
  }, [summary.opportunitiesByStage]);

  const byStageCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of summary.opportunitiesByStage) {
      counts.set(row.label, (counts.get(row.label) ?? 0) + (row.value || 0));
    }
    return counts;
  }, [summary.opportunitiesByStage]);

  const maxCount = Math.max(1, ...[...byStageCount.values()].map((v) => v || 0));

  if (!summary.opportunitiesByStage.length) {
    return <EmptyShell title="Pipeline Overview">No opportunities yet</EmptyShell>;
  }

  function fmtAmount(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    return `$${(value / 1_000).toFixed(0)}k`;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">Pipeline Overview</h2>
      <div className="space-y-3">
        {OPPORTUNITY_STAGES.map((stage) => {
          const count = byStageCount.get(stage.key) ?? 0;
          return (
            <div key={stage.key} className="flex items-center gap-3">
              <div className="w-28 text-sm">{opportunityStageLabel(stage.key)}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${STAGE_ACCENT[stage.key] ?? 'bg-blue-500'}`}
                  style={{ width: `${Math.max(2, (count / maxCount) * 100)}%` }}
                />
              </div>
              <div className="text-sm text-slate-600 w-20 text-right">
                {count} deal{count === 1 ? '' : 's'}
              </div>
            </div>
          );
        })}
      </div>
      {currencies.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
          {currencies.map(([cur, rows]) => {
            const total = rows.reduce((s, r) => s + (r.secondaryValue ?? 0), 0);
            return (
              <div key={cur} className="flex items-center justify-between text-xs text-slate-500">
                <span className="capitalize">{cur} open value</span>
                <span className="font-medium text-slate-700">{fmtAmount(total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">{title}</h2>
      <div className="text-slate-400 text-sm text-center py-8">{children}</div>
    </div>
  );
}
