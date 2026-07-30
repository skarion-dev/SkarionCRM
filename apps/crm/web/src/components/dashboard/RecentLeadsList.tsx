import type { DashboardSummary } from '../../api.js';
import { journeyBadgeClass, journeyLabel } from '../../lib/leadJourney.js';

export function RecentLeadsList({ summary }: { summary: DashboardSummary }) {
  const rows = summary.recentLeads;
  if (!rows.length) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="font-semibold mb-4">Recent Accepted Leads</h2>
        <div className="text-slate-400 text-sm text-center py-8">No leads yet</div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">Recent Accepted Leads</h2>
      <div className="space-y-2">
        {rows.map((lead, i) => (
          <div key={i} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{lead.name}</div>
              <div className="text-slate-500 text-xs truncate">
                {lead.company ?? '—'} · {new Date(lead.createdAt).toLocaleDateString()}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded text-xs ${journeyBadgeClass(lead.status)}`}>
              {journeyLabel(lead.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
