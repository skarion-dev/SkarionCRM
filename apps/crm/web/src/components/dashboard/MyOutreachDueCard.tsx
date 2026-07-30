import type { DashboardSummary } from '../../api.js';
import { useNavigate } from 'react-router-dom';
import { Send } from 'lucide-react';

const channelLabel = (ch: string) => ch.replace(/_/g, ' ');
const stageLabel = (s: string) => s.replace(/_/g, ' ');

export function MyOutreachDueCard({ summary }: { summary: DashboardSummary }) {
  const navigate = useNavigate();
  const rows = summary.mine.outreachDue;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Send size={16} className="text-violet-500" /> Outreach Due
      </h2>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div
              key={`${row.leadId}-${i}`}
              onClick={() => navigate(`/leads/${row.leadId}`)}
              className="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{row.leadName}</div>
                <div className="text-xs text-slate-500 capitalize">
                  {channelLabel(row.channel)} · {stageLabel(row.channelStage)}
                </div>
              </div>
              {row.nextFollowupAt && (
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(row.nextFollowupAt).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-400 text-sm text-center py-8">No follow-ups due</div>
      )}
    </div>
  );
}
