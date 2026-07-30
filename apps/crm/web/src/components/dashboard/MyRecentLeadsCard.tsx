import type { DashboardSummary } from '../../api.js';
import { useNavigate } from 'react-router-dom';
import { journeyBadgeClass, journeyLabel } from '../../lib/leadJourney.js';

export function MyRecentLeadsCard({ summary }: { summary: DashboardSummary }) {
  const navigate = useNavigate();
  const rows = summary.mine.recentAcceptedLeads;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4">My Recent Leads</h2>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((lead) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{lead.name}</div>
                <div className="text-slate-500 text-xs truncate">
                  {lead.email ?? '—'} · {new Date(lead.createdAt).toLocaleDateString()}
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-xs ${journeyBadgeClass(lead.journeyStage ?? 'new')}`}
              >
                {journeyLabel(lead.journeyStage)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-400 text-sm text-center py-8">
          You have no accepted leads yet
        </div>
      )}
    </div>
  );
}
