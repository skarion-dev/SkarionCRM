import type { DashboardSummary } from '../../api.js';

const PRIORITY_LABEL: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const PRIORITY_BAR: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};
const order = ['high', 'medium', 'low'];

export function TeamWorkload({ summary }: { summary: DashboardSummary }) {
  const rows = summary.tasksByPriority.filter((r) => r.value > 0);
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  const max = Math.max(1, ...rows.map((r) => r.value || 0));

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">Team Workload</h2>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xl font-semibold">{total}</span>
        <span className="text-slate-500 text-sm">open tasks across the team</span>
        {summary.totals.overdueTasks > 0 && (
          <span className="text-xs text-red-600 font-medium">
            ({summary.totals.overdueTasks} overdue)
          </span>
        )}
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {order
            .filter((p) => rows.some((r) => r.label === p))
            .map((p) => {
              const row = rows.find((r) => r.label === p);
              const value = row?.value ?? 0;
              return (
                <div key={p} className="flex items-center gap-3">
                  <div className="w-16 text-sm">{PRIORITY_LABEL[p] ?? p}</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${PRIORITY_BAR[p] ?? 'bg-blue-500'}`}
                      style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
                    />
                  </div>
                  <div className="text-sm text-slate-600 w-10 text-right">{value}</div>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="text-slate-400 text-sm text-center py-8">No open tasks</div>
      )}
    </div>
  );
}
