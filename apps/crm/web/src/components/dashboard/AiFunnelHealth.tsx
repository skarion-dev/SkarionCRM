import type { DashboardSummary } from '../../api.js';
import { Sparkles } from 'lucide-react';

export function AiFunnelHealth({ summary }: { summary: DashboardSummary }) {
  const rows = summary.leadClassifications;
  const avg = summary.totals.averageLeadScore;

  const COLORS: Record<string, string> = {
    PRIORITY_A1: 'bg-emerald-500',
    PRIORITY_A2: 'bg-green-500',
    QUALIFIED_B: 'bg-blue-500',
    BORDERLINE: 'bg-amber-500',
    NURTURE: 'bg-yellow-400',
    REJECT: 'bg-red-500',
  };
  const labelFor = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

  const total = rows.reduce((s, r) => s + (r.value || 0), 0);

  if (!rows.length || total === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Sparkles size={16} className="text-violet-500" /> AI Funnel Health
        </h2>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">{avg === null ? '—' : Math.round(avg)}</span>
          <span className="text-slate-500 text-sm">avg AI score</span>
        </div>
        <div className="text-slate-400 text-sm text-center py-6">No scored leads yet</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Sparkles size={16} className="text-violet-500" /> AI Funnel Health
      </h2>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xl font-semibold">{avg === null ? '—' : Math.round(avg)}</span>
        <span className="text-slate-500 text-sm">avg AI score · {total} scored</span>
      </div>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-100 mb-3">
        {[...rows]
          .sort((a, b) => (b.value || 0) - (a.value || 0))
          .map((row) => (
            <div
              key={row.label}
              className={COLORS[row.label] ?? 'bg-slate-400'}
              style={{ width: `${((row.value || 0) / total) * 100}%` }}
              title={`${labelFor(row.label)}: ${row.value || 0}`}
            />
          ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {[...rows]
          .sort((a, b) => (b.value || 0) - (a.value || 0))
          .map((row) => (
            <div key={row.label} className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${COLORS[row.label] ?? 'bg-slate-400'}`} />
              <span className="text-slate-600 truncate">{labelFor(row.label)}</span>
              <span className="ml-auto font-medium text-slate-700">{row.value || 0}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
